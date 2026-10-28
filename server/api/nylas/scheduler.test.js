jest.mock('./client', () => ({ nylasRequest: jest.fn() }));
const { nylasRequest } = require('./client');
const {
  getEventType,
  defaultCalendarFor,
  buildConfigurationBody,
  syncConfiguration,
  eventTitle,
  configurationDescription,
  bookingEventDescription,
  conferencingFor,
} = require('./scheduler');

const CAL = 'coach@example.com';
const GRANT = 'grant-1';

beforeEach(() => jest.clearAllMocks());

describe('getEventType()', () => {
  it('returns the Revie template keyed by Sharetribe listing type id', () => {
    // The keys are deliberately the Sharetribe listing type ids, so a listing maps to its Nylas
    // configuration without a separate lookup table.
    expect(getEventType('signature-session')).toMatchObject({ title: 'Signature Session' });
  });

  it('returns undefined for an unknown type', () => {
    expect(getEventType('not-a-real-type')).toBeUndefined();
  });
});

describe('defaultCalendarFor()', () => {
  it('prefers the primary calendar', () => {
    const cals = [
      { id: 'other', read_only: false },
      { id: CAL, read_only: false, is_primary: true },
    ];
    expect(defaultCalendarFor(cals).id).toBe(CAL);
  });

  it('never chooses a read-only calendar', () => {
    // A subscribed holiday calendar is read-only and would pass a naive "first result" check,
    // then fail only at booking time when Nylas tried to write the event.
    const cals = [
      { id: 'holidays', read_only: true, is_primary: true },
      { id: CAL, read_only: false },
    ];
    expect(defaultCalendarFor(cals).id).toBe(CAL);
  });

  it('falls back to the first writable calendar when none is primary', () => {
    expect(
      defaultCalendarFor([{ id: 'a', read_only: false }, { id: 'b', read_only: false }]).id
    ).toBe('a');
  });

  it('returns null when there is nothing writable', () => {
    expect(defaultCalendarFor([{ id: 'holidays', read_only: true }])).toBeNull();
    expect(defaultCalendarFor([])).toBeNull();
  });
});

describe('buildConfigurationBody()', () => {
  const MANAGE = 'https://revie.example/inbox/orders';
  const build = overrides =>
    buildConfigurationBody({
      title: 'Find your focus with A Coach',
      description: 'desc',
      durationMinutes: 90,
      manageUrl: MANAGE,
      conferencing: { provider: 'Google Meet', autocreate: {} },
      coachName: 'A Coach',
      coachEmail: CAL,
      calendarId: CAL,
      ...overrides,
    });
  const body = build();

  it('makes the coach the organizer', () => {
    expect(body.participants).toHaveLength(1);
    expect(body.participants[0]).toMatchObject({ name: 'A Coach', email: CAL, is_organizer: true });
  });

  it('reads availability from and writes bookings to the same calendar', () => {
    expect(body.participants[0].availability.calendar_ids).toEqual([CAL]);
    expect(body.participants[0].booking.calendar_id).toBe(CAL);
  });

  it('takes the duration and title it is given, one configuration per session length', () => {
    expect(body.availability.duration_minutes).toBe(90);
    expect(body.event_booking.title).toBe('Find your focus with A Coach');
  });

  it('starts slots every 30 minutes, on the hour and half hour', () => {
    expect(body.availability.interval_minutes).toBe(30);
    expect(body.availability.round_to).toBe(30);
  });

  it('creates a PRIVATE configuration, so nobody can book without going through us', () => {
    // A public configuration is publicly bookable: Nylas hosts a page at book.nylas.com/<slug>
    // and the bookings endpoint accepts unauthenticated requests, so anyone with the id could book
    // a session for free.
    expect(body.requires_session_auth).toBe(true);
  });

  it("hides Nylas's own cancel and reschedule links and points the rest at Revie", () => {
    // Nylas's hosted pages cannot act on a private configuration, and would bypass the 48-hour
    // rule and the refund logic if they could.
    expect(body.scheduler.hide_cancellation_options).toBe(true);
    expect(body.scheduler.hide_rescheduling_options).toBe(true);
    // Nylas insists the URL carries its :booking_ref token, so the Revie link gets it as a query.
    expect(body.scheduler.cancellation_url).toBe(`${MANAGE}?booking=:booking_ref`);
    expect(body.scheduler.rescheduling_url).toBe(`${MANAGE}?booking=:booking_ref`);
  });

  it('asks for conferencing only when the provider can create it', () => {
    expect(body.event_booking.conferencing).toEqual({ provider: 'Google Meet', autocreate: {} });
    expect(build({ conferencing: null }).event_booking).not.toHaveProperty('conferencing');
  });
});

describe('event wording', () => {
  it('titles an event "{session name} with {coach name}"', () => {
    expect(eventTitle('Find your focus', 'Ada Lovelace')).toBe('Find your focus with Ada Lovelace');
  });

  it('falls back to whichever half it has rather than printing "undefined"', () => {
    expect(eventTitle('Find your focus', undefined)).toBe('Find your focus');
    expect(eventTitle(undefined, 'Ada')).toBe('Ada');
    expect(eventTitle()).toBe('Coaching session');
  });

  it('links the configuration description to Revie and states the refund rule', () => {
    const text = configurationDescription('https://revie.example/inbox/orders');
    expect(text).toContain('https://revie.example/inbox/orders');
    expect(text).toMatch(/48 hours/);
  });

  it("names the client and links to that session's own page", () => {
    const text = bookingEventDescription({
      clientName: 'Grace Hopper',
      manageUrl: 'https://revie.example/order/abc',
    });
    expect(text).toContain('Client: Grace Hopper');
    expect(text).toContain('https://revie.example/order/abc');
  });

  it('omits the client line rather than printing "Client: undefined"', () => {
    expect(bookingEventDescription({ manageUrl: 'https://x.example' })).not.toMatch(/Client/);
  });

  it('picks Meet for Google and Teams for Microsoft, and nothing for anyone else', () => {
    expect(conferencingFor('google').provider).toBe('Google Meet');
    expect(conferencingFor('microsoft').provider).toBe('Microsoft Teams');
    expect(conferencingFor('icloud')).toBeNull();
    expect(conferencingFor(undefined)).toBeNull();
  });
});

describe('syncConfiguration()', () => {
  const base = {
    grantId: GRANT,
    eventTypeKey: 'signature-session',
    listingTitle: 'Find your focus',
    manageUrl: 'https://revie.example/inbox/orders',
    coachName: 'A',
    coachEmail: CAL,
    calendarId: CAL,
  };

  it('rejects an event type Revie does not define', async () => {
    await expect(syncConfiguration({ ...base, eventTypeKey: 'invented' })).rejects.toThrow(
      /Unknown Revie event type/
    );
    expect(nylasRequest).not.toHaveBeenCalled();
  });

  it('creates a configuration when the listing has none for this length', async () => {
    nylasRequest.mockResolvedValueOnce({ id: 'cfg-1' });
    const { created, configuration } = await syncConfiguration({ ...base, durationMinutes: 45 });
    expect(created).toBe(true);
    expect(configuration.id).toBe('cfg-1');
    expect(nylasRequest).toHaveBeenLastCalledWith(
      `/v3/grants/${GRANT}/scheduling/configurations`,
      expect.objectContaining({ method: 'POST' })
    );
    const sent = nylasRequest.mock.calls[0][1].body;
    expect(sent.availability.duration_minutes).toBe(45);
    expect(sent.event_booking.title).toBe('Find your focus with A');
  });

  it("updates the listing's own configuration in place when it has one", async () => {
    nylasRequest.mockResolvedValueOnce({ id: 'cfg-existing' });
    const { created, configuration } = await syncConfiguration({
      ...base,
      configurationId: 'cfg-existing',
      durationMinutes: 60,
    });
    expect(created).toBe(false);
    expect(configuration.id).toBe('cfg-existing');
    expect(nylasRequest).toHaveBeenLastCalledWith(
      `/v3/grants/${GRANT}/scheduling/configurations/cfg-existing`,
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('does not look configurations up by title, so two same-named listings cannot collide', async () => {
    nylasRequest.mockResolvedValueOnce({ id: 'cfg-new' });
    await syncConfiguration({ ...base, durationMinutes: 60 });
    expect(nylasRequest).toHaveBeenCalledTimes(1);
  });

  it('creates a fresh configuration if the stored one was deleted in Nylas', async () => {
    nylasRequest
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }))
      .mockResolvedValueOnce({ id: 'cfg-replacement' });
    const { created, configuration } = await syncConfiguration({
      ...base,
      configurationId: 'cfg-deleted',
      durationMinutes: 60,
    });
    expect(created).toBe(true);
    expect(configuration.id).toBe('cfg-replacement');
  });

  it('does not hide any other failure behind a silent re-create', async () => {
    nylasRequest.mockRejectedValueOnce(Object.assign(new Error('bad key'), { status: 401 }));
    await expect(
      syncConfiguration({ ...base, configurationId: 'cfg-x', durationMinutes: 60 })
    ).rejects.toThrow('bad key');
  });
});

describe('scheduling settings', () => {
  const {
    SCHEDULING_DEFAULTS,
    STRIPE_MAX_BOOKING_DAYS,
    clampBookingWindow,
    resolveMinBookingNotice,
  } = require('./scheduler');

  it('converts a coach notice period into the minutes Nylas expects', () => {
    expect(resolveMinBookingNotice(72 * 60)).toBe(4320);
    expect(resolveMinBookingNotice(0)).toBe(0);
  });

  it('falls back to the Revie default when a coach has set nothing', () => {
    // Nylas's own default is 60 minutes, far too little for a session someone must prepare for.
    expect(resolveMinBookingNotice(undefined)).toBe(SCHEDULING_DEFAULTS.minBookingNoticeMinutes);
    expect(resolveMinBookingNotice('nonsense')).toBe(SCHEDULING_DEFAULTS.minBookingNoticeMinutes);
    expect(resolveMinBookingNotice(-5)).toBe(SCHEDULING_DEFAULTS.minBookingNoticeMinutes);
  });

  it('never lets the booking window exceed the Stripe authorisation limit', () => {
    // A booking further out than Stripe will hold the card authorisation would have its payment
    // expire before the session happened.
    expect(clampBookingWindow(365)).toBe(STRIPE_MAX_BOOKING_DAYS);
    expect(clampBookingWindow(45)).toBe(45);
    expect(clampBookingWindow(0)).toBe(1);
    expect(clampBookingWindow(undefined)).toBe(SCHEDULING_DEFAULTS.availableDaysInFuture);
  });

  it('puts both settings in the scheduler block Nylas reads', () => {
    const body = buildConfigurationBody({
      eventType: { title: 'T', description: 'd', durationMinutes: 60 },
      coachName: 'C',
      coachEmail: 'c@e.com',
      calendarId: 'c@e.com',
      minBookingNoticeMinutes: 72 * 60,
      availableDaysInFuture: 120,
    });
    expect(body.scheduler.min_booking_notice).toBe(4320);
    expect(body.scheduler.available_days_in_future).toBe(90);
  });
});

describe('cancellation notice', () => {
  const { SCHEDULING_DEFAULTS } = require('./scheduler');

  it('holds the free-cancellation threshold as platform policy, not a per-coach setting', () => {
    // 48 hours. This is a refund boundary applied by isFreeCancellation(), not something pushed to
    // Nylas as a barrier - see the min_cancellation_notice assertion below.
    expect(SCHEDULING_DEFAULTS.freeCancellationMinutes).toBe(48 * 60);
  });
});

describe('isFreeCancellation()', () => {
  const { isFreeCancellation } = require('./scheduler');
  const START = '2026-06-01T12:00:00Z';
  const hoursBefore = h => new Date(Date.parse(START) - h * 3600000).toISOString();

  it('refunds a cancellation comfortably outside the window', () => {
    expect(isFreeCancellation({ bookingStart: START, cancelledAt: hoursBefore(72) })).toBe(true);
  });

  it('charges a cancellation inside the window', () => {
    expect(isFreeCancellation({ bookingStart: START, cancelledAt: hoursBefore(47) })).toBe(false);
    expect(isFreeCancellation({ bookingStart: START, cancelledAt: hoursBefore(1) })).toBe(false);
  });

  it('treats exactly 48 hours as free', () => {
    // The generous side of an off-by-one on someone's money is the defensible one.
    expect(isFreeCancellation({ bookingStart: START, cancelledAt: hoursBefore(48) })).toBe(true);
  });

  it('charges a cancellation after the session was due to start', () => {
    expect(isFreeCancellation({ bookingStart: START, cancelledAt: hoursBefore(-2) })).toBe(false);
  });

  it('accepts Date objects and epoch milliseconds as well as ISO strings', () => {
    expect(
      isFreeCancellation({
        bookingStart: new Date(START),
        cancelledAt: Date.parse(hoursBefore(72)),
      })
    ).toBe(true);
  });

  it('throws rather than guessing when a time is missing or unparseable', () => {
    // Silently defaulting either way is a billing dispute nobody notices.
    expect(() => isFreeCancellation({ bookingStart: START })).toThrow(/valid bookingStart/);
    expect(() => isFreeCancellation({ bookingStart: 'nonsense', cancelledAt: START })).toThrow();
  });

  it('no longer blocks late cancellation in Nylas', () => {
    const body = buildConfigurationBody({
      eventType: { title: 'T', description: 'd', durationMinutes: 60 },
      coachName: 'C',
      coachEmail: 'c@e.com',
      calendarId: 'c@e.com',
    });
    expect(body.scheduler.min_cancellation_notice).toBe(0);
  });
});
