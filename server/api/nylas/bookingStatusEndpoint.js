/**
 * GET /api/nylas/booking-status?transactionId=...
 *
 * What the client/coach-facing UI should actually display as "when is this session" - our own
 * database's booking_start/booking_end when we have a row, since a reschedule only ever updates
 * there (see bookingSync.js), never on Sharetribe's own immutable booking record. Falls back to
 * Sharetribe's booking dates when there is no row yet (e.g. the create-booking call has not
 * reached Nylas, or landed, yet) or no database configured at all (local dev).
 */

const { createCookieTokenStore, getSdk, handleError } = require('../../api-util/sdk');
const { isConfigured } = require('./config');
const { loadCalendarBookingTransaction } = require('./manageBookingShared');
const db = require('./db');
const { isFreeCancellation } = require('./scheduler');

/** isFreeCancellation throws on a bad time; for display, "unknown" (null) is the honest answer. */
const freeAt = (bookingStart, at) => {
  try {
    return isFreeCancellation({ bookingStart, cancelledAt: at });
  } catch (e) {
    return null;
  }
};

module.exports = async (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Calendar integration is not configured' });
    return;
  }

  const { transactionId } = req.query || {};
  if (!transactionId) {
    res.status(400).json({ error: 'transactionId is required' });
    return;
  }

  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);

  try {
    const { booking } = await loadCalendarBookingTransaction(sdk, transactionId);

    if (db.isAvailable()) {
      const mappings = await db.findByTransactionId(transactionId);
      const active = mappings.find(m => m.status !== 'cancelled');
      if (active) {
        res.status(200).json({
          source: 'database',
          status: active.status,
          bookingStart: active.booking_start,
          bookingEnd: active.booking_end,
          // Whether cancelling right now would be refunded. The 48-hour rule lives in one place
          // (isFreeCancellation), so the confirmation the client sees cannot disagree with the
          // refund the webhook will actually make.
          freeCancellationNow: freeAt(active.booking_start, new Date()),
        });
        return;
      }

      // Newest first, so this is the most recent cancellation. The cancel webhook stamps
      // updated_at, which is when the client cancelled.
      const cancelled = mappings.find(m => m.status === 'cancelled');
      if (cancelled) {
        res.status(200).json({
          source: 'database',
          status: 'cancelled',
          bookingStart: cancelled.booking_start,
          bookingEnd: cancelled.booking_end,
          freeCancellation: freeAt(cancelled.booking_start, cancelled.updated_at),
        });
        return;
      }
    }

    res.status(200).json({
      source: 'sharetribe',
      status: null,
      bookingStart: booking?.attributes?.start ?? null,
      bookingEnd: booking?.attributes?.end ?? null,
    });
  } catch (e) {
    if (e.status) {
      handleError(res, e);
      return;
    }
    console.error(
      `[nylas] Booking status lookup failed for transaction ${transactionId}: ${e.message}`
    );
    res.status(502).json({ error: 'Could not load booking status' });
  }
};
