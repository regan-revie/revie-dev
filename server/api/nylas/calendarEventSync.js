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
 * touched.
 *
 * A match does NOT cancel straight away. Deleting an event is easy to do by accident and Google lets
 * the coach undo it, so the notice only starts a five-minute wait (a row in Postgres, see db.js, so a
 * restart or deploy cannot lose it). When it is up, `processDueEventCancellations` (run from the
 * sweeper's tick) reads the event again from Nylas: still cancelled or gone, and the booking takes
 * exactly the path `booking.cancelled` takes (bookingSync.processBookingCancelled): a cancellation
 * with no client note is the coach's, which refunds in full at any time, and a notification repeated
 * or arriving by both routes refunds once. Back (undone), and nothing happens, logged once. A real
 * `booking.cancelled` from our own cancel button is not delayed: it never comes through here.
 *
 * Only the coach's calendar is ever watched (the one grant we hold). A client declining the invitation
 * or deleting the event from their own calendar changes their copy and the guest list of the coach's
 * event, whose status stays confirmed, so it is ignored here and cancels nothing.
 */

const log = require('../../log');

const db = require('./db');
const { nylasRequest } = require('./client');
const { processBookingCancelled } = require('./bookingSync');
const { lookupEventId } = require('./eventIdBackfill');
const { isConfigured: integrationConfigured, getTransactionBasics } = require('./integration');

// How long a deletion has to stand before it is believed.
const CANCEL_DELAY_MINUTES = 5;
// A wait whose cancellation failed is tried again after this.
const RETRY_AFTER_SECONDS = 5 * 60;

// Bookings that can still be cancelled. Anything else (already cancelled, pending, never confirmed)
// is left alone, which is also what makes a repeated notification harmless.
const ACTIVE_STATUSES = ['created', 'rescheduled'];
// Where a transaction is once a cancellation has been carried out on it.
const CANCELLED_TRANSITIONS = [
  'transition/cancel',
  'transition/late-cancel',
  'transition/complete-late-cancelled',
];

/** First eight characters of an id, for logs: enough to find it, nothing personal. */
const short = id => String(id || '').slice(0, 8);

// How long after a lookup on a miss before the next one (it asks Nylas about each of a grant's bookings).
const LOOKUP_COOLDOWN_MS = 30 * 1000;
let lastLookupAt = 0;

/**
 * A cancelled or deleted event that matched no stored id: ask Nylas which event each of that grant's
 * upcoming bookings really has. Our stored id is only ever a record of what Nylas told us once; if
 * it is missing, from the wrong source or out of date, the booking's own answer settles it. A booking
 * found is corrected in the table so the next notice matches directly.
 *
 * Only the notice's own grant is ever searched, never other coaches' bookings: the same Google event
 * carries the same id in every guest's copy, so an id seen under another grant (a coach who is
 * someone's client, say) must not be mistaken for the organiser's event.
 *
 * @returns {Promise<object|null>} the nylas_bookings row, or null
 */
const findBookingByLookup = async ({ grant, eventId, now = Date.now() }) => {
  if (now - lastLookupAt < LOOKUP_COOLDOWN_MS) return null;
  lastLookupAt = now;

  const candidates = await db.findActiveBookingsByGrant(grant);
  for (const booking of candidates.slice(0, 20)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const real = await lookupEventId(booking);
      // eslint-disable-next-line no-await-in-loop
      await db.recordBookingEvent({
        nylasBookingId: booking.nylas_booking_id,
        nylasEventId: real,
        nylasGrantId: booking.nylas_grant_id,
        verified: true,
      });
      if (real === eventId) return booking;
    } catch (e) {
      // This booking cannot be read right now; the others still can.
    }
  }
  return null;
};

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

  // A notice that could be a deletion: it says so, or it says nothing about the status. Only those
  // are worth a log line when they match nothing; every other change to every event on every
  // connected calendar would be noise.
  const plainlyCancelled = trigger === 'event.deleted' || data.status === 'cancelled';
  const couldBeCancelled = plainlyCancelled || !data.status;

  // The question that matters, asked first and answered from our own records.
  let mapping = await db.findBookingByEvent(grant, eventId);
  if (!mapping && couldBeCancelled) {
    mapping = await findBookingByLookup({ grant, eventId });
  }
  if (!mapping) {
    if (plainlyCancelled) {
      console.log(
        `[nylas] calendar event did not match any booking (${trigger}, grant ${short(
          grant
        )}, event ${short(eventId)})`
      );
    }
    return { handled: false, reason: 'not-a-revie-booking' };
  }

  if (!integrationConfigured()) return { handled: false, reason: 'no-integration-credentials' };
  if (!ACTIVE_STATUSES.includes(mapping.status)) {
    console.log(
      `[nylas] calendar event matched booking ${short(mapping.nylas_booking_id)}, but it is ${
        mapping.status
      }: nothing to do`
    );
    return { handled: false, reason: 'booking-not-active' };
  }

  let status = trigger === 'event.deleted' ? 'cancelled' : data.status;
  if (!status && data.calendar_id) {
    status = await getEventStatus({ grantId: grant, calendarId: data.calendar_id, eventId });
  }

  if (status === 'cancelled') {
    const started = await db.scheduleEventCancellation({
      nylasBookingId: mapping.nylas_booking_id,
      nylasEventId: eventId,
      nylasGrantId: grant,
      calendarId: data.calendar_id,
      delayMinutes: CANCEL_DELAY_MINUTES,
    });
    const due = new Date(Date.now() + CANCEL_DELAY_MINUTES * 60000);
    const dueText = `${String(due.getUTCHours()).padStart(2, '0')}:${String(
      due.getUTCMinutes()
    ).padStart(2, '0')} UTC`;
    console.log(
      started
        ? `[nylas] calendar event matched booking ${short(
            mapping.nylas_booking_id
          )}, cancel scheduled for ${dueText}`
        : `[nylas] calendar event matched booking ${short(
            mapping.nylas_booking_id
          )}, cancel already scheduled`
    );
    // Already waiting: a repeat of the same notice, which must not push the time back.
    return {
      handled: true,
      action: started ? 'cancellation-scheduled' : 'cancellation-already-scheduled',
    };
  }

  // The event is there and not cancelled. If a wait was running, the coach has undone the deletion:
  // end it now rather than leave it to find out in five minutes.
  const restored = await db.markEventRestored(mapping.nylas_booking_id);
  if (restored) return { handled: true, action: 'restored', via: 'calendar-event' };
  return { handled: false, reason: 'event-not-cancelled' };
};

/**
 * Act on the deletions whose wait is over. Run every minute from the sweeper's tick.
 *
 * For each: if the booking is no longer active (our own cancel button got there first, or it was
 * cancelled some other way) there is nothing to do; otherwise the event is read again, and only a
 * still-cancelled (or gone) event cancels the booking. A failure leaves the wait to be retried.
 *
 * @returns {Promise<{checked: number, cancelled: number, restored: number, ignored: number, failed: number}>}
 */
const processDueEventCancellations = async ({ getEventStatus = fetchEventStatus } = {}) => {
  const summary = { checked: 0, cancelled: 0, restored: 0, ignored: 0, failed: 0 };
  if (!db.isAvailable() || !integrationConfigured()) return summary;

  const due = await db.claimDueEventCancellations();
  summary.checked = due.length;

  for (const row of due) {
    const bookingId = row.nylas_booking_id;
    try {
      // eslint-disable-next-line no-await-in-loop
      const mapping = await db.findByBookingId(bookingId);
      // A booking marked cancelled is not necessarily finished: processBookingCancelled marks it before
      // it runs the refund, so a refund that failed leaves it cancelled with the money not yet moved.
      // The transaction itself says whether the cancellation really happened.
      let finished = !mapping || ![...ACTIVE_STATUSES, 'cancelled'].includes(mapping.status);
      if (!finished && mapping.status === 'cancelled') {
        // eslint-disable-next-line no-await-in-loop
        const current = await getTransactionBasics(mapping.sharetribe_transaction_id);
        finished = CANCELLED_TRANSITIONS.includes(current.lastTransition);
      }
      if (finished) {
        // eslint-disable-next-line no-await-in-loop
        await db.finishEventCancellation(bookingId, 'ignored');
        summary.ignored += 1;
        continue; // eslint-disable-line no-continue
      }

      // eslint-disable-next-line no-await-in-loop
      const status = row.calendar_id
        ? await getEventStatus({
            grantId: row.nylas_grant_id,
            calendarId: row.calendar_id,
            eventId: row.nylas_event_id,
          })
        : 'cancelled';

      if (status !== 'cancelled') {
        // Back after all: the coach pressed undo or restored it. Said once, here, as the wait ends.
        console.log(
          `[nylas] calendar event is back after being deleted; no cancellation (booking ${bookingId})`
        );
        // eslint-disable-next-line no-await-in-loop
        await db.finishEventCancellation(bookingId, 'restored');
        summary.restored += 1;
        continue; // eslint-disable-line no-continue
      }

      // eslint-disable-next-line no-await-in-loop
      const result = await processBookingCancelled({ bookingId, mapping, data: null });
      // eslint-disable-next-line no-await-in-loop
      await db.finishEventCancellation(bookingId, 'done');
      summary.cancelled += 1;
      console.log(`[nylas] calendar event deleted, still gone after the wait -> ${result.action}`);
    } catch (e) {
      summary.failed += 1;
      // eslint-disable-next-line no-await-in-loop
      await db.retryEventCancellation(bookingId, RETRY_AFTER_SECONDS).catch(() => {});
      log.error(e, 'nylas-event-cancel-failed', { bookingId });
    }
  }
  return summary;
};

module.exports = {
  handleCalendarEvent,
  processDueEventCancellations,
  fetchEventStatus,
  findBookingByLookup,
  ACTIVE_STATUSES,
  CANCEL_DELAY_MINUTES,
  resetLookupCooldown: () => {
    lastLookupAt = 0;
  },
};
