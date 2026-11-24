// Real bookingSync and calendarEventSync, a stand-in database that behaves like the real one
// (waits that persist, come due and are claimed), a controllable clock, and mocks only for the
// Integration API (Sharetribe), Nylas and Sentry.
jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./integration', () => ({
  isConfigured: jest.fn(),
  applyTransition: jest.fn(),
  updateTransactionMetadata: jest.fn(),
  getTransactionBasics: jest.fn(),
  loadTransactionAsOperator: jest.fn(),
}));
jest.mock('./client', () => ({ nylasRequest: jest.fn() }));
jest.mock('./bookingRecovery', () => ({ cancelIfDeclined: jest.fn() }));
// Reading a booking back from Nylas: what Nylas says each booking's event is (mockNylasEvents).
const mockNylasEvents = {};
jest.mock('./eventIdBackfill', () => ({ lookupEventId: jest.fn() }));

// The "database" lives outside the module registry, so it survives a simulated restart.
const mockStore = { bookings: new Map(), events: new Map(), waits: new Map(), emails: new Map() };
// The calendar the booking's listing sells against (null: none recorded).
const mockOwn = { calendar: 'cal-1' };
jest.mock('./db', () => ({
  isAvailable: jest.fn(() => true),
  findActiveBookingsByGrant: jest.fn(async grant =>
    [...mockStore.bookings.values()].filter(
      b => b.nylas_grant_id === grant && ['created', 'rescheduled'].includes(b.status)
    )
  ),
  recordBookingEvent: jest.fn(async ({ nylasBookingId, nylasEventId, nylasGrantId, verified }) => {
    mockStore.events.set(nylasBookingId, {
      booking: nylasBookingId,
      grant: nylasGrantId,
      event: nylasEventId,
      verified: Boolean(verified),
    });
  }),
  cancelSessionEmails: jest.fn(async () => 2),
  // Like the real one: a key that is already there queues nothing.
  queueSessionEmail: jest.fn(async e => {
    if (mockStore.emails.has(e.dedupeKey)) return false;
    mockStore.emails.set(e.dedupeKey, e);
    return true;
  }),
  // Like the real query: the event row's grant AND the booking's own coach grant must both match.
  findBookingByEvent: jest.fn(async (grant, event) => {
    const e = [...mockStore.events.values()].find(x => x.grant === grant && x.event === event);
    const b = e ? mockStore.bookings.get(e.booking) || null : null;
    return b && b.nylas_grant_id === e.grant ? b : null;
  }),
  findBookingsByEventId: jest.fn(async event =>
    [...mockStore.events.values()]
      .filter(x => x.event === event)
      .map(x => mockStore.bookings.get(x.booking))
      .filter(Boolean)
  ),
  findByBookingId: jest.fn(async id => mockStore.bookings.get(id) || null),
  setStatus: jest.fn(async (id, status) => {
    const b = mockStore.bookings.get(id);
    if (b) b.status = status;
    return b;
  }),
  scheduleEventCancellation: jest.fn(async w => {
    const existing = mockStore.waits.get(w.nylasBookingId);
    if (existing && existing.status === 'pending') return false;
    mockStore.waits.set(w.nylasBookingId, {
      nylas_booking_id: w.nylasBookingId,
      nylas_event_id: w.nylasEventId,
      nylas_grant_id: w.nylasGrantId,
      calendar_id: w.calendarId || null,
      status: 'pending',
      due: Date.now() + w.delayMinutes * 60000,
      lockedUntil: 0,
    });
    return true;
  }),
  markEventRestored: jest.fn(async id => {
    const w = mockStore.waits.get(id);
    if (!w || w.status !== 'pending') return null;
    w.status = 'restored';
    return w;
  }),
  claimDueEventCancellations: jest.fn(async () => {
    const now = Date.now();
    const rows = [...mockStore.waits.values()].filter(
      w => w.status === 'pending' && w.due <= now && w.lockedUntil <= now
    );
    rows.forEach(w => {
      w.lockedUntil = now + 120000;
    });
    return rows;
  }),
  finishEventCancellation: jest.fn(async (id, status) => {
    const w = mockStore.waits.get(id);
    if (w) w.status = status;
    return w;
  }),
  retryEventCancellation: jest.fn(async (id, seconds) => {
    const w = mockStore.waits.get(id);
    if (w && w.status === 'pending') w.lockedUntil = Date.now() + seconds * 1000;
  }),
}));

// Everything is loaded fresh by loadSync(), which is also how a server restart is simulated: new
// module instances with nothing in memory, over the same database.
let log;
let integration;
let nylasRequest;
let db;
const mockTx = { cancelled: false, refunds: 0, metadata: {} };
let eventStatus; // what Nylas says the event is when it is read again

const loadSync = () => {
  jest.resetModules();
  log = require('../../log');
  integration = require('./integration');
  ({ nylasRequest } = require('./client'));
  db = require('./db');

  // Mock implementations do not survive between tests in this setup (or a module reset), so every
  // one is set here.
  db.isAvailable.mockReturnValue(true);
  integration.isConfigured.mockReturnValue(true);
  // A transaction that behaves like Sharetribe's: the first cancel moves it, and a second is refused.
  integration.applyTransition.mockImplementation(async (id, transition) => {
    if (transition !== 'transition/cancel') return { ok: true };
    if (mockTx.cancelled) return { ok: false, alreadyApplied: true };
    mockTx.cancelled = true;
    mockTx.refunds += 1;
    return { ok: true };
  });
  // Metadata behaves like Sharetribe's: keys written are kept and merged.
  integration.updateTransactionMetadata.mockImplementation(async (id, fields) => {
    mockTx.metadata = { ...mockTx.metadata, ...fields };
    return { ok: true };
  });
  integration.getTransactionBasics.mockImplementation(async () => ({
    metadata: mockTx.metadata,
    lastTransition: mockTx.cancelled ? 'transition/cancel' : 'transition/operator-accept',
    payinTotal: { amount: mockTx.cancelled ? 0 : 5000, currency: 'USD' },
  }));
  integration.loadTransactionAsOperator.mockImplementation(async () => ({
    listing: { attributes: { publicData: { nylasCalendarId: mockOwn.calendar } } },
  }));
  nylasRequest.mockImplementation(async () => ({ status: eventStatus }));
  require('./eventIdBackfill').lookupEventId.mockImplementation(async row => {
    const id = mockNylasEvents[row.nylas_booking_id];
    if (!id) throw new Error('the booking has no event id');
    return id;
  });

  return { calendar: require('./calendarEventSync'), booking: require('./bookingSync') };
};

const GRANT = 'grant-1';
const EVENT = 'event-1';
const BOOKING = 'booking-1';
const TX = 'tx-1';
const MINUTE = 60000;

const event = (extra = {}) => ({ id: EVENT, grant_id: GRANT, calendar_id: 'cal-1', ...extra });
const advance = minutes => jest.setSystemTime(Date.now() + minutes * MINUTE);
// How many refunds Sharetribe actually granted (a refused repeat is not a second one).
const refundCalls = () => Array(mockTx.refunds).fill('refund');

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  jest.clearAllMocks();
  mockStore.bookings.clear();
  mockStore.events.clear();
  mockStore.waits.clear();
  mockStore.emails.clear();
  mockStore.bookings.set(BOOKING, {
    nylas_booking_id: BOOKING,
    sharetribe_transaction_id: TX,
    nylas_grant_id: GRANT,
    booking_start: new Date(Date.now() + 5 * 3600000), // inside 48 hours: a coach cancel still refunds
    status: 'created',
  });
  mockStore.events.set(BOOKING, { booking: BOOKING, grant: GRANT, event: EVENT });

  eventStatus = 'cancelled';
  mockOwn.calendar = 'cal-1';
  Object.keys(mockNylasEvents).forEach(k => delete mockNylasEvents[k]);
  mockNylasEvents[BOOKING] = EVENT;
  mockTx.cancelled = false;
  mockTx.refunds = 0;
  mockTx.metadata = {};
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the coach deletes a Revie session's event", () => {
  it('does not cancel at once: it starts a five-minute wait', async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'cancelled' }),
    });

    expect(result).toEqual({ handled: true, action: 'cancellation-scheduled' });
    expect(db.scheduleEventCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        nylasBookingId: BOOKING,
        nylasEventId: EVENT,
        nylasGrantId: GRANT,
        calendarId: 'cal-1',
        delayMinutes: 5,
      })
    );
    expect(integration.applyTransition).not.toHaveBeenCalled();
    expect(mockStore.bookings.get(BOOKING).status).toBe('created');
  });

  it('does the same for event.deleted', async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    expect(result.action).toBe('cancellation-scheduled');
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('still deleted after five minutes: one full refund through the coach-cancel path', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'cancelled' }),
    });

    advance(5);
    const summary = await calendar.processDueEventCancellations();

    expect(summary).toMatchObject({ checked: 1, cancelled: 1, restored: 0, failed: 0 });
    expect(refundCalls()).toHaveLength(1);
    expect(integration.applyTransition).not.toHaveBeenCalledWith(TX, 'transition/late-cancel');
    // The cancellation emails read these, so they are written BEFORE the refund runs: the coach's
    // cancellation, and the amount that is about to go back (50.00, not the 0 left afterwards).
    expect(integration.updateTransactionMetadata).toHaveBeenCalledWith(TX, {
      cancelledBy: 'provider',
      refundAmount: 50,
      refundCurrency: 'USD',
    });
    expect(integration.updateTransactionMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      integration.applyTransition.mock.invocationCallOrder[0]
    );
    expect(mockTx.metadata).toMatchObject({ cancelledBy: 'provider', refundAmount: 50 });
    expect(mockStore.waits.get(BOOKING).status).toBe('done');
    expect(mockStore.bookings.get(BOOKING).status).toBe('cancelled');
  });

  it('is read again from Nylas before anything is cancelled', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    advance(5);
    await calendar.processDueEventCancellations();

    const [path] = nylasRequest.mock.calls[0];
    expect(path).toContain(`/v3/grants/${GRANT}/events/${EVENT}`);
    expect(path).toContain('calendar_id=cal-1');
    expect(path).toContain('show_cancelled=true');
  });

  it('an event that is gone altogether (404) counts as still deleted', async () => {
    nylasRequest.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    advance(5);
    const summary = await calendar.processDueEventCancellations();
    expect(summary.cancelled).toBe(1);
    expect(refundCalls()).toHaveLength(1);
  });

  it('nothing happens before the five minutes are up', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });

    advance(4);
    const summary = await calendar.processDueEventCancellations();

    expect(summary.checked).toBe(0);
    expect(integration.applyTransition).not.toHaveBeenCalled();
    expect(nylasRequest).not.toHaveBeenCalled();
  });
});

describe('when the stored event id is not the one Nylas uses (the failed retest)', () => {
  const logged = () => console.log.mock.calls.flat().map(String);

  it("REPRODUCTION: an id stored at creation that Nylas does not call the event by no longer hides the deletion; the booking's own answer finds it", async () => {
    // What was stored when the booking was made does not match what Nylas puts in its notices.
    mockStore.events.set(BOOKING, {
      booking: BOOKING,
      grant: GRANT,
      event: 'id-from-creation-response',
      verified: false,
    });
    const { calendar } = loadSync();

    // Before: the notice matches nothing and the deletion is silently dropped.
    // Now: Nylas is asked what the booking's event really is, which settles it.
    const result = await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });

    expect(result).toEqual({ handled: true, action: 'cancellation-scheduled' });
    expect(mockStore.events.get(BOOKING)).toMatchObject({
      event: EVENT,
      grant: GRANT,
      verified: true,
    });

    advance(5);
    await calendar.processDueEventCancellations();
    expect(refundCalls()).toHaveLength(1);
  });

  it('and the next notice matches directly, without asking Nylas again', async () => {
    mockStore.events.set(BOOKING, {
      booking: BOOKING,
      grant: GRANT,
      event: 'stale',
      verified: false,
    });
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    const lookup = require('./eventIdBackfill').lookupEventId;
    const calls = lookup.mock.calls.length;

    const again = await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    expect(again.action).toBe('cancellation-already-scheduled');
    expect(lookup.mock.calls.length).toBe(calls);
  });

  it('a booking with no stored id at all is found the same way', async () => {
    mockStore.events.clear();
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'cancelled' }),
    });
    expect(result.action).toBe('cancellation-scheduled');
  });

  it('a notice with no status is also checked, quietly', async () => {
    mockStore.events.set(BOOKING, {
      booking: BOOKING,
      grant: GRANT,
      event: 'stale',
      verified: false,
    });
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({ trigger: 'event.updated', data: event() });
    expect(result.action).toBe('cancellation-scheduled');
  });

  it("only ever looks at the notice's own grant: the same Google event id in a guest's copy is not the organiser's event", async () => {
    const { calendar } = loadSync();
    mockStore.bookings.get(BOOKING).nylas_grant_id = 'coach-grant';
    mockStore.events.set(BOOKING, {
      booking: BOOKING,
      grant: 'coach-grant',
      event: 'stale',
      verified: false,
    });

    // A deletion of the same event id, but in another grant's calendar (a guest's copy).
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.deleted',
      data: { id: EVENT, grant_id: 'a-guests-grant', calendar_id: 'their-cal' },
    });

    expect(result).toEqual({ handled: false, reason: 'not-a-revie-booking' });
    expect(db.findActiveBookingsByGrant).toHaveBeenCalledTimes(1);
    expect(db.findActiveBookingsByGrant).toHaveBeenCalledWith('a-guests-grant');
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('asks Nylas at most once every 30 seconds however many unmatched notices arrive', async () => {
    mockStore.events.clear();
    mockNylasEvents[BOOKING] = 'some-other-event';
    const { calendar } = loadSync();
    const lookup = require('./eventIdBackfill').lookupEventId;

    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event({ id: 'x2' }) });
    expect(lookup).toHaveBeenCalledTimes(1);

    advance(31 / 60);
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event({ id: 'x3' }) });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  describe('logs', () => {
    it('says which booking a deletion matched and when the cancel is scheduled for, with ids only', async () => {
      const { calendar } = loadSync();
      await calendar.handleCalendarEvent({
        trigger: 'event.deleted',
        data: event({ title: 'Find your focus with Alex Client' }),
      });
      const line = logged().find(l => l.includes('matched booking'));
      expect(line).toMatch(
        /^\[nylas\] calendar event matched booking booking-, cancel scheduled for \d\d:\d\d UTC$/
      );
      expect(line).not.toMatch(/Alex|Find your focus|@/);
    });

    it('says when a deletion matched nothing, with short ids and no personal data', async () => {
      mockStore.bookings.clear();
      mockStore.events.clear();
      const { calendar } = loadSync();
      await calendar.handleCalendarEvent({
        trigger: 'event.deleted',
        data: {
          id: 'abcdefghijklmnop',
          grant_id: 'grant-9999999',
          calendar_id: 'cal',
          title: 'Dentist',
          participants: [{ email: 'x@y.example' }],
        },
      });
      const line = logged().find(l => l.includes('did not match any booking'));
      expect(line).toBe(
        '[nylas] calendar event did not match any booking (event.deleted, grant grant-99, event abcdefgh)'
      );
      expect(line).not.toMatch(/Dentist|@|y\.example/);
    });

    it('says nothing about every ordinary edit of an unrelated event', async () => {
      mockStore.events.clear();
      mockStore.bookings.clear();
      const { calendar } = loadSync();
      await calendar.handleCalendarEvent({
        trigger: 'event.updated',
        data: event({ status: 'confirmed' }),
      });
      expect(logged().filter(l => l.includes('calendar event'))).toEqual([]);
    });

    it('says when a match is for a booking that is already cancelled', async () => {
      const { calendar } = loadSync();
      mockStore.bookings.get(BOOKING).status = 'cancelled';
      await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
      expect(logged().some(l => /matched booking booking-, but it is cancelled/.test(l))).toBe(
        true
      );
    });
  });
});

describe('session emails when the coach deletes the event', () => {
  it('the pending reminders are cancelled when the wait ends in a cancellation, not when it starts', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    expect(db.cancelSessionEmails).not.toHaveBeenCalled(); // an accidental deletion keeps its reminders

    advance(5);
    await calendar.processDueEventCancellations();
    expect(db.cancelSessionEmails).toHaveBeenCalledWith(BOOKING);
  });

  it('and are kept when the coach undoes the deletion', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    eventStatus = 'confirmed';
    advance(5);
    await calendar.processDueEventCancellations();
    expect(db.cancelSessionEmails).not.toHaveBeenCalled();
  });
});

describe('the coach undoes the deletion', () => {
  it('restored before the wait is up (Nylas says confirmed again): nothing is cancelled, and it is logged once', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });

    eventStatus = 'confirmed'; // the coach pressed undo; no notice reaches us
    advance(5);
    const summary = await calendar.processDueEventCancellations();

    expect(summary).toMatchObject({ checked: 1, cancelled: 0, restored: 1 });
    expect(integration.applyTransition).not.toHaveBeenCalled();
    expect(mockStore.bookings.get(BOOKING).status).toBe('created');
    expect(mockStore.waits.get(BOOKING).status).toBe('restored');
    const logged = console.log.mock.calls
      .flat()
      .filter(l => String(l).includes('is back after being deleted'));
    expect(logged).toHaveLength(1);

    // And it is not looked at again.
    advance(5);
    expect((await calendar.processDueEventCancellations()).checked).toBe(0);
  });

  it('a notice that it is confirmed again ends the wait at once, and later nothing is read or cancelled', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });

    const result = await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      // Nylas's event notices carry the guest list; without one the event would be read to find it.
      data: event({ status: 'confirmed', participants: [] }),
    });
    expect(result).toEqual({ handled: true, action: 'restored', via: 'calendar-event' });

    advance(10);
    expect((await calendar.processDueEventCancellations()).checked).toBe(0);
    expect(integration.applyTransition).not.toHaveBeenCalled();
    expect(nylasRequest).not.toHaveBeenCalled();
  });

  it('a second deletion after a restore starts a fresh wait', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'confirmed' }),
    });

    const again = await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    expect(again.action).toBe('cancellation-scheduled');

    advance(5);
    await calendar.processDueEventCancellations();
    expect(refundCalls()).toHaveLength(1);
  });
});

describe('duplicate notifications', () => {
  it('start one wait, do not push its time back, and refund once', async () => {
    const { calendar } = loadSync();
    const first = await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'cancelled' }),
    });
    advance(3);
    const second = await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });

    expect(first.action).toBe('cancellation-scheduled');
    expect(second.action).toBe('cancellation-already-scheduled');

    advance(2); // five minutes after the FIRST notice
    await calendar.processDueEventCancellations();
    advance(10);
    await calendar.processDueEventCancellations();

    expect(refundCalls()).toHaveLength(1);
  });

  it('two workers on the same tick cannot both act on one wait', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    advance(5);

    const [a, b] = await Promise.all([
      calendar.processDueEventCancellations(),
      calendar.processDueEventCancellations(),
    ]);
    expect(a.checked + b.checked).toBe(1);
    expect(refundCalls()).toHaveLength(1);
  });
});

describe('a restart during the wait', () => {
  it('is still handled: the wait is in the database, not in a timer', async () => {
    const before = loadSync();
    await before.calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });

    // The server restarts: a brand-new module instance, nothing in memory, the database as it was.
    jest.resetModules();
    jest.setSystemTime(Date.now() + 6 * MINUTE);
    const after = loadSync();
    const summary = await after.calendar.processDueEventCancellations();

    expect(summary).toMatchObject({ checked: 1, cancelled: 1 });
    expect(refundCalls()).toHaveLength(1);
  });

  it('and a restart that outlasts the wait just acts on the next tick, not twice', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    advance(60); // down for an hour
    await calendar.processDueEventCancellations();
    await calendar.processDueEventCancellations();
    expect(refundCalls()).toHaveLength(1);
  });
});

describe('guests and other calendars', () => {
  it('a guest declining the invitation changes the guest list, not the event: ignored, nothing waits', async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      data: event({
        status: 'confirmed',
        participants: [{ email: 'client@example.com', status: 'no' }],
      }),
    });

    expect(result).toEqual({ handled: false, reason: 'event-not-cancelled' });
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
    advance(10);
    expect((await calendar.processDueEventCancellations()).checked).toBe(0);
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it("the client deleting the event from their own calendar is not something we are told about: another grant's copy never matches", async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.deleted',
      data: { id: 'the-clients-copy', grant_id: 'clients-grant', calendar_id: 'their-cal' },
    });
    expect(result).toEqual({ handled: false, reason: 'not-a-revie-booking' });
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it("the coach's own event id seen under someone else's grant does not match either", async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.deleted',
      data: { ...event(), grant_id: 'clients-grant' },
    });
    // Recognised as somebody else's copy of the booking's event, and ignored.
    expect(result.reason).toBe('not-the-coach-copy');
  });

  it('an event that is not a Revie booking is ignored before anything else', async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.deleted',
      data: event({ id: 'a-coachs-own-meeting', title: 'Find your focus with Coach' }),
    });
    expect(result).toEqual({ handled: false, reason: 'not-a-revie-booking' });
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
  });

  it('ignores a notification with no event or grant id', async () => {
    const { calendar } = loadSync();
    expect(await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: {} })).toEqual({
      handled: false,
      reason: 'no-event-id',
    });
  });
});

describe('our own cancel button', () => {
  it('still acts at once (booking.cancelled is not delayed), and the deletion it causes then waits for nothing', async () => {
    const { calendar, booking } = loadSync();
    mockStore.bookings.get(BOOKING).booking_start = new Date(Date.now() + 100 * 3600000);
    mockTx.metadata = { cancelRequestedBy: 'customer' };

    const now = await booking.handleBookingWebhook({
      trigger: 'booking.cancelled',
      grantId: GRANT,
      data: { booking_id: BOOKING },
    });
    expect(now.action).toBe('refunded');
    expect(refundCalls()).toHaveLength(1);

    // Deleting the event echoes back as a calendar notice; the booking is no longer active.
    const echo = await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'cancelled' }),
    });
    expect(echo).toEqual({ handled: false, reason: 'booking-not-active' });
    advance(10);
    await calendar.processDueEventCancellations();
    expect(refundCalls()).toHaveLength(1);
  });

  it('and if the echo slipped in first, the wait finds the booking already cancelled and does nothing', async () => {
    const { calendar, booking } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    await booking.handleBookingWebhook({
      trigger: 'booking.cancelled',
      grantId: GRANT,
      data: { booking_id: BOOKING },
    });
    expect(refundCalls()).toHaveLength(1);

    advance(5);
    const summary = await calendar.processDueEventCancellations();
    expect(summary).toMatchObject({ checked: 1, ignored: 1, cancelled: 0 });
    expect(refundCalls()).toHaveLength(1);
  });
});

describe('when something goes wrong', () => {
  it('a failed refund is reported, kept waiting and tried again later; it is not lost and not done twice', async () => {
    const { calendar } = loadSync();
    await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    advance(5);

    integration.applyTransition.mockResolvedValueOnce({
      ok: false,
      error: new Error('stripe down'),
    });
    const first = await calendar.processDueEventCancellations();
    expect(first).toMatchObject({ checked: 1, failed: 1, cancelled: 0 });
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-event-cancel-failed', {
      bookingId: BOOKING,
    });
    expect(mockStore.waits.get(BOOKING).status).toBe('pending');
    // The amount was written before the refund was tried, and stays right for the retry.
    expect(mockTx.metadata).toMatchObject({ cancelledBy: 'provider', refundAmount: 50 });

    // Not retried straight away...
    expect((await calendar.processDueEventCancellations()).checked).toBe(0);
    // ...but after the pause.
    advance(6);
    const second = await calendar.processDueEventCancellations();
    expect(second).toMatchObject({ checked: 1, cancelled: 1 });
    expect(mockStore.waits.get(BOOKING).status).toBe('done');
    expect(mockTx.metadata.refundAmount).toBe(50);
  });

  it('does nothing without a database or Integration API credentials', async () => {
    const { calendar } = loadSync();
    integration.isConfigured.mockReturnValue(false);
    expect((await calendar.processDueEventCancellations()).checked).toBe(0);
  });

  it('leaves a booking that is not active alone (pending, or never confirmed)', async () => {
    const { calendar } = loadSync();
    mockStore.bookings.get(BOOKING).status = 'pending';
    const result = await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    expect(result.reason).toBe('booking-not-active');
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
  });
});

describe("only the coach's own copy of the event can cancel a booking", () => {
  const GUEST_GRANT = 'grant-guest'; // a client who is also a coach, with a connected calendar
  const logged = () => console.log.mock.calls.flat().map(String);
  const gone = status => ({ trigger: 'event.updated', data: event({ status }) });

  // The guest's own copy of the same Google event: same id, their grant, their calendar.
  const guestCopy = (trigger = 'event.deleted') => ({
    trigger,
    data: { id: EVENT, grant_id: GUEST_GRANT, calendar_id: 'cal-guest', status: 'cancelled' },
  });

  it("a guest's copy deleted on another connected grant is ignored and logged: nothing is scheduled or refunded", async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent(guestCopy());

    expect(result).toEqual({ handled: false, reason: 'not-the-coach-copy' });
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
    expect(
      logged().some(l => /ignored: it is another grant's copy of booking booking-/.test(l))
    ).toBe(true);

    advance(10);
    await calendar.processDueEventCancellations();
    expect(refundCalls()).toHaveLength(0);
    expect(mockStore.bookings.get(BOOKING).status).toBe('created');
  });

  it('the same goes for the guest declining it or the notice reporting it as cancelled', async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent(guestCopy('event.updated'));
    expect(result.reason).toBe('not-the-coach-copy');
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
  });

  it('a guest who is a coach with bookings of their own is not matched by the read-back either', async () => {
    // The guest's own booking, on their own grant, with a different event: nothing to do with ours.
    mockStore.bookings.set('guest-booking', {
      nylas_booking_id: 'guest-booking',
      sharetribe_transaction_id: 'tx-guest',
      nylas_grant_id: GUEST_GRANT,
      booking_start: new Date(Date.now() + 5 * 3600000),
      status: 'created',
    });
    mockNylasEvents['guest-booking'] = 'guest-own-event';
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent(guestCopy());

    expect(result.handled).toBe(false);
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
    expect(mockStore.bookings.get('guest-booking').status).toBe('created');
  });

  it("an event id wrongly recorded under another grant still cannot cancel the coach's booking", async () => {
    // Even if a stored row names the guest's grant, the booking's own grant has to match too.
    mockStore.events.set(BOOKING, { booking: BOOKING, grant: GUEST_GRANT, event: EVENT });
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent(guestCopy());
    expect(result.handled).toBe(false);
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
  });

  it("the coach's own copy deleted: cancelled after five minutes, with one full refund", async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    expect(result.action).toBe('cancellation-scheduled');
    expect(db.scheduleEventCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ nylasGrantId: GRANT, calendarId: 'cal-1' })
    );

    advance(4);
    await calendar.processDueEventCancellations();
    expect(refundCalls()).toHaveLength(0);

    advance(1);
    const summary = await calendar.processDueEventCancellations();
    expect(summary.cancelled).toBe(1);
    expect(refundCalls()).toHaveLength(1);
    expect(mockStore.bookings.get(BOOKING).status).toBe('cancelled');
  });

  it("works the same through the read-back path (a stored id that is wrong) when the notice is the coach's own", async () => {
    mockStore.events.set(BOOKING, { booking: BOOKING, grant: GRANT, event: 'wrong-id' });
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent(gone('cancelled'));
    expect(result.action).toBe('cancellation-scheduled');
    advance(5);
    await calendar.processDueEventCancellations();
    expect(refundCalls()).toHaveLength(1);
  });

  it("a notice from the coach's own grant but another calendar is ignored and logged", async () => {
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.deleted',
      data: event({ calendar_id: 'cal-other' }),
    });
    expect(result).toEqual({ handled: false, reason: 'not-the-coach-copy' });
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
    expect(logged().some(l => /is not the booking's calendar/.test(l))).toBe(true);
  });

  it('fails closed when the booking has no calendar on record', async () => {
    mockOwn.calendar = null;
    const { calendar } = loadSync();
    const result = await calendar.handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    expect(result.reason).toBe('not-the-coach-copy');
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
    expect(logged().some(l => /calendar is not known/.test(l))).toBe(true);
  });

  describe('the five-minute recheck', () => {
    const waitingFor = extra => {
      mockStore.waits.set(BOOKING, {
        nylas_booking_id: BOOKING,
        nylas_event_id: EVENT,
        nylas_grant_id: GRANT,
        calendar_id: 'cal-1',
        status: 'pending',
        due: Date.now() - 1000,
        lockedUntil: 0,
        ...extra,
      });
    };

    it('drops a wait that names another grant: nothing is read from it and nothing is cancelled', async () => {
      waitingFor({ nylas_grant_id: GUEST_GRANT, calendar_id: 'cal-guest' });
      const { calendar } = loadSync();
      const summary = await calendar.processDueEventCancellations();

      expect(summary).toMatchObject({ checked: 1, ignored: 1, cancelled: 0 });
      expect(nylasRequest).not.toHaveBeenCalled();
      expect(refundCalls()).toHaveLength(0);
      expect(logged().some(l => /calendar deletion ignored for booking booking-/.test(l))).toBe(
        true
      );
    });

    it('drops a wait that names another calendar', async () => {
      waitingFor({ calendar_id: 'cal-other' });
      const { calendar } = loadSync();
      const summary = await calendar.processDueEventCancellations();
      expect(summary.ignored).toBe(1);
      expect(refundCalls()).toHaveLength(0);
    });

    it("reads the event from the booking's own grant and calendar, even when the wait recorded none", async () => {
      // This used to count as "still deleted" without asking anybody.
      waitingFor({ calendar_id: null });
      eventStatus = 'confirmed';
      const { calendar } = loadSync();
      const summary = await calendar.processDueEventCancellations();

      expect(nylasRequest).toHaveBeenCalledTimes(1);
      const url = nylasRequest.mock.calls[0][0];
      expect(url).toContain(`/grants/${GRANT}/events/${EVENT}`);
      expect(url).toContain('calendar_id=cal-1');
      expect(summary).toMatchObject({ restored: 1, cancelled: 0 });
      expect(refundCalls()).toHaveLength(0);
    });
  });
});

describe("the client declines the coach's calendar invitation", () => {
  const CLIENT = 'Alex@Client.example';
  const COACH = 'sam@coach.example';
  const guests = (clientStatus, extra = []) => [
    { email: COACH, name: 'Sam Coach', status: 'yes' },
    { email: 'alex@client.example', name: 'Alex Client', status: clientStatus },
    ...extra,
  ];
  const updated = (participants, extra = {}) => ({
    trigger: 'event.updated',
    data: event({ status: 'confirmed', participants, ...extra }),
  });
  const queued = () => [...mockStore.emails.values()];

  beforeEach(() => {
    // The booking is a week away, so there is a session to still be booked for.
    mockStore.bookings.get(BOOKING).booking_start = new Date(Date.now() + 7 * 24 * 3600000);
  });

  const load = () => {
    const sync = loadSync();
    integration.loadTransactionAsOperator.mockImplementation(async () => ({
      listing: { attributes: { publicData: { nylasCalendarId: mockOwn.calendar } } },
      customer: { attributes: { email: CLIENT } },
    }));
    return sync.calendar;
  };

  it('a decline queues one email to the client, and cancels nothing and refunds nothing', async () => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent(updated(guests('no')));

    expect(result).toEqual({ handled: true, action: 'declined-invite-queued' });
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({
      dedupeKey: 'declined-invite:booking-1:client',
      kind: 'declined-invite',
      nylasBookingId: BOOKING,
      recipient: 'client',
    });
    expect(db.scheduleEventCancellation).not.toHaveBeenCalled();
    expect(integration.applyTransition).not.toHaveBeenCalled();
    expect(mockTx.refunds).toBe(0);
  });

  it('nothing is queued for the coach: one email, to the client', async () => {
    const calendar = load();
    await calendar.handleCalendarEvent(updated(guests('no')));
    expect(queued().every(e => e.recipient === 'client')).toBe(true);
  });

  it('a second decline (a repeat notice, or declining again later) queues nothing more', async () => {
    const calendar = load();
    await calendar.handleCalendarEvent(updated(guests('no')));
    const again = await calendar.handleCalendarEvent(updated(guests('no')));
    // Accepted again, then declined again, a day later.
    await calendar.handleCalendarEvent(updated(guests('yes')));
    advance(24 * 60);
    const later = await calendar.handleCalendarEvent(updated(guests('no')));

    expect(again).toEqual({ handled: true, action: 'declined-invite-already-queued' });
    expect(later).toEqual({ handled: true, action: 'declined-invite-already-queued' });
    expect(queued()).toHaveLength(1);
  });

  it("matches the client's email whatever its case or spacing", async () => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent(
      updated([{ email: '  ALEX@client.EXAMPLE ', status: 'no' }])
    );
    expect(result.action).toBe('declined-invite-queued');
  });

  it.each(['yes', 'maybe', 'noreply'])('a client who is %s sends nothing', async status => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent(updated(guests(status)));
    expect(result).toEqual({ handled: false, reason: 'event-not-cancelled' });
    expect(queued()).toHaveLength(0);
  });

  it('someone else on the invitation declining is ignored', async () => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent(
      updated(guests('yes', [{ email: 'friend@elsewhere.example', status: 'no' }]))
    );
    expect(result).toEqual({ handled: false, reason: 'event-not-cancelled' });
    expect(queued()).toHaveLength(0);
  });

  it('the coach declining their own event is ignored', async () => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent(
      updated([{ email: COACH, status: 'no' }, { email: 'alex@client.example', status: 'yes' }])
    );
    expect(result.handled).toBe(false);
    expect(queued()).toHaveLength(0);
  });

  it("a guest's own copy is ignored: the notice from another grant (the client is also a coach)", async () => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      data: event({
        grant_id: 'their-own-grant',
        status: 'confirmed',
        participants: guests('no'),
      }),
    });
    expect(result).toEqual({ handled: false, reason: 'not-a-revie-booking' });
    expect(queued()).toHaveLength(0);
  });

  it("another calendar of the coach's grant is ignored too", async () => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent(
      updated(guests('no'), { calendar_id: 'some-other-calendar' })
    );
    expect(result).toEqual({ handled: false, reason: 'not-the-coach-copy' });
    expect(queued()).toHaveLength(0);
  });

  it('an event that is not a Revie booking is ignored, even with a decline in it', async () => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent(
      updated(guests('no'), { id: 'someone-elses-meeting' })
    );
    expect(result).toEqual({ handled: false, reason: 'not-a-revie-booking' });
    expect(queued()).toHaveLength(0);
  });

  it.each(['cancelled', 'completed'])('a booking that is %s is ignored', async status => {
    mockStore.bookings.get(BOOKING).status = status;
    const calendar = load();
    const result = await calendar.handleCalendarEvent(updated(guests('no')));
    expect(result).toEqual({ handled: false, reason: 'booking-not-active' });
    expect(queued()).toHaveLength(0);
  });

  it('a session that has already passed is not told anything', async () => {
    mockStore.bookings.get(BOOKING).booking_start = new Date(Date.now() - 3600000);
    const calendar = load();
    const result = await calendar.handleCalendarEvent(updated(guests('no')));
    expect(result).toEqual({ handled: true, action: 'declined-invite-session-passed' });
    expect(queued()).toHaveLength(0);
  });

  it('a decline is not a cancellation: the event stays confirmed, so no wait starts', async () => {
    const calendar = load();
    await calendar.handleCalendarEvent(updated(guests('no')));
    expect(mockStore.waits.size).toBe(0);
  });

  it('when the notice carries no guest list, the event is read to find the decline', async () => {
    const calendar = load();
    nylasRequest.mockResolvedValue({ status: 'confirmed', participants: guests('no') });
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'confirmed' }),
    });
    expect(nylasRequest).toHaveBeenCalledTimes(1);
    expect(nylasRequest.mock.calls[0][0]).toContain('/events/event-1?calendar_id=cal-1');
    expect(result.action).toBe('declined-invite-queued');
  });

  it('a deleted-event notice is a cancellation, never a decline email', async () => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent({
      trigger: 'event.deleted',
      data: event({ participants: guests('no') }),
    });
    expect(result.action).toBe('cancellation-scheduled');
    expect(queued()).toHaveLength(0);
  });

  it('a cancelled event (the coach deleted it) is the cancellation path, whoever has declined', async () => {
    const calendar = load();
    const result = await calendar.handleCalendarEvent(
      updated(guests('no'), { status: 'cancelled' })
    );
    expect(result.action).toBe('cancellation-scheduled');
    expect(queued()).toHaveLength(0);
  });

  it('only asks Sharetribe for the client when somebody has declined', async () => {
    const calendar = load();
    integration.loadTransactionAsOperator.mockClear();
    await calendar.handleCalendarEvent(updated(guests('yes')));
    // The one call is the own-calendar check every matched notice already makes.
    expect(integration.loadTransactionAsOperator).toHaveBeenCalledTimes(1);
  });
});
