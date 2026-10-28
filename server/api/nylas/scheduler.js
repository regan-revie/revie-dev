/**
 * Nylas Scheduler configuration sync.
 *
 * Requirement #4: Revie defines the event types, coaches choose which to sell. So the templates
 * live here in code, keyed by Sharetribe listing type id, and a configuration is pushed to a
 * coach's Nylas account when they opt in. Coaches never author event types themselves.
 */

const { nylasRequest } = require('./client');

/**
 * Revie's sellable event types, keyed by the Sharetribe listing type id they correspond to.
 * Keeping the keys identical to Sharetribe's listing type ids is what lets a listing be matched to
 * its Nylas configuration without a separate mapping table.
 */
const EVENT_TYPES = {
  'signature-session': {
    title: 'Signature Session',
    description: 'A coaching session booked through Revie.',
    durationMinutes: 60,
  },
};

/**
 * Revie-wide scheduling defaults. Coaches can override the notice period per coach; the rest are
 * platform policy.
 */
const SCHEDULING_DEFAULTS = {
  // How far ahead a client must book, in minutes. Nylas's own default is 60, which is far too
  // little for a coaching session someone has to prepare for.
  minBookingNoticeMinutes: 24 * 60,
  // How far into the future the calendar is bookable, in days. Capped below at
  // STRIPE_MAX_BOOKING_DAYS.
  availableDaysInFuture: 30,
  // The free-cancellation threshold, in minutes: cancel earlier than this and the client is
  // refunded, cancel later and they are charged. Platform policy rather than a coach preference,
  // so deliberately not overridable per coach.
  //
  // NOTE: setting this on the Nylas configuration only *blocks* the cancellation UI inside the
  // window; it moves no money. The refund half is a Sharetribe concern and does not exist yet -
  // the process has no partial or zero refund action anywhere, so every cancellation route it
  // offers issues a full refund whatever the timing. See CLAUDE.md.
  freeCancellationMinutes: 48 * 60,
};

/**
 * Stripe will not hold a card authorisation indefinitely, and the template caps bookings at 90 days
 * for exactly this reason (see dayCountAvailableForBooking in src/config/configStripe.js). Letting a
 * coach open their calendar further would create bookings whose payment authorisation expires before
 * the session happens, so the value is clamped rather than trusted.
 */
const STRIPE_MAX_BOOKING_DAYS = 90;

const clampBookingWindow = days => {
  const n = Number(days);
  // Checked with Number.isFinite rather than a falsy test: 0 is falsy, so `n || default` would
  // silently hand a coach the default window instead of clamping their zero to the minimum.
  if (!Number.isFinite(n)) return SCHEDULING_DEFAULTS.availableDaysInFuture;
  return Math.max(1, Math.min(Math.round(n), STRIPE_MAX_BOOKING_DAYS));
};

const resolveMinBookingNotice = minutes => {
  const n = Number(minutes);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : SCHEDULING_DEFAULTS.minBookingNoticeMinutes;
};

const getEventType = key => EVENT_TYPES[key];

/**
 * The custom field carrying the Sharetribe transaction id through a Nylas booking.
 *
 * Nylas rejects an unrecognised `additional_fields` key at booking-creation time with "Additional
 * field 'x' not found in configuration" - found by trying it, not by reading the docs, which do not
 * spell out that additional fields must be declared on the configuration before a booking can carry
 * one. `metadata` is the field type meant for exactly this: data carried through a booking without
 * being shown to or filled in by the guest, unlike `text`/`email`/etc.
 */
const TRANSACTION_FIELD = 'sharetribeTransactionId';

/** List the calendars on a grant. Requires the calendar.readonly scope. */
const listCalendars = grantId => nylasRequest(`/v3/grants/${grantId}/calendars`);

/**
 * Pick the calendar a coach should sell against when they have not chosen one.
 *
 * Prefers the primary calendar, then the first writable one. Read-only calendars are excluded
 * because Nylas must be able to create booking events on whatever we choose - a subscribed holiday
 * calendar would pass a naive "first result" check and then fail at booking time.
 */
const defaultCalendarFor = calendars => {
  const writable = (calendars || []).filter(c => !c.read_only);
  return writable.find(c => c.is_primary) || writable[0] || null;
};

/** Existing configurations on a grant. */
const listConfigurations = grantId =>
  nylasRequest(`/v3/grants/${grantId}/scheduling/configurations`);

/** "{session name} with {coach name}", as the calendar event and Nylas's emails title it. */
const eventTitle = (listingTitle, coachName) =>
  [listingTitle, coachName].filter(Boolean).length === 2
    ? `${listingTitle} with ${coachName}`
    : listingTitle || coachName || 'Coaching session';

const freeCancellationHours = () => SCHEDULING_DEFAULTS.freeCancellationMinutes / 60;

/**
 * The event description every configuration carries. It cannot name the client - one configuration
 * serves every booking - so it links to the Revie orders page. bookingEventDescription() below
 * replaces it on each event with the client's name and a link to their own session.
 */
const configurationDescription = manageUrl =>
  [
    'Booked through Revie.',
    `Change or cancel this session in Revie: ${manageUrl}`,
    `Cancel more than ${freeCancellationHours()} hours ahead for a full refund; inside that window the session is still charged.`,
  ].join('\n\n');

/** The per-booking description written onto the calendar event once the booking exists. */
const bookingEventDescription = ({ clientName, manageUrl }) =>
  [
    'Booked through Revie.',
    clientName ? `Client: ${clientName}` : null,
    `Change or cancel this session in Revie: ${manageUrl}`,
    `Cancel more than ${freeCancellationHours()} hours ahead for a full refund; inside that window the session is still charged.`,
  ]
    .filter(Boolean)
    .join('\n\n');

/** The conferencing Nylas can auto-create for a grant's provider; null where it cannot. */
const conferencingFor = provider => {
  if (provider === 'google') return { provider: 'Google Meet', autocreate: {} };
  if (provider === 'microsoft') return { provider: 'Microsoft Teams', autocreate: {} };
  return null;
};

const buildConfigurationBody = ({
  title,
  description,
  durationMinutes,
  manageUrl,
  conferencing,
  coachName,
  coachEmail,
  calendarId,
  minBookingNoticeMinutes,
  availableDaysInFuture,
}) => ({
  // Private configuration. This is a security control, not a preference.
  //
  // With requires_session_auth false, Nylas hosts a public booking page at book.nylas.com/<slug>
  // and POST /v3/scheduling/bookings accepts unauthenticated requests - verified, it returns 400 on
  // a bad body rather than 401. Anyone holding a configuration id or slug could therefore book a
  // coaching session for free, bypassing Sharetribe and payment entirely: the coach's calendar
  // would fill up and no money would move.
  //
  // Private instead means availability and booking both require a session id minted through
  // POST /v3/scheduling/sessions, which needs our API key. Our server creates one only once
  // Sharetribe has taken payment, so a booking cannot exist without a paid transaction behind it.
  requires_session_auth: true,
  participants: [
    {
      name: coachName,
      email: coachEmail,
      is_organizer: true,
      // Read availability from, and write the booking to, the calendar the coach sells against.
      availability: { calendar_ids: [calendarId] },
      booking: { calendar_id: calendarId },
    },
  ],
  availability: {
    duration_minutes: durationMinutes,
    // Slots start on the hour and half hour for every session length: a 90-minute session on a
    // strictly hourly grid wastes half an hour, and Live sells 45 and 75 minute sessions.
    // Without round_to Nylas steps from *now*, so slot times are whatever minute the page was
    // loaded - 15:45 one visit, 09:12 the next. Rounding pins them to the grid.
    interval_minutes: 30,
    round_to: 30,
    // Note what is deliberately absent: availability_rules.default_open_hours. Nylas stores the
    // timezone on it and then computes the window as UTC, so a coach asking for 09:00-17:00 local
    // is offered at 02:00 their time, and the offset drifts again at every daylight saving change.
    // Working hours are applied in our own availability endpoint instead - see
    // filterSlotsByOpenHours in availability.js.
  },
  scheduler: {
    // The coach's notice period - "no bookings within the next N hours". 72 hours is 4320.
    min_booking_notice: resolveMinBookingNotice(minBookingNoticeMinutes),
    available_days_in_future: clampBookingWindow(availableDaysInFuture),
    // Deliberately 0: a client may always cancel, so the coach's calendar frees up and they know
    // not to expect anyone. Whether the client is *refunded* is decided by isFreeCancellation()
    // below and enforced by which Sharetribe transition the webhook handler calls - not by blocking
    // Nylas's cancel button, which would leave the coach expecting a client who is not coming.
    min_cancellation_notice: 0,
    // Nylas's own cancel and reschedule links are dead ends for us: the configuration is private,
    // so its hosted page has no session and cannot act. Hide them, and point the URLs that remain
    // at Revie, so every change goes through the 48-hour rule and the refund logic.
    hide_cancellation_options: true,
    hide_rescheduling_options: true,
    // Nylas rejects a URL without its :booking_ref token ("must contain :booking_ref token"), so it
    // rides along as a harmless query parameter on the Revie page.
    cancellation_url: `${manageUrl}?booking=:booking_ref`,
    rescheduling_url: `${manageUrl}?booking=:booking_ref`,
    // Nested under `scheduler`, not top-level: confirmed by probing the live API, since a
    // top-level `additional_fields` is accepted with no error and silently dropped.
    additional_fields: {
      [TRANSACTION_FIELD]: {
        label: 'Sharetribe transaction id',
        type: 'metadata',
        required: false,
      },
    },
  },
  event_booking: {
    title,
    description,
    // Only sent where Nylas can create one (a Google grant gets Meet, a Microsoft grant Teams).
    ...(conferencing ? { conferencing } : {}),
  },
});

/**
 * Create or update one Nylas configuration: one session length for one listing.
 *
 * Updates in place when `configurationId` is given (the listing already carries one), otherwise
 * creates. It no longer matches by title: titles now carry the listing and coach names, and a
 * coach with two listings of the same name must not have one overwrite the other.
 *
 * @returns {Promise<{configuration: object, created: boolean}>}
 */
const syncConfiguration = async ({
  grantId,
  configurationId,
  eventTypeKey,
  listingTitle,
  durationMinutes,
  manageUrl,
  conferencing,
  coachName,
  coachEmail,
  calendarId,
  minBookingNoticeMinutes,
  availableDaysInFuture,
}) => {
  const eventType = getEventType(eventTypeKey);
  if (!eventType) {
    throw new Error(`Unknown Revie event type: ${eventTypeKey}`);
  }

  const body = buildConfigurationBody({
    title: eventTitle(listingTitle || eventType.title, coachName),
    description: configurationDescription(manageUrl),
    durationMinutes: durationMinutes || eventType.durationMinutes,
    manageUrl,
    conferencing,
    coachName,
    coachEmail,
    calendarId,
    minBookingNoticeMinutes,
    availableDaysInFuture,
  });

  if (configurationId) {
    try {
      const updated = await nylasRequest(
        `/v3/grants/${grantId}/scheduling/configurations/${configurationId}`,
        { method: 'PUT', body }
      );
      return { configuration: updated, created: false };
    } catch (e) {
      // A configuration someone deleted in the Nylas dashboard: make a fresh one rather than fail.
      if (e.status !== 404) throw e;
    }
  }

  const created = await nylasRequest(`/v3/grants/${grantId}/scheduling/configurations`, {
    method: 'POST',
    body,
  });
  return { configuration: created, created: true };
};

/**
 * Does a cancellation fall inside the free-cancellation window?
 *
 * This decides money, so it refuses to guess: unparseable or missing times throw rather than
 * defaulting one way. A webhook that throws is retried and surfaced; a webhook that silently picks
 * a refund policy is a billing dispute nobody notices.
 *
 * The boundary is inclusive — cancelling at exactly 48 hours is free — because the generous side of
 * an off-by-one on someone's money is the defensible one.
 *
 * @param {Date|string|number} bookingStart when the session was due to start
 * @param {Date|string|number} cancelledAt when the client cancelled
 * @returns {boolean} true when the client should be refunded
 */
const isFreeCancellation = ({ bookingStart, cancelledAt }) => {
  const start = new Date(bookingStart).getTime();
  const cancelled = new Date(cancelledAt).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(cancelled)) {
    throw new Error('isFreeCancellation needs a valid bookingStart and cancelledAt');
  }

  const noticeMinutes = (start - cancelled) / 60000;
  return noticeMinutes >= SCHEDULING_DEFAULTS.freeCancellationMinutes;
};

module.exports = {
  isFreeCancellation,
  TRANSACTION_FIELD,
  EVENT_TYPES,
  SCHEDULING_DEFAULTS,
  STRIPE_MAX_BOOKING_DAYS,
  clampBookingWindow,
  resolveMinBookingNotice,
  getEventType,
  listCalendars,
  listConfigurations,
  defaultCalendarFor,
  buildConfigurationBody,
  syncConfiguration,
  eventTitle,
  configurationDescription,
  bookingEventDescription,
  conferencingFor,
};
