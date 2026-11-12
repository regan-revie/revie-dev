/**
 * Keeps Sharetribe's booking on the session's real time after a reschedule (process release-6).
 *
 * A reschedule is made in Nylas first; our database takes the new time from the `booking.rescheduled`
 * notice. Sharetribe's own booking would stay on the original time, and that matters for money: the
 * payout (`transition/complete`) and the review windows are timed off the booking, and Sharetribe
 * still holds the original slot. Release-6 adds `transition/update-booking` (accepted -> accepted,
 * operator) which runs `:action/update-booking`; this module runs it. Verified on Dev that the payout
 * timer then follows the new time.
 *
 * Two entry points, one rule:
 *  - bookingSync.js calls `applyBookingTime` when the notice arrives. It throws on a failure that a
 *    retry could fix, so the webhook answers 500 and Nylas delivers it again.
 *  - the sweeper tick calls `reconcileBookingTimes`, which re-checks recently moved bookings in case
 *    the notice was processed while Sharetribe was unavailable and never redelivered.
 *
 * Transactions on an older process (release-5 and before) have no such transition. Sharetribe
 * answers 409, which looks the same as "not allowed from this state", so that case is reported as
 * `not-applicable` and not retried.
 */

const log = require('../../log');
const db = require('./db');
const integration = require('./integration');

const UPDATE_TRANSITION = 'transition/update-booking';
/** Transitions the transaction can be at while the session is still to come. */
const LIVE_TRANSITIONS = ['transition/operator-accept', UPDATE_TRANSITION];

const sameTime = (a, b) => {
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1000;
};

/** Sharetribe's "that time is not available" conflict, as opposed to any other 409. */
const isTimeConflict = error => {
  const errors = (error && error.data && error.data.errors) || [];
  return errors.some(e => /booking-time|not-available|availability/i.test(String(e.code || '')));
};

/**
 * Move the transaction's Sharetribe booking to [start, end] unless it is already there.
 *
 * @returns {Promise<{outcome: 'already'|'updated'|'not-applicable'|'conflict', lastTransition?: string}>}
 * @throws on anything a retry could fix
 */
const syncSharetribeBookingTime = async ({ transactionId, start, end }) => {
  const { tx, booking } = await integration.loadTransactionAsOperator(transactionId);
  const lastTransition = tx && tx.attributes && tx.attributes.lastTransition;

  if (
    booking &&
    sameTime(booking.attributes.start, start) &&
    sameTime(booking.attributes.end, end)
  ) {
    return { outcome: 'already', lastTransition };
  }

  const result = await integration.applyTransition(transactionId, UPDATE_TRANSITION, {
    bookingStart: new Date(start),
    bookingEnd: new Date(end),
  });
  if (result.ok) return { outcome: 'updated', lastTransition };
  if (result.alreadyApplied) {
    return {
      outcome: isTimeConflict(result.error) ? 'conflict' : 'not-applicable',
      lastTransition,
    };
  }
  throw result.error;
};

/**
 * What the reschedule webhook runs. Reports to Sentry the two outcomes a person has to look at:
 * `conflict` (Sharetribe thinks the new time is taken) and a refusal while the session is still to
 * come (the transaction is not on release-6, or is in a state the transition cannot run from).
 */
const applyBookingTime = async ({ transactionId, bookingId, start, end }) => {
  const result = await syncSharetribeBookingTime({ transactionId, start, end });

  if (result.outcome === 'conflict') {
    log.error(
      new Error(
        `Sharetribe would not move booking ${bookingId} to its new time: the slot is not available there`
      ),
      'nylas-update-booking-unavailable',
      { transactionId, bookingId }
    );
  } else if (
    result.outcome === 'not-applicable' &&
    LIVE_TRANSITIONS.includes(result.lastTransition)
  ) {
    log.error(
      new Error(
        `Sharetribe refused update-booking for booking ${bookingId}: the transaction is probably on a process before release-6, so its booking, payout and review timing stay on the original time`
      ),
      'nylas-update-booking-refused',
      { transactionId, bookingId, lastTransition: result.lastTransition }
    );
  }
  return result;
};

// Bookings already settled this run (equal, moved, or not possible): looked at once, not every minute.
const settled = new Set();

/**
 * Re-check recently moved bookings. Quiet: what applyBookingTime reports is reported once per
 * process, not every minute.
 *
 * @returns {Promise<{checked: number, updated: number, failed: number}>}
 */
const reconcileBookingTimes = async ({ limit = 20 } = {}) => {
  const summary = { checked: 0, updated: 0, failed: 0 };
  if (!db.isAvailable() || !integration.isConfigured()) return summary;

  const rows = await db.findRecentlyRescheduled(limit);
  for (const row of rows) {
    if (settled.has(row.nylas_booking_id)) continue; // eslint-disable-line no-continue
    summary.checked += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await applyBookingTime({
        transactionId: row.sharetribe_transaction_id,
        bookingId: row.nylas_booking_id,
        start: row.booking_start,
        end: row.booking_end,
      });
      settled.add(row.nylas_booking_id);
      if (result.outcome === 'updated') summary.updated += 1;
    } catch (e) {
      summary.failed += 1;
      log.error(e, 'nylas-booking-time-sync-failed', { bookingId: row.nylas_booking_id });
    }
  }
  return summary;
};

/** For tests. */
const resetSettled = () => settled.clear();

module.exports = {
  UPDATE_TRANSITION,
  syncSharetribeBookingTime,
  applyBookingTime,
  reconcileBookingTimes,
  resetSettled,
};
