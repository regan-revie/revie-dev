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

const { createCookieTokenStore, getSdk, handleError } = require('../../api-util/sdk');
const { rescheduleBooking } = require('./availability');
const { isConfigured } = require('./config');
const { loadCalendarBookingTransaction } = require('./manageBookingShared');
const db = require('./db');
const { canClientReschedule, resolveMinBookingNotice } = require('./scheduler');

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
      res.status(409).json({ error: 'No active calendar booking found for this transaction' });
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

    const moved = await rescheduleBooking({
      configurationId,
      bookingId: active.nylas_booking_id,
      start: startDate,
      end: endDate,
    });

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
    if (e.status) {
      handleError(res, e);
      return;
    }
    console.error(
      `[nylas] Booking reschedule failed for transaction ${transactionId}: ${e.message}`
    );
    res.status(502).json({ error: 'Could not reschedule the calendar booking' });
  }
};
