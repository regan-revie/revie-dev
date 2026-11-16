/**
 * POST /api/nylas/reschedule-booking
 *
 * Moves an existing booking to a new time in place - same Nylas booking id, same Sharetribe
 * transaction, no new payment and no refund logic. Nylas's hosted reschedule link cannot do this
 * for the same reason its cancel link cannot - see cancelBookingEndpoint.js.
 *
 * Sharetribe's own booking record is immutable once created, so it is left showing the original
 * time; decided with Regan that our own database becomes the authority on when the session
 * actually is. This endpoint only calls Nylas - db.recordBooking() runs in bookingSync.js once the
 * booking.rescheduled webhook confirms it, so there is exactly one place that writes the new time.
 */

const log = require('../../log');
const { createCookieTokenStore, getSdk, handleError } = require('../../api-util/sdk');
const { rescheduleBooking } = require('./availability');
const { isConfigured } = require('./config');
const { loadCalendarBookingTransaction } = require('./manageBookingShared');
const db = require('./db');
const { COACH_CANCELLING } = require('./coachCancelling');
const { canClientReschedule, resolveMinBookingNotice } = require('./scheduler');

const sameTime = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 1000;

// The same move asked for twice (a second request for the same new time reaches the server while the
// first is still with Nylas, or just after it finished and before its notice has updated our row) must
// not go to Nylas twice: the second would be refused, because the first has already taken the slot,
// and the client would see an error for a session that has in fact moved. Found in the Nov 16 test
// logs: every reschedule arrived as two POSTs about 2.3 seconds apart, the first succeeding. So the
// call is shared per transaction and time, kept for a minute after it succeeds, and dropped at once
// if it fails so a retry is a real retry.
const KEEP_AFTER_SUCCESS_MS = 60 * 1000;
const moves = new Map();
const moveOnce = (key, run) => {
  let call = moves.get(key);
  if (!call) {
    call = run();
    moves.set(key, call);
    call.then(
      () => setTimeout(() => moves.delete(key), KEEP_AFTER_SUCCESS_MS).unref(),
      () => moves.delete(key)
    );
  }
  return call;
};

/**
 * What a Nylas failure means for the client, as a stable code the page turns into a sentence.
 * Nylas answers a time it will not take with 400 "The selected timeslot is unavailable"; a booking it
 * has cancelled with a 404 or a message saying so.
 */
const classifyNylasFailure = e => {
  const message = String((e.nylasError && e.nylasError.message) || '');
  if (e.status === 404 || /cancel/i.test(message)) {
    return { status: 409, code: 'booking-cancelled', error: 'This session has been cancelled.' };
  }
  if (e.status === 400 && /unavailable|not available/i.test(message)) {
    return {
      status: 409,
      code: 'reschedule-slot-unavailable',
      error: "That time isn't available any more.",
    };
  }
  return {
    status: 502,
    code: 'reschedule-failed',
    error: 'Could not reschedule the calendar booking',
  };
};

module.exports = async (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Calendar integration is not configured' });
    return;
  }
  if (!db.isAvailable()) {
    res.status(503).json({ error: 'Booking records are not available' });
    return;
  }

  const { transactionId, start, end } = req.body || {};
  if (!transactionId || !start || !end) {
    res.status(400).json({ error: 'transactionId, start and end are required' });
    return;
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    res.status(400).json({ error: 'start and end must be valid dates' });
    return;
  }
  if (endDate <= startDate) {
    res.status(400).json({ error: 'end must be after start' });
    return;
  }
  if (startDate <= new Date()) {
    res.status(400).json({ error: 'start must be in the future' });
    return;
  }

  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);

  try {
    const { configurationId, lengthMinutes, listing } = await loadCalendarBookingTransaction(
      sdk,
      transactionId
    );
    if (!configurationId) {
      res.status(422).json({ error: 'Listing is not set up for calendar booking' });
      return;
    }
    // A reschedule moves the session, it does not resell it: the length was paid for at booking.
    const requestedMinutes = Math.round((endDate - startDate) / 60000);
    if (lengthMinutes && requestedMinutes !== lengthMinutes) {
      res.status(400).json({
        error: `This session is ${lengthMinutes} minutes; the new time is ${requestedMinutes}.`,
      });
      return;
    }

    const mappings = await db.findByTransactionId(transactionId);
    const active = mappings.find(m => m.status !== 'cancelled');
    if (!active) {
      const wasCancelled = mappings.some(m => m.status === 'cancelled');
      res.status(409).json({
        code: wasCancelled ? 'booking-cancelled' : 'no-active-booking',
        error: wasCancelled
          ? 'This session has been cancelled.'
          : 'No active calendar booking found for this transaction',
      });
      return;
    }

    // Already at the requested time: the same request again (see moveOnce), or the page asking for
    // what has just happened. Nothing to do, and not an error. Checked before the 48-hour rule, which
    // looks at the session's *current* start and would otherwise refuse a repeat of a move that
    // landed the session inside it.
    if (sameTime(active.booking_start, startDate) && sameTime(active.booking_end, endDate)) {
      res.status(200).json({ ok: true, alreadyMoved: true });
      return;
    }

    // The coach has deleted the event and the five-minute wait has not ended: the session is about
    // to be cancelled by the coach, so it is not moved.
    if (await db.hasPendingEventCancellation(active.nylas_booking_id)) {
      res.status(409).json(COACH_CANCELLING);
      return;
    }

    // A client may move a session only while cancelling it would still be free (48 hours), measured
    // from the session's real start - our database's time, not Sharetribe's original booking. This
    // is enforced here, not only by the disabled button, which a client could simply bypass. A row
    // with no usable start is refused rather than guessed at.
    let movable = false;
    try {
      movable = canClientReschedule({ bookingStart: active.booking_start });
    } catch (e) {
      movable = false;
    }
    if (!movable) {
      res.status(409).json({
        code: 'reschedule-too-late',
        error: 'This session is less than 48 hours away, so it cannot be moved.',
      });
      return;
    }

    // The new time needs the same notice as any new booking (the listing's own, 24 hours unless the
    // coach chose otherwise). The picker already hides earlier times; this is the check that holds.
    const noticeMinutes = resolveMinBookingNotice(
      listing?.attributes?.publicData?.nylasMinBookingNoticeMinutes
    );
    if (startDate.getTime() < Date.now() + noticeMinutes * 60000) {
      res.status(400).json({
        code: 'reschedule-too-soon',
        error: `The new time needs at least ${noticeMinutes / 60} hours' notice.`,
      });
      return;
    }

    const moved = await moveOnce(
      `${transactionId}|${startDate.getTime()}|${endDate.getTime()}`,
      () =>
        rescheduleBooking({
          configurationId,
          bookingId: active.nylas_booking_id,
          start: startDate,
          end: endDate,
        })
    );

    // Keep the calendar event id current in case moving the session gave it a new one, so the coach
    // deleting it afterwards is still recognised. Best effort; a reschedule never fails for this.
    if (moved && moved.event_id) {
      db.recordBookingEvent({
        nylasBookingId: active.nylas_booking_id,
        nylasEventId: moved.event_id,
        nylasGrantId: active.nylas_grant_id,
      }).catch(e => console.error(`[nylas] Could not refresh the calendar event id: ${e.message}`));
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    if (e.source === 'nylas') {
      // Nylas's own answer is what says why, so it is written down: its error type and message (never
      // the booking's people or times), to the log and to Sentry. Before this the logs said only
      // "failed with status 400".
      const reason = classifyNylasFailure(e);
      log.error(e, 'nylas-reschedule-failed', {
        transactionId,
        nylasStatus: e.status,
        nylasErrorType: e.nylasError && e.nylasError.type,
        nylasErrorMessage: e.nylasError && e.nylasError.message,
        code: reason.code,
      });
      res.status(reason.status).json({ code: reason.code, error: reason.error });
      return;
    }
    if (e.status) {
      handleError(res, e);
      return;
    }
    console.error(
      `[nylas] Booking reschedule failed for transaction ${transactionId}: ${e.message}`
    );
    res.status(502).json({
      code: 'reschedule-failed',
      error: 'Could not reschedule the calendar booking',
    });
  }
};

module.exports.resetMoves = () => moves.clear();
