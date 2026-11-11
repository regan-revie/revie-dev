// Real bookingSync and calendarEventSync, a stand-in database that behaves like the real one
// (waits that persist, come due and are claimed), a controllable clock, and mocks only for the
// Integration API (Sharetribe), Nylas and Sentry.
jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./integration', () => ({
  isConfigured: jest.fn(),
  applyTransition: jest.fn(),
  updateTransactionMetadata: jest.fn(),
  getTransactionBasics: jest.fn(),
}));
jest.mock('./client', () => ({ nylasRequest: jest.fn() }));
jest.mock('./bookingRecovery', () => ({ cancelIfDeclined: jest.fn() }));

// The "database" lives outside the module registry, so it survives a simulated restart.
const mockStore = { bookings: new Map(), events: new Map(), waits: new Map() };
jest.mock('./db', () => ({
  isAvailable: jest.fn(() => true),
  findBookingByEvent: jest.fn(async (grant, event) => {
    const e = [...mockStore.events.values()].find(x => x.grant === grant && x.event === event);
    return e ? mockStore.bookings.get(e.booking) || null : null;
  }),
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
  integration.updateTransactionMetadata.mockResolvedValue({ ok: true });
  integration.getTransactionBasics.mockImplementation(async () => ({
    metadata: mockTx.metadata,
    lastTransition: mockTx.cancelled ? 'transition/cancel' : 'transition/operator-accept',
    payinTotal: { amount: mockTx.cancelled ? 0 : 5000, currency: 'USD' },
  }));
  nylasRequest.mockImplementation(async () => ({ status: eventStatus }));

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
  mockStore.bookings.set(BOOKING, {
    nylas_booking_id: BOOKING,
    sharetribe_transaction_id: TX,
    nylas_grant_id: GRANT,
    booking_start: new Date(Date.now() + 5 * 3600000), // inside 48 hours: a coach cancel still refunds
    status: 'created',
  });
  mockStore.events.set(BOOKING, { booking: BOOKING, grant: GRANT, event: EVENT });

  eventStatus = 'cancelled';
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
    // Recorded as the coach's cancellation.
    expect(integration.updateTransactionMetadata).toHaveBeenCalledWith(TX, {
      cancelledBy: 'provider',
    });
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
      data: event({ status: 'confirmed' }),
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
    expect(result.reason).toBe('not-a-revie-booking');
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

    // Not retried straight away...
    expect((await calendar.processDueEventCancellations()).checked).toBe(0);
    // ...but after the pause.
    advance(6);
    const second = await calendar.processDueEventCancellations();
    expect(second).toMatchObject({ checked: 1, cancelled: 1 });
    expect(mockStore.waits.get(BOOKING).status).toBe('done');
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
