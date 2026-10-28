/**
 * Writes the per-booking description onto a calendar event once its booking exists.
 *
 * A Nylas configuration is shared by every booking it serves, so its description cannot name the
 * client or link to their own session. Once a booking is made we know both, and the booking response
 * carries the id of the calendar event it created, so the event is updated with:
 *   - the client's name,
 *   - a link to that session's page in Revie (where change and cancel go through the 48-hour rule),
 *   - the refund policy in one line.
 *
 * Best effort by design. The booking is already on the calendar and paid for; a failure here costs a
 * less informative invite, never a session, so it is reported and swallowed rather than allowed to
 * fail or retry the booking.
 */

const { nylasRequest } = require('./client');
const { bookingEventDescription } = require('./scheduler');
const { manageUrlFor } = require('./listingSync');
const log = require('../../log');

/**
 * @returns {Promise<boolean>} whether the event was updated
 */
const describeBookedEvent = async ({
  grantId,
  calendarId,
  eventId,
  clientName,
  transactionId,
  siteUrl = process.env.REACT_APP_MARKETPLACE_ROOT_URL,
  request = nylasRequest,
}) => {
  // Not an error: older listings predate nylasCalendarId, and the invite still has the
  // configuration's own generic description.
  if (!grantId || !calendarId || !eventId || !/^https?:\/\//.test(String(siteUrl || ''))) {
    return false;
  }

  try {
    await request(
      `/v3/grants/${grantId}/events/${encodeURIComponent(eventId)}?calendar_id=${encodeURIComponent(
        calendarId
      )}`,
      {
        method: 'PUT',
        body: {
          description: bookingEventDescription({
            clientName,
            manageUrl: manageUrlFor(siteUrl, transactionId),
          }),
        },
      }
    );
    return true;
  } catch (e) {
    log.error(e, 'nylas-event-description-failed', { transactionId });
    return false;
  }
};

module.exports = { describeBookedEvent };
