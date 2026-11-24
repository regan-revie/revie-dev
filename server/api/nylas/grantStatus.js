/**
 * What happens when a coach's Google connection stops working.
 *
 * A Nylas grant (the permission a coach gave us to use their Google Calendar) can stop working: the
 * coach revokes Revie's access in their Google account, Google asks for a fresh sign-in, or the
 * grant is deleted. Until now nothing noticed: the Calendar page still said "connected", the coach's
 * sessions still looked bookable, and a client could pay for a time that could not be put on the
 * calendar.
 *
 * The state lives on the coach's own Sharetribe user, in `privateData` (readable by the coach and by
 * the Integration API, never by other users):
 *
 *   calendarStatus               'connected' | 'reconnect_needed'   (missing means connected)
 *   calendarBrokenAt             ISO time the break was noticed
 *   calendarBrokenReason         'grant.expired' | 'grant.deleted' | 'daily-check-expired' | ...
 *   calendarReconnectEmailedAt   ISO time the one "reconnect" email went out for this break
 *
 * Who writes it:
 *   - a Nylas `grant.expired` / `grant.deleted` webhook (handleGrantWebhook)
 *   - the daily check of every coach's grant (grantHealth.js), in case a webhook was missed
 *   - the Nylas callback, when the coach reconnects (callback.js clears it)
 *   - the reconcile loop, which re-checks a broken grant every minute and clears it when it is
 *     valid again, and sends the email if it has not gone out yet
 *
 * Who reads it: ensureBookable.js (a coach with `reconnect_needed` is not bookable: the same path as
 * "no calendar connected", so clients see "This coach isn't taking bookings yet"), the Calendar page
 * and the session setup card.
 *
 * Existing bookings are left exactly as they are. Only new bookings stop.
 */

const log = require('../../log');
const db = require('./db');
const integration = require('./integration');
const postmark = require('../../email/postmark');
const { nylasRequest } = require('./client');
const { buildReconnectEmailModel, CALENDAR_RECONNECT_ALIAS } = require('./reconnectEmailModel');

const CONNECTED = 'connected';
const RECONNECT_NEEDED = 'reconnect_needed';
const SENTRY_CODE = 'nylas-grant-expired';

const EMAIL_RETRY_AFTER_MS = 10 * 60 * 1000;
const emailFailedAt = new Map(); // user id -> epoch ms of the last failed send

/** The coach's calendar status from their private data. A missing value means connected. */
const statusOf = privateData =>
  privateData && privateData.calendarStatus === RECONNECT_NEEDED ? RECONNECT_NEEDED : CONNECTED;

/**
 * Ask Nylas whether a grant still works.
 *
 *   valid    the grant works
 *   broken   Nylas says it is invalid (`grant_status: 'invalid'`) or no longer exists (404)
 *   unknown  anything else (network error, rate limit, 5xx, a rejected API key). Never treated as
 *            broken: a Nylas outage or a bad key must not lock every coach out.
 *
 * @returns {Promise<{state: 'valid'|'broken'|'unknown', reason?: string}>}
 */
const fetchGrantHealth = async (grantId, { request = nylasRequest } = {}) => {
  try {
    const grant = await request(`/v3/grants/${grantId}`);
    if (grant && grant.grant_status === 'invalid') return { state: 'broken', reason: 'invalid' };
    return { state: 'valid' };
  } catch (e) {
    if (e.status === 404) return { state: 'broken', reason: 'not-found' };
    return { state: 'unknown' };
  }
};

/** The user's private data, from a user resource returned by the Integration API. */
const privateDataOf = user => (user && user.attributes.profile.privateData) || {};

const readUser = async (sdk, userId) => (await sdk.users.show({ id: userId })).data.data;

/**
 * Every coach with a connected calendar, one page at a time. The Integration API cannot filter by
 * private data, so this reads users and keeps those holding a grant.
 *
 * @yields {object} a user resource
 */
async function* usersWithGrants(sdk, { perPage = 100, maxPages = 50 } = {}) {
  for (let page = 1; page <= maxPages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await sdk.users.query({ perPage, page });
    for (const user of response.data.data) {
      if (privateDataOf(user).nylasGrantId) yield user;
    }
    if (page >= (response.data.meta?.totalPages || 1)) return;
  }
}

/** The coach whose stored grant is this one, or null (an old grant, or not one of ours). */
const findCoachByGrantId = async (sdk, grantId) => {
  for await (const user of usersWithGrants(sdk)) {
    if (privateDataOf(user).nylasGrantId === grantId) return user;
  }
  return null;
};

/** Switch calendar booking off on every published session the coach has. Idempotent. */
const switchOffListings = async (sdk, userId) => {
  const response = await sdk.listings.query({
    authorId: userId,
    states: 'published',
    perPage: 100,
  });
  const enabled = response.data.data.filter(
    l => l.attributes.publicData && l.attributes.publicData.calendarBookingEnabled
  );
  for (const listing of enabled) {
    // eslint-disable-next-line no-await-in-loop
    await sdk.listings.update({ id: listing.id, publicData: { calendarBookingEnabled: false } });
  }
  return enabled.length;
};

/**
 * The one "reconnect" email, once per break.
 *
 * Driven by state, not by the event: whichever path first sees a break with no email stamped sends
 * it and stamps it, so a send that failed (Postmark down) is simply tried again on a later tick,
 * and a duplicate webhook cannot send a second. Nothing is sent while sending is switched off
 * (POSTMARK_SENDING_ENABLED), and nothing is stamped then either, so it goes out once sending is on
 * if the break is still there. Done under a per-coach lock so two paths cannot both send.
 *
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
const sendReconnectEmailOnce = async ({
  sdk,
  userId,
  now = Date.now(),
  send = postmark.sendTemplateEmail,
}) => {
  if (!postmark.isConfigured() || !postmark.isSendingEnabled()) {
    return { sent: false, reason: 'sending-disabled' };
  }
  if (now - (emailFailedAt.get(userId) || 0) < EMAIL_RETRY_AFTER_MS) {
    return { sent: false, reason: 'retry-later' };
  }

  const outcome = await db.withAdvisoryLock(`nylas-grant-email:${userId}`, async () => {
    // Read again under the lock: another path may have just sent it, or the coach just reconnected.
    const user = await readUser(sdk, userId);
    const privateData = privateDataOf(user);
    if (statusOf(privateData) !== RECONNECT_NEEDED) return { sent: false, reason: 'not-broken' };
    if (privateData.calendarReconnectEmailedAt) return { sent: false, reason: 'already-sent' };

    const profile = user.attributes.profile || {};
    const to = user.attributes.email;
    if (!to) return { sent: false, reason: 'no-address' };

    try {
      await send({
        to,
        templateAlias: CALENDAR_RECONNECT_ALIAS,
        model: buildReconnectEmailModel({
          coachName: profile.firstName || profile.displayName,
          siteUrl: process.env.REACT_APP_MARKETPLACE_ROOT_URL,
        }),
        tag: 'calendar-reconnect',
      });
    } catch (e) {
      emailFailedAt.set(userId, now);
      log.error(e, 'nylas-reconnect-email-failed', { coachId: userId });
      return { sent: false, reason: 'send-failed' };
    }
    emailFailedAt.delete(userId);
    // If this write fails the email went out but is not recorded, so a later tick would send it
    // again. Rare, and a duplicate reminder is the lesser fault than a coach never told.
    await sdk.users.updateProfile({
      id: userId,
      privateData: { calendarReconnectEmailedAt: new Date(now).toISOString() },
    });
    return { sent: true };
  });
  return outcome.locked ? outcome.value : { sent: false, reason: 'locked' };
};

/**
 * Record that a coach's grant no longer works, stop their sessions being bookable, tell them once.
 *
 * Idempotent: a coach already marked is not marked again (and not reported again), so a webhook, the
 * daily check and a redelivery can all call it. A coach whose stored grant is no longer `grantId`
 * (they connected a different account since) is left alone: the broken grant is not theirs now.
 *
 * @returns {Promise<{changed: boolean, reason?: string}>}
 */
const markReconnectNeeded = async ({ sdk, userId, grantId, reason, now = Date.now(), send }) => {
  const outcome = await db.withAdvisoryLock(`nylas-grant-status:${userId}`, async () => {
    const user = await readUser(sdk, userId);
    const privateData = privateDataOf(user);
    if (privateData.nylasGrantId !== grantId) return { changed: false, reason: 'grant-replaced' };
    if (statusOf(privateData) === RECONNECT_NEEDED) return { changed: false, reason: 'already' };

    await sdk.users.updateProfile({
      id: userId,
      privateData: {
        calendarStatus: RECONNECT_NEEDED,
        calendarBrokenAt: new Date(now).toISOString(),
        calendarBrokenReason: reason,
        calendarReconnectEmailedAt: null,
      },
    });
    return { changed: true };
  });
  if (!outcome.locked) return { changed: false, reason: 'locked' };
  const result = outcome.value;

  if (result.changed) {
    // The coach's id and the reason, nothing else: no tokens, no grant secrets, no email address.
    log.error(new Error("A coach's Google Calendar connection stopped working"), SENTRY_CODE, {
      coachId: userId,
      reason,
    });
    // Close the gap at once rather than waiting for the reconcile loop's next minute. The loop does
    // the same for any listing this misses, so a failure here is not fatal.
    await switchOffListings(sdk, userId).catch(e =>
      log.error(e, 'nylas-grant-expired-switch-off-failed', { coachId: userId })
    );
  }
  if (result.changed || result.reason === 'already') {
    // Idempotent: sends only if this break has no email yet.
    await sendReconnectEmailOnce({ sdk, userId, now, send }).catch(e =>
      log.error(e, 'nylas-reconnect-email-failed', { coachId: userId })
    );
  }
  return result;
};

/** The coach reconnected (or Nylas says the grant works again): back to connected, ready for a new break. */
const clearReconnectNeeded = async ({ sdk, userId }) => {
  await sdk.users.updateProfile({
    id: userId,
    privateData: {
      calendarStatus: CONNECTED,
      calendarBrokenAt: null,
      calendarBrokenReason: null,
      calendarReconnectEmailedAt: null,
    },
  });
};

/**
 * For the reconcile loop, once per coach per tick, for a coach already marked reconnect_needed: if
 * Nylas says the grant works again, clear the mark (so their sessions become bookable on this very
 * tick, with no second email); otherwise make sure the one email has gone out.
 *
 * @param {object} p
 * @param {object} p.sdk Integration SDK
 * @param {string} p.userId
 * @param {object} p.privateData the coach's private data as the loop read it
 * @returns {Promise<{cleared: boolean}>}
 */
const reviewBrokenCoach = async ({ sdk, userId, privateData, now, send, request }) => {
  const health = await fetchGrantHealth(privateData.nylasGrantId, { request });
  if (health.state === 'valid') {
    await clearReconnectNeeded({ sdk, userId });
    return { cleared: true };
  }
  await sendReconnectEmailOnce({ sdk, userId, now, send });
  return { cleared: false };
};

/**
 * A Nylas `grant.expired` or `grant.deleted` notification. Finds the coach whose stored grant it is
 * (a grant we no longer hold, or one that is not ours, is acknowledged and ignored).
 *
 * Throws when the Integration API is not configured, so Nylas redelivers rather than the break being
 * lost; the daily check is the second net.
 */
const handleGrantWebhook = async ({
  trigger,
  grantId,
  now = Date.now(),
  send,
  finder = findCoachByGrantId,
}) => {
  if (!grantId) return { handled: false, reason: 'no-grant-id' };
  const sdk = integration.getIntegrationSdk();
  if (!sdk) throw new Error('Integration API credentials are not configured');

  const user = await finder(sdk, grantId);
  if (!user) return { handled: false, reason: 'grant-not-held' };

  const result = await markReconnectNeeded({
    sdk,
    userId: user.id.uuid,
    grantId,
    reason: trigger,
    now,
    send,
  });
  return {
    handled: true,
    action: result.changed ? 'reconnect-needed' : `unchanged-${result.reason}`,
  };
};

/** For tests: forget which sends failed recently. */
const resetEmailBackoff = () => emailFailedAt.clear();

module.exports = {
  resetEmailBackoff,
  CONNECTED,
  RECONNECT_NEEDED,
  statusOf,
  fetchGrantHealth,
  usersWithGrants,
  findCoachByGrantId,
  switchOffListings,
  sendReconnectEmailOnce,
  markReconnectNeeded,
  clearReconnectNeeded,
  reviewBrokenCoach,
  handleGrantWebhook,
  privateDataOf,
};
