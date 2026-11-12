/**
 * Make sure every upcoming booking has the calendar event id Nylas itself uses for it.
 *
 * The coach deleting a session's event is recognised by an event id stored against the booking
 * (calendarEventSync.js). That id can come from three places: the response to creating the booking,
 * a booking notification (`booking_info.event_id`), or reading the booking back from Nylas. Only the
 * last two are Nylas's own word for it ("verified"). This looks at every active upcoming booking
 * whose id is missing or not yet verified, reads the booking back, and stores what Nylas says, with
 * the grant the booking was made under. It runs a few at a time from the sweeper's tick.
 *
 * A booking whose event cannot be found is tried at most three times, five minutes apart. After that
 * it is given up on, once, with one log line, and stays given up across restarts (the count is in
 * Postgres). Cancelled and past bookings are never looked at.
 */

const db = require('./db');
const integration = require('./integration');
const { getBooking } = require('./availability');
const { resolveBookingTarget } = require('./manageBookingShared');

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MINUTES = 5;

/**
 * Nylas's event id for a booking, read back from Nylas.
 *
 * @param {object} row a nylas_bookings row
 * @returns {Promise<string>} the event id
 * @throws if the booking cannot be read or has no event
 */
const lookupEventId = async row => {
  const { tx, listing, booking } = await integration.loadTransactionAsOperator(
    row.sharetribe_transaction_id
  );
  const { configurationId } = resolveBookingTarget({ tx, listing, booking });
  if (!configurationId) throw new Error('no configuration for this booking');

  const found = await getBooking({ configurationId, bookingId: row.nylas_booking_id });
  if (!found || !found.event_id) throw new Error('the booking has no event id');
  return found.event_id;
};

/**
 * @returns {Promise<{checked: number, resolved: number, failed: number, gaveUp: number}>}
 */
const resolveMissingEventIds = async ({ limit = 10 } = {}) => {
  const summary = { checked: 0, resolved: 0, failed: 0, gaveUp: 0 };
  if (!db.isAvailable() || !integration.isConfigured()) return summary;

  const rows = await db.findBookingsNeedingEventCheck(limit, RETRY_AFTER_MINUTES, MAX_ATTEMPTS);
  summary.checked = rows.length;

  for (const row of rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const eventId = await lookupEventId(row);
      // eslint-disable-next-line no-await-in-loop
      await db.recordBookingEvent({
        nylasBookingId: row.nylas_booking_id,
        nylasEventId: eventId,
        nylasGrantId: row.nylas_grant_id,
        verified: true,
      });
      summary.resolved += 1;
    } catch (e) {
      summary.failed += 1;
      // eslint-disable-next-line no-await-in-loop
      const attempts = await db.recordEventLookupFailure(row.nylas_booking_id).catch(() => 0);
      if (attempts >= MAX_ATTEMPTS) {
        summary.gaveUp += 1;
        // The one and only line about this booking: it is not looked at again.
        console.log(
          `[nylas] Could not find the calendar event of booking ${row.nylas_booking_id} after ${MAX_ATTEMPTS} tries (${e.message}); giving up on it.`
        );
      }
    }
  }
  return summary;
};

module.exports = { resolveMissingEventIds, lookupEventId, MAX_ATTEMPTS };
