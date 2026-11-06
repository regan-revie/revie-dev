/**
 * POST /api/nylas/cancel-booking
 *
 * The client-facing cancel action, and the reason it has to exist at all: Nylas's own hosted
 * cancel link (book.nylas.com/us/cancel/:booking_ref, the one in its calendar invite) cannot work
 * for us. The Scheduler configuration is deliberately private (requires_session_auth: true), and
 * that requirement turns out to apply to every /v3/scheduling/* call, not just creating a new
 * booking - confirmed by calling GET /v3/scheduling/bookings/:id with the API key and getting back
 * "Invalid session". The hosted page hits the same wall with no session to offer, and its generic
 * "Scheduling Page is no longer available" is almost certainly that failure with the cause hidden.
 *
 * This only cancels the Nylas booking. It does not touch Sharetribe or decide a refund - that is
 * still the booking.cancelled webhook's job (server/api/nylas/bookingSync.js), unchanged, so the
 * 48-hour refund policy is applied in exactly one place.
 */

const { createCookieTokenStore, getSdk, handleError } = require('../../api-util/sdk');
const { cancelBooking } = require('./availability');
const { isConfigured } = require('./config');
const { loadCalendarBookingTransaction } = require('./manageBookingShared');
const { updateTransactionMetadata } = require('./integration');
const db = require('./db');

module.exports = async (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Calendar integration is not configured' });
    return;
  }
  if (!db.isAvailable()) {
    // Without the mapping there is no way to know which Nylas booking belongs to this
    // transaction - this only ever runs where DATABASE_URL is set (Render), not local dev.
    res.status(503).json({ error: 'Booking records are not available' });
    return;
  }

  const { transactionId } = req.body || {};
  if (!transactionId) {
    res.status(400).json({ error: 'transactionId is required' });
    return;
  }

  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);

  try {
    const { configurationId } = await loadCalendarBookingTransaction(sdk, transactionId);
    if (!configurationId) {
      res.status(422).json({ error: 'Listing is not set up for calendar booking' });
      return;
    }

    const mappings = await db.findByTransactionId(transactionId);
    const active = mappings.find(m => m.status !== 'cancelled');
    if (!active) {
      res.status(409).json({ error: 'No active calendar booking found for this transaction' });
      return;
    }

    // Leave a note of who asked, before Nylas is told: the booking.cancelled webhook that follows
    // has no idea whether the client or the coach cancelled, and records it on the transaction if
    // the cancellation turns out to be a late (charged) one. Best effort - a missing note only
    // means the late cancellation is attributed to the coach.
    const note = await updateTransactionMetadata(transactionId, { cancelRequestedBy: 'customer' });
    if (!note.ok) {
      console.error(
        `[nylas] Could not note cancel requester for ${transactionId}: ${note.error.message}`
      );
    }

    try {
      await cancelBooking({ configurationId, bookingId: active.nylas_booking_id });
    } catch (e) {
      // Nylas refused, so nobody cancelled: do not leave the note to be misread by a later
      // cancellation made from the coach's calendar.
      if (note.ok) await updateTransactionMetadata(transactionId, { cancelRequestedBy: null });
      throw e;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    if (e.status) {
      handleError(res, e);
      return;
    }
    console.error(
      `[nylas] Booking cancellation failed for transaction ${transactionId}: ${e.message}`
    );
    res.status(502).json({ error: 'Could not cancel the calendar booking' });
  }
};
