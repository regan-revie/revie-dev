// Real bookingSync (so the refund path is the one that runs in production); the database, the
// Integration API and Nylas are mocked.
jest.mock('./db', () => ({
  isAvailable: jest.fn(),
  findBookingByEvent: jest.fn(),
  findByBookingId: jest.fn(),
  setStatus: jest.fn(),
}));
jest.mock('./integration', () => ({
  isConfigured: jest.fn(),
  applyTransition: jest.fn(),
  updateTransactionMetadata: jest.fn(),
  getTransactionBasics: jest.fn(),
}));
jest.mock('./client', () => ({ nylasRequest: jest.fn() }));
jest.mock('./bookingRecovery', () => ({ cancelIfDeclined: jest.fn() }));

const db = require('./db');
const integration = require('./integration');
const { handleCalendarEvent } = require('./calendarEventSync');

const GRANT = 'grant-1';
const EVENT = 'event-1';
const BOOKING = 'booking-1';
const TX = 'tx-1';

const row = (status = 'created') => ({
  nylas_booking_id: BOOKING,
  sharetribe_transaction_id: TX,
  nylas_grant_id: GRANT,
  booking_start: new Date(Date.now() + 5 * 3600000), // inside 48 hours: a coach cancel is still refunded
  status,
});
const event = (extra = {}) => ({ id: EVENT, grant_id: GRANT, calendar_id: 'cal-1', ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  // Mock implementations do not survive between tests in this setup, so every one is set here.
  db.isAvailable.mockReturnValue(true);
  db.findBookingByEvent.mockResolvedValue(row());
  db.setStatus.mockResolvedValue({});
  integration.isConfigured.mockReturnValue(true);
  integration.applyTransition.mockResolvedValue({ ok: true });
  integration.updateTransactionMetadata.mockResolvedValue({ ok: true });
  integration.getTransactionBasics.mockResolvedValue({
    metadata: {},
    lastTransition: 'transition/operator-accept',
  });
});

describe("a Revie session event deleted from the coach's calendar", () => {
  it('refunds in full (the coach-cancel path) when Google reports it as event.updated with status cancelled', async () => {
    const result = await handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'cancelled' }),
    });

    expect(db.findBookingByEvent).toHaveBeenCalledWith(GRANT, EVENT);
    expect(integration.applyTransition).toHaveBeenCalledTimes(1);
    expect(integration.applyTransition).toHaveBeenCalledWith(TX, 'transition/cancel');
    expect(integration.updateTransactionMetadata).toHaveBeenCalledWith(TX, {
      cancelledBy: 'provider',
    });
    expect(db.setStatus).toHaveBeenCalledWith(BOOKING, 'cancelled');
    expect(result).toEqual({ handled: true, action: 'refunded', via: 'calendar-event' });
  });

  it('refunds when the provider reports it as event.deleted', async () => {
    const result = await handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    expect(integration.applyTransition).toHaveBeenCalledWith(TX, 'transition/cancel');
    expect(result.action).toBe('refunded');
  });

  it('refunds even inside 48 hours: a coach cancellation is never charged', async () => {
    await handleCalendarEvent({ trigger: 'event.deleted', data: event() });
    expect(integration.applyTransition).not.toHaveBeenCalledWith(TX, 'transition/late-cancel');
  });

  it('asks Nylas for the status when the notification carries none, and refunds if it is gone', async () => {
    const getEventStatus = jest.fn(async () => 'cancelled');
    const result = await handleCalendarEvent({
      trigger: 'event.updated',
      data: event(),
      getEventStatus,
    });
    expect(getEventStatus).toHaveBeenCalledWith({
      grantId: GRANT,
      calendarId: 'cal-1',
      eventId: EVENT,
    });
    expect(result.action).toBe('refunded');
  });

  it("is treated as the client's cancellation, not the coach's, when the client used our cancel button (their event deletion echoes back)", async () => {
    integration.getTransactionBasics.mockResolvedValue({
      metadata: { cancelRequestedBy: 'customer' },
      lastTransition: 'transition/operator-accept',
    });
    db.findBookingByEvent.mockResolvedValue({
      ...row(),
      booking_start: new Date(Date.now() + 100 * 3600000), // more than 48 hours out: free
    });
    await handleCalendarEvent({ trigger: 'event.updated', data: event({ status: 'cancelled' }) });
    expect(integration.updateTransactionMetadata).toHaveBeenCalledWith(TX, {
      cancelledBy: 'client',
    });
  });
});

describe('events that are not Revie bookings', () => {
  it('ignores an event whose ids we never stored, before doing any other work', async () => {
    db.findBookingByEvent.mockResolvedValue(null);
    const getEventStatus = jest.fn();
    const result = await handleCalendarEvent({
      trigger: 'event.deleted',
      data: event({ id: 'a-coachs-own-meeting', title: 'Session with Sam' }),
      getEventStatus,
    });

    expect(result).toEqual({ handled: false, reason: 'not-a-revie-booking' });
    expect(integration.applyTransition).not.toHaveBeenCalled();
    expect(integration.getTransactionBasics).not.toHaveBeenCalled();
    expect(db.setStatus).not.toHaveBeenCalled();
    expect(getEventStatus).not.toHaveBeenCalled();
  });

  it('matches on ids alone: a title that looks like a Revie session counts for nothing', async () => {
    db.findBookingByEvent.mockResolvedValue(null);
    await handleCalendarEvent({
      trigger: 'event.updated',
      data: event({
        id: 'other',
        status: 'cancelled',
        title: 'Find your focus with Coach',
        when: { start_time: 1, end_time: 2 },
      }),
    });
    expect(db.findBookingByEvent).toHaveBeenCalledWith(GRANT, 'other');
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('ignores a notification with no event or grant id', async () => {
    expect(await handleCalendarEvent({ trigger: 'event.deleted', data: {} })).toEqual({
      handled: false,
      reason: 'no-event-id',
    });
    expect(db.findBookingByEvent).not.toHaveBeenCalled();
  });
});

describe('a Revie event that changed but was not cancelled', () => {
  it('does nothing: an edit, a move or our own description update is not a cancellation', async () => {
    const result = await handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'confirmed' }),
    });
    expect(result).toEqual({ handled: false, reason: 'event-not-cancelled' });
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('does nothing when Nylas says the event is still confirmed', async () => {
    const result = await handleCalendarEvent({
      trigger: 'event.updated',
      data: event(),
      getEventStatus: async () => 'confirmed',
    });
    expect(result.reason).toBe('event-not-cancelled');
  });
});

describe('duplicate notifications', () => {
  it('refund once: a notification for a booking already cancelled is dropped', async () => {
    await handleCalendarEvent({ trigger: 'event.updated', data: event({ status: 'cancelled' }) });
    expect(integration.applyTransition).toHaveBeenCalledTimes(1);

    // The same notification again (Nylas delivers at least once), now that the row says cancelled.
    db.findBookingByEvent.mockResolvedValue(row('cancelled'));
    const again = await handleCalendarEvent({
      trigger: 'event.updated',
      data: event({ status: 'cancelled' }),
    });

    expect(again).toEqual({ handled: false, reason: 'booking-not-active' });
    expect(integration.applyTransition).toHaveBeenCalledTimes(1);
  });

  it('refund once even if two arrive at the same moment: Sharetribe refuses the second', async () => {
    integration.applyTransition
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, alreadyApplied: true });

    const [first, second] = await Promise.all([
      handleCalendarEvent({ trigger: 'event.updated', data: event({ status: 'cancelled' }) }),
      handleCalendarEvent({ trigger: 'event.deleted', data: event() }),
    ]);

    expect([first.action, second.action].sort()).toEqual(['already-cancelled', 'refunded']);
    // Both asked; the state machine granted one refund.
    expect(integration.applyTransition.mock.results.filter(r => r.type === 'return')).toHaveLength(
      2
    );
  });

  it('refund once when the Scheduler also reports booking.cancelled for the same booking', async () => {
    const { handleBookingWebhook } = require('./bookingSync');
    await handleCalendarEvent({ trigger: 'event.updated', data: event({ status: 'cancelled' }) });

    // booking.cancelled arrives afterwards: the transaction is already cancelled, so Sharetribe
    // refuses the transition, and the handler reports it as done.
    db.findByBookingId.mockResolvedValue(row('cancelled'));
    integration.applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
    const result = await handleBookingWebhook({
      trigger: 'booking.cancelled',
      grantId: GRANT,
      data: { booking_id: BOOKING },
    });
    expect(result.action).toBe('already-cancelled');
  });
});

describe('what it will not act on', () => {
  it('leaves a booking that is not active alone (pending, or never confirmed)', async () => {
    db.findBookingByEvent.mockResolvedValue(row('pending'));
    const result = await handleCalendarEvent({
      trigger: 'event.deleted',
      data: event(),
    });
    expect(result.reason).toBe('booking-not-active');
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('does nothing without a database or Integration API credentials', async () => {
    db.isAvailable.mockReturnValue(false);
    expect((await handleCalendarEvent({ trigger: 'event.deleted', data: event() })).reason).toBe(
      'no-database'
    );

    db.isAvailable.mockReturnValue(true);
    integration.isConfigured.mockReturnValue(false);
    expect((await handleCalendarEvent({ trigger: 'event.deleted', data: event() })).reason).toBe(
      'no-integration-credentials'
    );
  });

  it('lets a failure surface, so the webhook answers 500 and Nylas delivers it again', async () => {
    integration.applyTransition.mockResolvedValue({ ok: false, error: new Error('stripe down') });
    await expect(handleCalendarEvent({ trigger: 'event.deleted', data: event() })).rejects.toThrow(
      'stripe down'
    );
  });
});
