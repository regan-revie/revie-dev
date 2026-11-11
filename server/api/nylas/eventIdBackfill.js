/**
 * Find the calendar event of bookings that have none recorded.
 *
 * The coach deleting a session's event is recognised by the event id stored when the booking is
 * made (calendarEventSync.js). Two kinds of booking lack one: those made before it was stored, and
 * any whose creation call did not return it (the booking was confirmed by the webhook alone). This
 * asks Nylas for the booking, whose `event_id` is the missing piece, a few at a time from the
 * sweeper's tick, until every active upcoming booking has one.
 *
 * A booking that cannot be resolved is left alone for an hour rather than asked about every minute.
 */

const db = require('./db');
const integration = require('./integration');
const { getBooking } = require('./availability');
const { resolveBookingTarget } = require('./manageBookingShared');

const RETRY_AFTER_MS = 60 * 60 * 1000;
const failedAt = new Map();

/**
 * @returns {Promise<{checked: number, resolved: number, failed: number}>}
 */
const resolveMissingEventIds = async ({ limit = 10, now = Date.now() } = {}) => {
  if (!db.isAvailable() || !integration.isConfigured())
    return { checked: 0, resolved: 0, failed: 0 };

  const rows = (await db.findBookingsMissingEvent(limit)).filter(
    row => now - (failedAt.get(row.nylas_booking_id) || 0) >= RETRY_AFTER_MS
  );
  const summary = { checked: rows.length, resolved: 0, failed: 0 };

  for (const row of rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { tx, listing, booking } = await integration.loadTransactionAsOperator(
        row.sharetribe_transaction_id
      );
      const { configurationId } = resolveBookingTarget({ tx, listing, booking });
      if (!configurationId) throw new Error('no configuration for this booking');

      // eslint-disable-next-line no-await-in-loop
      const found = await getBooking({ configurationId, bookingId: row.nylas_booking_id });
      if (!found || !found.event_id) throw new Error('the booking has no event id');

      // eslint-disable-next-line no-await-in-loop
      await db.recordBookingEvent({
        nylasBookingId: row.nylas_booking_id,
        nylasEventId: found.event_id,
        nylasGrantId: row.nylas_grant_id,
      });
      summary.resolved += 1;
    } catch (e) {
      failedAt.set(row.nylas_booking_id, now);
      summary.failed += 1;
      console.error(
        `[nylas] Could not find the calendar event of booking ${row.nylas_booking_id}: ${e.message}`
      );
    }
  }
  return summary;
};

module.exports = { resolveMissingEventIds };
