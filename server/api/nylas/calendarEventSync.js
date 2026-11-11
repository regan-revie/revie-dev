/**
 * The coach cancelling a session by deleting its event from their own calendar.
 *
 * Nylas's `booking.cancelled` only fires for a cancellation made *through* the Scheduler (our cancel
 * button). Deleting the event in Google Calendar is a plain calendar change, reported as `event.*`
 * notifications instead: for Google as `event.updated` with the event's status set to `cancelled`
 * (Google keeps a deleted event as a cancelled one), and `event.deleted` for providers that report it.
 * Both are handled. Without this the booking stayed `accepted`, nothing was refunded and nobody was
 * emailed.
 *
 * A calendar notification arrives for *every* event on *every* connected coach's calendar, so the
 * first thing done is to ask whether the event belongs to a Revie booking. That is decided only by
 * the ids stored when the booking was made (grant id + event id, see db.js), never by title or time:
 * anything that is not ours is dropped before any other work, and a coach's own meetings are never
 * touched. Matching events then take exactly the path `booking.cancelled` takes
 * (bookingSync.processBookingCancelled): a cancellation with no client note is the coach's, which
 * refunds in full at any time, and a notification repeated or arriving by both routes refunds once.
 */

const db = require('./db');
const { nylasRequest } = require('./client');
const { processBookingCancelled } = require('./bookingSync');
const { isConfigured: integrationConfigured } = require('./integration');

// Bookings that can still be cancelled. Anything else (already cancelled, pending, never confirmed)
// is left alone, which is also what makes a repeated notification harmless.
const ACTIVE_STATUSES = ['created', 'rescheduled'];

/** The event's current status from Nylas, for a notification that did not carry one. */
const fetchEventStatus = async ({ grantId, calendarId, eventId }) => {
  try {
    const event = await nylasRequest(
      `/v3/grants/${encodeURIComponent(grantId)}/events/${encodeURIComponent(
        eventId
      )}?calendar_id=${encodeURIComponent(calendarId)}&show_cancelled=true`
    );
    return event && event.status;
  } catch (e) {
    // Gone altogether, for an event we know is ours.
    if (e.status === 404) return 'cancelled';
    throw e;
  }
};

/**
 * @param {object} params
 * @param {string} params.trigger 'event.updated' | 'event.deleted'
 * @param {object} params.data the notification's event object
 * @param {string} [params.grantId]
 * @param {Function} [params.getEventStatus] injected in tests
 * @returns {Promise<{handled: boolean, action?: string, reason?: string}>}
 */
const handleCalendarEvent = async ({
  trigger,
  data,
  grantId,
  getEventStatus = fetchEventStatus,
}) => {
  const eventId = data && data.id;
  const grant = (data && data.grant_id) || grantId;
  if (!eventId || !grant) return { handled: false, reason: 'no-event-id' };

  if (!db.isAvailable()) return { handled: false, reason: 'no-database' };

  // The question that matters, asked first and answered from our own records.
  const mapping = await db.findBookingByEvent(grant, eventId);
  if (!mapping) return { handled: false, reason: 'not-a-revie-booking' };

  if (!integrationConfigured()) return { handled: false, reason: 'no-integration-credentials' };
  if (!ACTIVE_STATUSES.includes(mapping.status)) {
    return { handled: false, reason: 'booking-not-active' };
  }

  let status = trigger === 'event.deleted' ? 'cancelled' : data.status;
  if (!status && data.calendar_id) {
    status = await getEventStatus({ grantId: grant, calendarId: data.calendar_id, eventId });
  }
  if (status !== 'cancelled') return { handled: false, reason: 'event-not-cancelled' };

  const result = await processBookingCancelled({
    bookingId: mapping.nylas_booking_id,
    mapping,
    data,
  });
  return { ...result, via: 'calendar-event' };
};

module.exports = { handleCalendarEvent, ACTIVE_STATUSES };
