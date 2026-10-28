/**
 * Makes sure a paid calendar booking actually ends up on the coach's calendar - or is declined so the
 * client's card is never charged for a session that does not exist.
 *
 * The problem this solves: a client pays (transaction -> `preauthorized`), and only then does anything
 * ask Nylas to create the booking. If that call fails, nothing ever runs `operator-accept`, the card
 * authorisation just sits there, and (before this) the coach was shown an "Accept request" button
 * for a session that is not on their calendar. See docs/decisions.md, "Booking failure after payment
 * releases the hold".
 *
 * ensureBooking() is the one routine behind both entry points - the browser's call right after
 * payment (createBookingEndpoint.js) and the sweeper timer (server/jobs/bookingSweeper.js, for a
 * closed tab or a crashed worker):
 *
 *   1. Win the Postgres claim for this transaction, or stop: only one worker may act at a time.
 *   2. Up to two attempts to create the Nylas booking. Only a failure that could be a blip (network,
 *      429, 5xx) is retried; anything else ("that slot was just taken", a bad key) will fail
 *      identically again.
 *   3. If it still failed, wait briefly for a late `booking.created` webhook. A request can time
 *      out after Nylas actually created the booking, and the webhook is how we find out.
 *   4. Only then run `transition/operator-decline`, which refunds in full and releases the card
 *      authorisation, and report to Sentry.
 *
 * The reverse race - the webhook arrives after we have declined - is handled by
 * cancelIfDeclined(), called from bookingSync.js: it cancels the orphaned Nylas booking.
 */

const db = require('./db');
const integration = require('./integration');
const { createBooking, cancelBooking } = require('./availability');
const { resolveBookingTarget } = require('./manageBookingShared');
const { TRANSACTION_FIELD } = require('./scheduler');
const { describeBookedEvent } = require('./eventDescription');
const log = require('../../log');

/** Exposed so tests can run without real waits. */
const settings = {
  maxAttempts: 2,
  retryDelayMs: 2000,
  graceMs: 10000,
  graceStepMs: 1000,
  lockSeconds: 90,
  // When declining itself fails, how long until the sweeper may try again.
  declineRetrySeconds: 30,
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Whether a failure is worth retrying. A Nylas HTTP error with a status like 409/422 ("slot taken")
 * or 401 (bad key) will repeat exactly; no status at all means the request never got an answer
 * (network, timeout, or minting the session failed), and 408/429/5xx are the server asking us to
 * come back.
 */
const isTransient = e => {
  const status = e && e.status;
  return !status || status === 408 || status === 429 || status >= 500;
};

const ACCEPTED_TRANSITIONS = ['transition/operator-accept', 'transition/accept'];

/** Wait up to graceMs for the booking.created webhook to record a booking for this transaction. */
const waitForWebhookBooking = async transactionId => {
  const steps = Math.max(0, Math.ceil(settings.graceMs / settings.graceStepMs));
  for (let i = 0; i <= steps; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await db.findByTransactionId(transactionId);
    if (rows && rows.length > 0) return true;
    // eslint-disable-next-line no-await-in-loop
    if (i < steps) await sleep(settings.graceStepMs);
  }
  return false;
};

/**
 * @param {object} params
 * @param {string} params.transactionId
 * @param {'browser'|'sweeper'} [params.source] only for the logs
 * @returns {Promise<{outcome: 'booked'|'declined'|'already-resolved'|'busy'|'not-calendar'|'unavailable'|'error', detail?: string}>}
 */
const ensureBooking = async ({ transactionId, source = 'unknown' }) => {
  if (!db.isAvailable() || !integration.isConfigured()) return { outcome: 'unavailable' };

  const claim = await db.claimBookingAttempt(transactionId, settings.lockSeconds);
  if (!claim) {
    // Either another worker holds the lock right now, or this transaction is already settled.
    const row = await db.getBookingAttempt(transactionId);
    return row && row.status !== 'pending'
      ? { outcome: 'already-resolved', detail: row.status }
      : { outcome: 'busy' };
  }

  let attempts = claim.attempts || 0;
  let lastError = claim.last_error ? new Error(claim.last_error) : null;

  try {
    const {
      tx,
      listing,
      booking,
      customer,
      provider,
    } = await integration.loadTransactionAsOperator(transactionId);

    // Not paid-and-waiting any more: something else already settled it.
    const lastTransition = tx.attributes.lastTransition;
    if (lastTransition !== 'transition/confirm-payment') {
      const accepted = ACCEPTED_TRANSITIONS.includes(lastTransition);
      await db.finishBookingAttempt(transactionId, accepted ? 'booked' : 'closed');
      return { outcome: 'already-resolved', detail: lastTransition };
    }

    // A transaction on a listing that does not use calendar booking is not ours to touch: there it
    // is still the provider who accepts.
    if (!listing?.attributes?.publicData?.calendarBookingEnabled) {
      await db.finishBookingAttempt(transactionId, 'closed');
      return { outcome: 'not-calendar' };
    }

    // The webhook may already have recorded a booking (the browser's call and the webhook can
    // finish in either order). operator-accept is the webhook's job, so there is nothing to do.
    const existing = await db.findByTransactionId(transactionId);
    if (existing && existing.length > 0) {
      await db.finishBookingAttempt(transactionId, 'booked');
      return { outcome: 'booked', detail: 'recorded-by-webhook' };
    }

    const target = resolveBookingTarget({ tx, listing, booking });
    const customerEmail = customer?.attributes?.email;
    const guest = {
      name: customer?.attributes?.profile?.displayName || customerEmail,
      email: customerEmail,
    };

    if (!target.configurationId || !target.start || !target.end || !customerEmail) {
      // Retrying cannot fix missing data. Go straight to the decline below.
      lastError = new Error(
        'Cannot create the booking: missing ' +
          [
            !target.configurationId && 'configuration',
            !target.start && 'start',
            !target.end && 'end',
            !customerEmail && 'customer email',
          ]
            .filter(Boolean)
            .join(', ')
      );
      attempts = settings.maxAttempts;
    }

    while (attempts < settings.maxAttempts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const created = await createBooking({
          configurationId: target.configurationId,
          start: target.start,
          end: target.end,
          guest,
          additionalFields: { [TRANSACTION_FIELD]: transactionId },
        });
        // eslint-disable-next-line no-await-in-loop
        await db.finishBookingAttempt(transactionId, 'booked');
        // eslint-disable-next-line no-await-in-loop
        await describeBookedEvent({
          grantId: provider?.attributes?.profile?.privateData?.nylasGrantId,
          calendarId: listing?.attributes?.publicData?.nylasCalendarId,
          eventId: created?.event_id,
          clientName: guest.name,
          transactionId,
        });
        return { outcome: 'booked', detail: created?.booking_id || created?.id || source };
      } catch (e) {
        lastError = e;
        // eslint-disable-next-line no-await-in-loop
        const row = await db.recordAttemptFailure(transactionId, e.message);
        attempts = row ? row.attempts : attempts + 1;
        if (!isTransient(e)) break;
        // eslint-disable-next-line no-await-in-loop
        if (attempts < settings.maxAttempts) await sleep(settings.retryDelayMs);
      }
    }

    // Still no booking. A request can time out after Nylas created the booking, and the webhook is
    // the only way we would hear about it, so give it a moment before giving up on the session.
    if (await waitForWebhookBooking(transactionId)) {
      await db.finishBookingAttempt(transactionId, 'booked');
      return { outcome: 'booked', detail: 'recorded-by-webhook' };
    }

    const decline = await integration.applyTransition(transactionId, 'transition/operator-decline');

    if (decline.ok) {
      await db.finishBookingAttempt(transactionId, 'declined');
      // Sentry is where Regan is alerted (an alert rule on this code emails her).
      log.error(
        lastError || new Error('Booking creation failed'),
        'nylas-booking-failed-declined',
        { transactionId, attempts, source, lastStatus: lastError && lastError.status }
      );
      return { outcome: 'declined' };
    }

    if (decline.alreadyApplied) {
      // The transaction left `preauthorized` while we were working: most likely the webhook landed
      // and accepted it. Look at where it is now rather than guess.
      const fresh = await integration.loadTransactionAsOperator(transactionId);
      const accepted = ACCEPTED_TRANSITIONS.includes(fresh.tx.attributes.lastTransition);
      await db.finishBookingAttempt(transactionId, accepted ? 'booked' : 'closed');
      return { outcome: 'already-resolved', detail: fresh.tx.attributes.lastTransition };
    }

    // Declining itself failed. Release the claim so the sweeper tries again shortly, and shout.
    await db.finishBookingAttempt(transactionId, 'pending', settings.declineRetrySeconds);
    log.error(decline.error || new Error('Decline failed'), 'nylas-decline-failed', {
      transactionId,
      attempts,
      source,
    });
    return { outcome: 'error', detail: 'decline-failed' };
  } catch (e) {
    // Anything unexpected (Sharetribe unreachable, database hiccup). Release the claim so the
    // sweeper retries, rather than leaving the transaction locked until the lock expires.
    log.error(e, 'nylas-booking-recovery-error', { transactionId, source });
    try {
      await db.finishBookingAttempt(transactionId, 'pending', settings.declineRetrySeconds);
    } catch (releaseError) {
      log.error(releaseError, 'nylas-booking-recovery-release-failed', { transactionId });
    }
    return { outcome: 'error', detail: e.message };
  }
};

/**
 * Called by the webhook handler when operator-accept was refused because the transaction had
 * already left `preauthorized`. If it was declined by ensureBooking() while a booking was in flight,
 * a real Nylas booking now exists on the coach's calendar for a session that will never happen:
 * cancel it.
 *
 * Never throws: the webhook must still be acknowledged, and a failure here is logged for a human.
 *
 * @returns {Promise<boolean>} true if an orphaned booking was cancelled
 */
const cancelIfDeclined = async ({ transactionId, bookingId }) => {
  try {
    const { tx, listing, booking } = await integration.loadTransactionAsOperator(transactionId);
    if (tx.attributes.lastTransition !== 'transition/operator-decline') return false;

    const { configurationId } = resolveBookingTarget({ tx, listing, booking });
    if (!configurationId) throw new Error('No Nylas configuration to cancel the orphaned booking');

    await cancelBooking({ configurationId, bookingId });
    await db.setStatus(bookingId, 'orphan-cancelled');
    log.error(
      new Error('A Nylas booking was created after its transaction was declined; it was cancelled'),
      'nylas-orphan-booking-cancelled',
      { transactionId, bookingId }
    );
    return true;
  } catch (e) {
    log.error(e, 'nylas-orphan-booking-cleanup-failed', { transactionId, bookingId });
    return false;
  }
};

module.exports = { ensureBooking, cancelIfDeclined, isTransient, settings };
