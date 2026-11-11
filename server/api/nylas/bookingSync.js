/**
 * Turns a verified Nylas booking webhook into the right Sharetribe transition.
 *
 * Kept apart from webhooks.js so the signature verification there - which is security-critical and
 * proven in production - is not disturbed by changes to booking policy.
 *
 * The policy, decided with Regan and recorded in CLAUDE.md:
 *  - booking.created   → confirm the transaction, capturing payment. Coaches do not approve
 *                        bookings; the calendar already said they were free.
 *  - booking.cancelled → a cancellation by the coach (no client note) always refunds, at any time.
 *                        A client cancelling more than 48 hours out is refunded. A client
 *                        cancelling inside 48 hours runs transition/late-cancel (release-4): they
 *                        keep the charge and the coach is paid by a time-triggered payout. On a
 *                        release-3 transaction, which has no such transition, nothing changes in
 *                        Sharetribe and only the metadata records it.
 */

const db = require('./db');
const {
  applyTransition,
  updateTransactionMetadata,
  getTransactionBasics,
  isConfigured: integrationConfigured,
} = require('./integration');
const { isFreeCancellation, TRANSACTION_FIELD } = require('./scheduler');
const { cancelIfDeclined } = require('./bookingRecovery');

/**
 * Pull the Sharetribe transaction id out of a booking payload.
 *
 * Confirmed against Nylas's own mock-payload endpoint (POST /v3/webhooks/mock-payload) and a real
 * webhook delivery: additional fields arrive nested under `booking_info.additional_fields`, not at
 * the top level docs and forum posts suggested. Both a plain object and an array of {name, value}
 * pairs are still accepted here, since the value shape once a real field was populated was not
 * something the mock payload (which only ever showed `null`) could confirm.
 */
const extractTransactionId = data => {
  const fields = data?.booking_info?.additional_fields ?? data?.customFields ?? data?.custom_fields;
  if (!fields) return null;

  if (Array.isArray(fields)) {
    const match = fields.find(
      f => f && (f.name === TRANSACTION_FIELD || f.key === TRANSACTION_FIELD)
    );
    return match?.value ?? null;
  }
  if (typeof fields === 'object') {
    return fields[TRANSACTION_FIELD] ?? null;
  }
  return null;
};

/**
 * Pull the session start time out of a booking payload.
 *
 * Also nested under `booking_info`, confirmed the same way as extractTransactionId above.
 * Nylas sends epoch *seconds*, not milliseconds. Treating one as the other silently puts the
 * session fifty years out and would make every cancellation look free.
 */
const extractBookingStart = data => {
  const raw = data?.booking_info?.start_time ?? data?.start_time ?? data?.startTime ?? data?.start;
  if (raw == null) return null;
  if (typeof raw === 'number') return new Date(raw * 1000);
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

/** Pull the session end time out of a booking payload. Same nesting and epoch-seconds caveat as
 * extractBookingStart above. */
const extractBookingEnd = data => {
  const raw = data?.booking_info?.end_time ?? data?.end_time ?? data?.endTime ?? data?.end;
  if (raw == null) return null;
  if (typeof raw === 'number') return new Date(raw * 1000);
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const extractBookingId = data => data?.booking_id ?? data?.bookingId ?? data?.id ?? null;

/**
 * Apply a verified booking webhook.
 *
 * @returns {Promise<{handled: boolean, reason?: string, action?: string}>}
 */
/** Transitions that mean a late cancellation has already been made on a release-4 transaction. */
const LATE_CANCEL_TRANSITIONS = ['transition/late-cancel', 'transition/complete-late-cancelled'];

/**
 * Write who cancelled (and, for a late cancellation, when) onto the transaction's metadata, which
 * Console shows and both parties receive. The first write wins, so a redelivered webhook never moves
 * the time. Throws on failure so the webhook answers 500 and Nylas delivers it again.
 */
const recordCancellation = async (transactionId, metadata, { cancelledBy, late }) => {
  if (metadata.cancelledBy && (!late || metadata.lateCancelledAt)) return;

  const result = await updateTransactionMetadata(transactionId, {
    cancelledBy,
    ...(late && !metadata.lateCancelledAt ? { lateCancelledAt: new Date().toISOString() } : {}),
  });
  if (!result.ok) throw result.error;
};

/**
 * A client cancelled inside 48 hours: they are charged and the coach is still paid.
 *
 * Release-4 transactions get `transition/late-cancel`, which puts them in their own state (the
 * payout then follows by itself, with no review prompts). A release-3 transaction has no such
 * transition: Sharetribe answers 409, indistinguishable from "already made", so the transaction is
 * re-read to tell the two apart. For release-3 nothing changes in Sharetribe and the metadata
 * written afterwards is all that marks it (the UI reads it from there).
 */
const handleLateCancellation = async (transactionId, metadata) => {
  const result = await applyTransition(transactionId, 'transition/late-cancel');
  if (!result.ok && !result.alreadyApplied) throw result.error;

  if (result.alreadyApplied) {
    const current = await getTransactionBasics(transactionId);
    // Moved on some other way (e.g. a refund) - leave it entirely alone.
    if (
      !LATE_CANCEL_TRANSITIONS.includes(current.lastTransition) &&
      current.lastTransition !== 'transition/operator-accept' &&
      current.lastTransition !== 'transition/complete'
    ) {
      return;
    }
  }
  await recordCancellation(transactionId, metadata, { cancelledBy: 'client', late: true });
};

/**
 * A booking is cancelled, from whichever side, and the money has to follow. Shared by the Scheduler's
 * `booking.cancelled` and by calendarEventSync.js (the coach deleting the event on their own
 * calendar), so both ways in do exactly the same thing.
 *
 * Idempotent: Sharetribe refuses a second transition out of `accepted`, so a notification that
 * arrives twice, or by both routes, refunds once and the second is reported as already done.
 *
 * @param {object} params
 * @param {string} params.bookingId Nylas booking id
 * @param {object} params.mapping the nylas_bookings row
 * @param {object} [params.data] the webhook's booking object, for a start time the row may lack
 */
const processBookingCancelled = async ({ bookingId, mapping, data }) => {
  await db.setStatus(bookingId, 'cancelled');

  const transactionId = mapping.sharetribe_transaction_id;
  const { metadata } = await getTransactionBasics(transactionId);

  // Who cancelled. The client's cancel button leaves `cancelRequestedBy: customer` before it asks
  // Nylas (cancelBookingEndpoint.js); a cancellation without that note can only have come from
  // the coach's own calendar. Decided Nov 5, 2026: a coach cancellation always refunds the client,
  // at any time; only the client's own cancellation inside 48 hours is charged.
  const byClient = metadata.cancelRequestedBy === 'customer';

  let late = false;
  if (byClient) {
    const bookingStart = mapping.booking_start ?? (data && extractBookingStart(data));
    if (!bookingStart) {
      // Refusing to guess: without a start time there is no way to tell a free cancellation from a
      // chargeable one, and picking either silently is a billing dispute nobody notices.
      throw new Error(`Cannot decide refund for booking ${bookingId}: no booking start time`);
    }
    late = !isFreeCancellation({ bookingStart, cancelledAt: new Date() });
  }

  if (late) {
    await handleLateCancellation(transactionId, metadata);
    return { handled: true, action: 'charged-late-cancellation' };
  }

  const result = await applyTransition(transactionId, 'transition/cancel');
  if (!result.ok && !result.alreadyApplied) throw result.error;
  await recordCancellation(transactionId, metadata, {
    cancelledBy: byClient ? 'client' : 'provider',
    late: false,
  });
  return { handled: true, action: result.alreadyApplied ? 'already-cancelled' : 'refunded' };
};

const handleBookingWebhook = async ({ trigger, data, grantId }) => {
  const bookingId = extractBookingId(data);
  if (!bookingId) return { handled: false, reason: 'no-booking-id' };

  if (!db.isAvailable()) return { handled: false, reason: 'no-database' };
  if (!integrationConfigured()) return { handled: false, reason: 'no-integration-credentials' };

  if (trigger === 'booking.created' || trigger === 'booking.pending') {
    const transactionId = extractTransactionId(data);

    // A booking with no transaction id was not made through Revie's checkout - most likely someone
    // used the Nylas scheduling page link directly, which is publicly reachable. There is no
    // payment behind it, so there is nothing to confirm; record it and move on rather than guess.
    if (!transactionId) {
      return { handled: false, reason: 'no-transaction-id' };
    }

    await db.recordBooking({
      nylasBookingId: bookingId,
      sharetribeTransactionId: transactionId,
      nylasGrantId: grantId,
      bookingStart: extractBookingStart(data),
      bookingEnd: extractBookingEnd(data),
      status: trigger === 'booking.created' ? 'created' : 'pending',
    });

    if (trigger === 'booking.pending') return { handled: true, action: 'recorded' };

    const result = await applyTransition(transactionId, 'transition/operator-accept');
    if (result.alreadyApplied) {
      // Normally a redelivered webhook. But it can also mean bookingRecovery.js declined this
      // transaction while the booking was still in flight, leaving a real booking on the coach's
      // calendar for a session that will never happen. Cancel it if so.
      const orphanCancelled = await cancelIfDeclined({ transactionId, bookingId });
      return { handled: true, action: orphanCancelled ? 'orphan-cancelled' : 'already-accepted' };
    }
    if (!result.ok) throw result.error;
    return { handled: true, action: 'accepted' };
  }

  if (trigger === 'booking.cancelled') {
    const mapping = await db.findByBookingId(bookingId);
    if (!mapping) return { handled: false, reason: 'unknown-booking' };
    return processBookingCancelled({ bookingId, mapping, data });
  }

  if (trigger === 'booking.rescheduled') {
    // Rescheduling moves the session without touching the money - no Sharetribe transition, no
    // refund logic, same transaction throughout. But Sharetribe's own booking record is immutable
    // once created, so it cannot show the new time: this database row is what does. Decided with
    // Regan - the client/coach-facing "when is this session" surfaces are meant to read from here,
    // not from Sharetribe's now-stale record.
    const mapping = await db.findByBookingId(bookingId);
    if (!mapping) {
      // Same reasoning as the no-transaction-id case above: a reschedule notification for a
      // booking we never recorded did not come from Revie's checkout.
      return { handled: false, reason: 'unknown-booking' };
    }

    await db.recordBooking({
      nylasBookingId: bookingId,
      sharetribeTransactionId: mapping.sharetribe_transaction_id,
      nylasGrantId: mapping.nylas_grant_id,
      bookingStart: extractBookingStart(data) ?? mapping.booking_start,
      bookingEnd: extractBookingEnd(data) ?? mapping.booking_end,
      status: 'rescheduled',
    });
    return { handled: true, action: 'rescheduled' };
  }

  return { handled: false, reason: 'unhandled-trigger' };
};

module.exports = {
  TRANSACTION_FIELD,
  extractTransactionId,
  extractBookingStart,
  extractBookingEnd,
  extractBookingId,
  handleBookingWebhook,
  processBookingCancelled,
};
