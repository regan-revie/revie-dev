/**
 * Session reminders and reschedule confirmations, sent through Postmark.
 *
 * Everything is a row in Postgres (`session_emails`), never a timer in memory, and the existing
 * sweeper tick (server/jobs/) sends what is due, so a restart or a second worker cannot lose or
 * double an email.
 *
 *  - A reminder goes to the client and to the coach 24 hours before a confirmed session. A booking
 *    made less than 24 hours ahead gets none.
 *  - Moving the session cancels its pending reminders and queues new ones from the new time, and
 *    sends both people a confirmation of the change.
 *  - Cancelling it, from any side and by any route (our button, the Scheduler, the coach deleting
 *    the calendar event and the five-minute wait ending), cancels everything still pending.
 *
 * Each email has a key made of what it is, the booking, the recipient and the session time it was
 * for, so asking for the same one twice does nothing. Claiming marks a row `sending` before anything
 * is sent and nothing ever picks a `sending` row up again, so an email is sent at most once: if a
 * worker dies mid-send, that one is not repeated (and is visible in the table as stuck `sending`).
 * A send that fails cleanly is put back and tried on the next tick, three tries in all.
 *
 * Sending is off unless POSTMARK_SENDING_ENABLED=true (server/email/postmark.js). Scheduling goes on
 * regardless, so switching it on later finds the reminders ready. Logs carry ids and the recipient's
 * domain, never a body or an address.
 */

const log = require('../../log');
const db = require('./db');
const integration = require('./integration');
const { nylasRequest } = require('./client');
const postmark = require('../../email/postmark');
const { buildSessionEmailModel } = require('./sessionEmailModel');
const { TEMPLATE_ALIASES } = require('../../email/templates');

const HOUR = 60 * 60 * 1000;
const REMINDER_LEAD_MS = 24 * HOUR;
// Too close to the session for a reminder to still be a reminder.
const TOO_LATE_MS = 2 * HOUR;
// A reschedule confirmation that has waited this long (sending was off, or down) is no longer news.
const CONFIRMATION_STALE_MS = 6 * HOUR;
const MAX_ATTEMPTS = 3;
const RECIPIENTS = ['client', 'coach'];
const ACTIVE = ['created', 'rescheduled'];

const iso = value => new Date(value).toISOString();

/** Anything that goes wrong scheduling is logged and swallowed: it must never break a booking. */
const safely = (label, fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (e) {
    console.error(`[postmark] Could not ${label}: ${e.message}`);
    return null;
  }
};

/**
 * Queue the 24-hour reminders for a session. Skipped if the session is less than 24 hours away.
 *
 * @returns {Promise<{queued: number, skipped?: string}>}
 */
const scheduleReminders = async ({ bookingId, sessionStart, now = Date.now() }) => {
  const start = new Date(sessionStart);
  if (!Number.isFinite(start.getTime())) return { queued: 0, skipped: 'no-start-time' };

  const sendAt = new Date(start.getTime() - REMINDER_LEAD_MS);
  if (sendAt.getTime() <= now) return { queued: 0, skipped: 'under-24h' };

  let queued = 0;
  for (const recipient of RECIPIENTS) {
    // eslint-disable-next-line no-await-in-loop
    const added = await db.queueSessionEmail({
      dedupeKey: `reminder:${bookingId}:${recipient}:${iso(start)}`,
      kind: 'reminder',
      nylasBookingId: bookingId,
      recipient,
      sendAt,
      sessionStart: start,
    });
    if (added) queued += 1;
  }
  return { queued };
};

/**
 * The session moved: drop the pending reminders, queue new ones from the new time, and queue a
 * confirmation to each person.
 */
const rescheduleEmails = async ({
  bookingId,
  oldStart,
  oldEnd,
  newStart,
  newEnd,
  now = Date.now(),
}) => {
  await db.cancelSessionEmails(bookingId, ['reminder']);
  const reminders = await scheduleReminders({ bookingId, sessionStart: newStart, now });

  const start = new Date(newStart);
  const sameTime = oldStart && new Date(oldStart).getTime() === start.getTime();
  if (!Number.isFinite(start.getTime()) || !oldStart || sameTime) {
    return { reminders, confirmations: 0 };
  }

  let confirmations = 0;
  for (const recipient of RECIPIENTS) {
    // eslint-disable-next-line no-await-in-loop
    const added = await db.queueSessionEmail({
      dedupeKey: `rescheduled:${bookingId}:${recipient}:${iso(start)}`,
      kind: 'rescheduled',
      nylasBookingId: bookingId,
      recipient,
      sendAt: new Date(now),
      sessionStart: start,
      details: {
        oldStart: iso(oldStart),
        oldEnd: oldEnd ? iso(oldEnd) : null,
        newStart: iso(start),
        newEnd: newEnd ? iso(newEnd) : null,
      },
    });
    if (added) confirmations += 1;
  }
  return { reminders, confirmations };
};

/** The booking is cancelled (any way): nothing still pending should go out. */
const cancelBookingEmails = bookingId => db.cancelSessionEmails(bookingId);

/**
 * Queue reminders for confirmed upcoming sessions that never had any (booked before this existed, or
 * the webhook could not queue them). A few per tick.
 */
const backfillReminders = async ({ limit = 20, now = Date.now() } = {}) => {
  const rows = await db.findBookingsMissingReminders(24, limit);
  let queued = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const result = await scheduleReminders({
      bookingId: row.nylas_booking_id,
      sessionStart: row.booking_start,
      now,
    });
    queued += result.queued;
  }
  return { checked: rows.length, queued };
};

// --- sending -----------------------------------------------------------------------------------

/** The Google Meet link of the session's calendar event, or '' if there is none or it cannot be read. */
const meetLinkFor = async ({ bookingId, grantId, calendarId }) => {
  try {
    const eventId = await db.findEventIdForBooking(bookingId);
    if (!eventId || !grantId || !calendarId) return '';
    const event = await nylasRequest(
      `/v3/grants/${encodeURIComponent(grantId)}/events/${encodeURIComponent(
        eventId
      )}?calendar_id=${encodeURIComponent(calendarId)}`
    );
    return (
      (event &&
        event.conferencing &&
        event.conferencing.details &&
        event.conferencing.details.url) ||
      ''
    );
  } catch (e) {
    return ''; // the email goes out without the link rather than not at all
  }
};

/** Everything needed to write one email: who, what and when. */
const loadEmailContext = async ({ row, mapping, now }) => {
  const { tx, listing, customer, provider } = await integration.loadTransactionAsOperator(
    mapping.sharetribe_transaction_id
  );
  const publicData = listing?.attributes?.publicData || {};
  const providerPrivate = provider?.attributes?.profile?.privateData || {};
  const root = String(process.env.REACT_APP_MARKETPLACE_ROOT_URL || '').replace(/\/+$/, '');
  const txId = tx.id.uuid || tx.id;

  const details = row.details || {};
  const start = row.kind === 'rescheduled' ? details.newStart : mapping.booking_start;
  const end =
    row.kind === 'rescheduled' ? details.newEnd || mapping.booking_end : mapping.booking_end;

  const recipientUser = row.recipient === 'coach' ? provider : customer;
  const meetLink = await meetLinkFor({
    bookingId: mapping.nylas_booking_id,
    grantId: mapping.nylas_grant_id,
    calendarId: publicData.nylasCalendarId,
  });

  const model = buildSessionEmailModel({
    recipient: row.recipient,
    sessionName: listing?.attributes?.title || 'your session',
    coachName: provider?.attributes?.profile?.displayName || 'your coach',
    clientName: customer?.attributes?.profile?.displayName || 'your client',
    start,
    end,
    oldStart: row.kind === 'rescheduled' ? details.oldStart : undefined,
    oldEnd: row.kind === 'rescheduled' ? details.oldEnd : undefined,
    coachTimeZone:
      listing?.attributes?.availabilityPlan?.timezone || providerPrivate.bookingHours?.timeZone,
    clientTimeZone: tx?.attributes?.protectedData?.clientTimeZone,
    meetLink,
    manageUrl: `${root}/${row.recipient === 'coach' ? 'sale' : 'order'}/${txId}`,
  });

  return { to: recipientUser?.attributes?.email, model, now };
};

const templateAliasFor = row => TEMPLATE_ALIASES[`${row.kind}-${row.recipient}`];

/**
 * Send what is due. Run every minute from the sweeper's tick.
 *
 * @returns {Promise<{checked: number, sent: number, skipped: number, retried: number, failed: number, disabled?: boolean}>}
 */
const processDueSessionEmails = async ({
  now = Date.now(),
  send = postmark.sendTemplateEmail,
} = {}) => {
  const summary = { checked: 0, sent: 0, skipped: 0, retried: 0, failed: 0 };
  if (!db.isAvailable() || !integration.isConfigured()) return summary;
  // Off, or no token: nothing is claimed, so everything waits untouched until it is switched on.
  if (!postmark.isSendingEnabled() || !postmark.isConfigured())
    return { ...summary, disabled: true };

  const due = await db.claimDueSessionEmails();
  summary.checked = due.length;

  for (const row of due) {
    const bookingId = row.nylas_booking_id;
    let domain = 'unknown';
    try {
      // eslint-disable-next-line no-await-in-loop
      const mapping = await db.findByBookingId(bookingId);

      // Decide whether it is still wanted before spending anything on it.
      let skip = null;
      if (!mapping || !ACTIVE.includes(mapping.status)) skip = 'inactive';
      else if (row.kind === 'reminder') {
        const start = new Date(row.session_start).getTime();
        if (start !== new Date(mapping.booking_start).getTime()) skip = 'moved';
        else if (start - now < TOO_LATE_MS) skip = 'too-late';
      } else if (now - new Date(row.send_at).getTime() > CONFIRMATION_STALE_MS) skip = 'stale';

      if (skip) {
        // eslint-disable-next-line no-await-in-loop
        await db.finishSessionEmail(row.dedupe_key, 'skipped', skip);
        summary.skipped += 1;
        continue; // eslint-disable-line no-continue
      }

      // eslint-disable-next-line no-await-in-loop
      const { to, model } = await loadEmailContext({ row, mapping, now });
      if (!to) throw new Error('the recipient has no email address on record');
      domain = postmark.domainOf(to);

      // eslint-disable-next-line no-await-in-loop
      await send({
        to,
        templateAlias: templateAliasFor(row),
        model,
        tag: row.kind,
      });
      // eslint-disable-next-line no-await-in-loop
      await db.finishSessionEmail(row.dedupe_key, 'sent');
      summary.sent += 1;
      console.log(
        `[postmark] sent ${row.kind} to ${row.recipient} (${domain}) booking=${bookingId}`
      );
    } catch (e) {
      log.error(e, 'postmark-send-failed', {
        kind: row.kind,
        recipient: row.recipient,
        bookingId,
        attempt: row.attempts,
        domain,
      });
      if (row.attempts >= MAX_ATTEMPTS) {
        // eslint-disable-next-line no-await-in-loop
        await db.finishSessionEmail(row.dedupe_key, 'failed', e.message).catch(() => {});
        summary.failed += 1;
      } else {
        // eslint-disable-next-line no-await-in-loop
        await db.retrySessionEmail(row.dedupe_key, e.message).catch(() => {});
        summary.retried += 1;
      }
    }
  }
  return summary;
};

module.exports = {
  scheduleReminders,
  rescheduleEmails,
  cancelBookingEmails,
  backfillReminders,
  processDueSessionEmails,
  // For bookingSync: the same calls that cannot throw.
  safeScheduleReminders: safely('queue reminders', scheduleReminders),
  safeRescheduleEmails: safely('queue reschedule emails', rescheduleEmails),
  safeCancelBookingEmails: safely('cancel session emails', cancelBookingEmails),
  REMINDER_LEAD_MS,
  MAX_ATTEMPTS,
};
