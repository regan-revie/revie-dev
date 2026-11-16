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
 * Why this is an update at all: Nylas takes a booking's title and description only from the
 * Scheduler configuration (checked in its API reference: no per-booking description, no template
 * variables), and the configuration is shared by every booking, so the client's name and their own
 * session link cannot be set when the booking is made.
 *
 * Two things keep that update from costing anything:
 *  - **No second invitation.** Updating an event makes Google send every guest an "Updated
 *    invitation" email by default, a duplicate of the invitation they have just been sent. The
 *    update passes `notify_participants=false`, so the guest's copy is updated silently. (Microsoft
 *    ignores the setting and always notifies; Google is what coaches use today.) Only `description`
 *    is sent, never conferencing or times, so nothing else is rewritten. A real reschedule is a
 *    different thing, made through the Scheduler (availability.js `rescheduleBooking`), and still
 *    notifies the guest once.
 *  - **Rate limits are waited out.** The update follows the booking by a moment and Nylas/Google
 *    answered some with 429 (Sentry REVIE-PLATFORM-6), so a 429 is retried after a short pause.
 *
 * Best effort by design. The booking is already on the calendar and paid for; a failure here costs a
 * less informative invite, never a session, so it is reported and swallowed rather than allowed to
 * fail or retry the booking.
 */

const { nylasRequest } = require('./client');
const { bookingEventDescription } = require('./scheduler');
const { manageUrlFor } = require('./listingSync');
const log = require('../../log');

// Pauses before the retries of a rate-limited (429) update: three tries in all, about three seconds.
const RETRY_DELAYS_MS = [800, 2000];
const sleepFor = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  sleep = sleepFor,
}) => {
  // Not an error: older listings predate nylasCalendarId, and the invite still has the
  // configuration's own generic description.
  if (!grantId || !calendarId || !eventId || !/^https?:\/\//.test(String(siteUrl || ''))) {
    return false;
  }

  const path = `/v3/grants/${grantId}/events/${encodeURIComponent(
    eventId
  )}?calendar_id=${encodeURIComponent(calendarId)}&notify_participants=false`;
  const body = {
    description: bookingEventDescription({
      clientName,
      manageUrl: manageUrlFor(siteUrl, transactionId),
    }),
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await request(path, { method: 'PUT', body });
      return true;
    } catch (e) {
      if (e && e.status === 429 && attempt < RETRY_DELAYS_MS.length) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(RETRY_DELAYS_MS[attempt]);
      } else {
        log.error(e, 'nylas-event-description-failed', { transactionId });
        return false;
      }
    }
  }
};

module.exports = { describeBookedEvent, RETRY_DELAYS_MS };
