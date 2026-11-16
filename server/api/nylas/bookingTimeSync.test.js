jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./db', () => ({
  isAvailable: jest.fn(),
  findRecentlyRescheduled: jest.fn(),
}));
jest.mock('./integration', () => ({
  isConfigured: jest.fn(),
  loadTransactionAsOperator: jest.fn(),
  applyTransition: jest.fn(),
}));

const log = require('../../log');
const db = require('./db');
const integration = require('./integration');
const {
  syncSharetribeBookingTime,
  applyBookingTime,
  reconcileBookingTimes,
  resetSettled,
} = require('./bookingTimeSync');

const TX = 'tx-1';
const BOOKING = 'bk-1';
const NEW_START = '2026-11-20T19:30:00.000Z';
const NEW_END = '2026-11-20T20:30:00.000Z';

const sharetribeHas = (start, end, lastTransition = 'transition/operator-accept') =>
  integration.loadTransactionAsOperator.mockResolvedValue({
    tx: { attributes: { lastTransition } },
    booking: { attributes: { start: new Date(start), end: new Date(end) } },
  });

const refused = code => ({
  ok: false,
  alreadyApplied: true,
  error: { status: 409, data: { errors: [{ status: 409, code }] } },
});

beforeEach(() => {
  jest.clearAllMocks();
  resetSettled();
  db.isAvailable.mockReturnValue(true);
  integration.isConfigured.mockReturnValue(true);
  integration.applyTransition.mockResolvedValue({ ok: true });
});

describe('syncSharetribeBookingTime', () => {
  it("moves Sharetribe's booking to the new time with transition/update-booking", async () => {
    sharetribeHas('2026-11-17T17:00:00Z', '2026-11-17T18:00:00Z');
    const result = await syncSharetribeBookingTime({
      transactionId: TX,
      start: NEW_START,
      end: NEW_END,
    });

    expect(result.outcome).toBe('updated');
    expect(integration.applyTransition).toHaveBeenCalledWith(TX, 'transition/update-booking', {
      bookingStart: new Date(NEW_START),
      bookingEnd: new Date(NEW_END),
    });
  });

  it('does nothing when Sharetribe is already on that time (a redelivered notice)', async () => {
    sharetribeHas(NEW_START, NEW_END, 'transition/update-booking');
    const result = await syncSharetribeBookingTime({
      transactionId: TX,
      start: NEW_START,
      end: NEW_END,
    });
    expect(result.outcome).toBe('already');
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('throws on a failure a retry could fix, so the webhook answers 500 and Nylas delivers it again', async () => {
    sharetribeHas('2026-11-17T17:00:00Z', '2026-11-17T18:00:00Z');
    integration.applyTransition.mockResolvedValue({
      ok: false,
      error: new Error('sharetribe down'),
    });
    await expect(
      syncSharetribeBookingTime({ transactionId: TX, start: NEW_START, end: NEW_END })
    ).rejects.toThrow('sharetribe down');
  });
});

describe('applyBookingTime reporting', () => {
  beforeEach(() => sharetribeHas('2026-11-17T17:00:00Z', '2026-11-17T18:00:00Z'));
  const run = () =>
    applyBookingTime({ transactionId: TX, bookingId: BOOKING, start: NEW_START, end: NEW_END });

  it('says nothing on success', async () => {
    await run();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('reports to Sentry when Sharetribe says the new time is not available', async () => {
    integration.applyTransition.mockResolvedValue(
      refused('transaction-booking-time-not-available')
    );
    const result = await run();
    expect(result.outcome).toBe('conflict');
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][1]).toBe('nylas-update-booking-unavailable');
    expect(log.error.mock.calls[0][2]).toEqual({ transactionId: TX, bookingId: BOOKING });
  });

  it('reports a refusal while the session is still to come (a transaction before release-6)', async () => {
    integration.applyTransition.mockResolvedValue(refused('transaction-invalid-transition'));
    const result = await run();
    expect(result.outcome).toBe('not-applicable');
    expect(log.error.mock.calls[0][1]).toBe('nylas-update-booking-refused');
  });

  it('stays quiet about a refusal once the transaction has moved on (already paid out or cancelled)', async () => {
    sharetribeHas('2026-11-17T17:00:00Z', '2026-11-17T18:00:00Z', 'transition/complete');
    integration.applyTransition.mockResolvedValue(refused('transaction-invalid-transition'));
    await run();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('reconcileBookingTimes', () => {
  const row = id => ({
    nylas_booking_id: id,
    sharetribe_transaction_id: `tx-${id}`,
    booking_start: new Date(NEW_START),
    booking_end: new Date(NEW_END),
  });

  it('brings a booking whose update was missed onto the new time', async () => {
    db.findRecentlyRescheduled.mockResolvedValue([row('a')]);
    sharetribeHas('2026-11-17T17:00:00Z', '2026-11-17T18:00:00Z');
    const summary = await reconcileBookingTimes();
    expect(summary).toEqual({ checked: 1, updated: 1, failed: 0 });
    expect(integration.applyTransition).toHaveBeenCalledWith(
      'tx-a',
      'transition/update-booking',
      expect.any(Object)
    );
  });

  it('looks at a settled booking once, not every minute', async () => {
    db.findRecentlyRescheduled.mockResolvedValue([row('a')]);
    sharetribeHas(NEW_START, NEW_END, 'transition/update-booking');
    await reconcileBookingTimes();
    integration.loadTransactionAsOperator.mockClear();
    const second = await reconcileBookingTimes();
    expect(second.checked).toBe(0);
    expect(integration.loadTransactionAsOperator).not.toHaveBeenCalled();
  });

  it('counts and reports a failure, and tries that booking again next time', async () => {
    db.findRecentlyRescheduled.mockResolvedValue([row('a')]);
    sharetribeHas('2026-11-17T17:00:00Z', '2026-11-17T18:00:00Z');
    integration.applyTransition.mockResolvedValue({ ok: false, error: new Error('down') });
    const first = await reconcileBookingTimes();
    expect(first.failed).toBe(1);
    expect(log.error.mock.calls.some(c => c[1] === 'nylas-booking-time-sync-failed')).toBe(true);

    integration.applyTransition.mockResolvedValue({ ok: true });
    const second = await reconcileBookingTimes();
    expect(second.updated).toBe(1);
  });

  it('does nothing without a database or Sharetribe credentials', async () => {
    db.isAvailable.mockReturnValue(false);
    expect(await reconcileBookingTimes()).toEqual({ checked: 0, updated: 0, failed: 0 });
    expect(db.findRecentlyRescheduled).not.toHaveBeenCalled();
  });
});
