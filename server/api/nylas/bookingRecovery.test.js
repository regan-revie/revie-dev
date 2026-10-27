jest.mock('./db', () => ({
  isAvailable: jest.fn(() => true),
  claimBookingAttempt: jest.fn(),
  getBookingAttempt: jest.fn(),
  recordAttemptFailure: jest.fn(),
  finishBookingAttempt: jest.fn(async () => ({})),
  findByTransactionId: jest.fn(async () => []),
  setStatus: jest.fn(async () => ({})),
}));
jest.mock('./integration', () => ({
  isConfigured: jest.fn(() => true),
  loadTransactionAsOperator: jest.fn(),
  applyTransition: jest.fn(),
}));
jest.mock('./availability', () => ({
  createBooking: jest.fn(),
  cancelBooking: jest.fn(async () => {}),
}));
jest.mock('../../log', () => ({ error: jest.fn() }));

const db = require('./db');
const integration = require('./integration');
const { createBooking, cancelBooking } = require('./availability');
const log = require('../../log');
const { ensureBooking, cancelIfDeclined, isTransient, settings } = require('./bookingRecovery');

const TX = 'tx-1';

const resources = (over = {}) => ({
  tx: {
    attributes: { lastTransition: 'transition/confirm-payment', protectedData: {} },
  },
  listing: {
    attributes: { publicData: { calendarBookingEnabled: true, nylasConfigurationId: 'cfg-1' } },
  },
  booking: { attributes: { start: '2026-11-10T10:00:00Z', end: '2026-11-10T11:00:00Z' } },
  customer: { attributes: { email: 'cleo@example.com', profile: { displayName: 'Cleo' } } },
  ...over,
});

const httpError = status =>
  Object.assign(new Error(`Nylas failed with status ${status}`), { status });

let attemptCount;

beforeEach(() => {
  jest.clearAllMocks();
  settings.retryDelayMs = 0;
  settings.graceMs = 0;
  settings.graceStepMs = 1;
  attemptCount = 0;

  db.isAvailable.mockReturnValue(true);
  integration.isConfigured.mockReturnValue(true);
  db.claimBookingAttempt.mockImplementation(async () => ({
    attempts: attemptCount,
    last_error: null,
  }));
  db.getBookingAttempt.mockResolvedValue(null);
  db.recordAttemptFailure.mockImplementation(async () => ({ attempts: (attemptCount += 1) }));
  db.finishBookingAttempt.mockResolvedValue({});
  db.findByTransactionId.mockResolvedValue([]);
  integration.loadTransactionAsOperator.mockResolvedValue(resources());
  integration.applyTransition.mockResolvedValue({ ok: true, transaction: {} });
  createBooking.mockResolvedValue({ booking_id: 'bk-1' });
});

describe('isTransient()', () => {
  it.each([
    [undefined, true], // no answer at all: network, timeout, or the session could not be minted
    [408, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false], // wrong API key: identical every time
    [404, false],
    [409, false], // slot taken
    [422, false],
  ])('status %s -> %s', (status, expected) => {
    expect(isTransient(status ? { status } : new Error('socket hang up'))).toBe(expected);
  });
});

describe('ensureBooking()', () => {
  it('creates the booking on the first attempt and does not decline', async () => {
    const result = await ensureBooking({ transactionId: TX, source: 'browser' });
    expect(result.outcome).toBe('booked');
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        configurationId: 'cfg-1',
        guest: { name: 'Cleo', email: 'cleo@example.com' },
        additionalFields: { sharetribeTransactionId: TX },
      })
    );
    expect(db.finishBookingAttempt).toHaveBeenCalledWith(TX, 'booked');
    expect(integration.applyTransition).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('retries once after a transient failure, then succeeds', async () => {
    createBooking.mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce({});
    const result = await ensureBooking({ transactionId: TX });
    expect(result.outcome).toBe('booked');
    expect(createBooking).toHaveBeenCalledTimes(2);
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('retries a 5xx, too', async () => {
    createBooking.mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce({});
    expect((await ensureBooking({ transactionId: TX })).outcome).toBe('booked');
    expect(createBooking).toHaveBeenCalledTimes(2);
  });

  it('declines after two failed attempts, and alerts via Sentry', async () => {
    createBooking.mockRejectedValue(httpError(503));
    const result = await ensureBooking({ transactionId: TX, source: 'sweeper' });

    expect(result.outcome).toBe('declined');
    expect(createBooking).toHaveBeenCalledTimes(2);
    expect(integration.applyTransition).toHaveBeenCalledWith(TX, 'transition/operator-decline');
    expect(db.finishBookingAttempt).toHaveBeenCalledWith(TX, 'declined');
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'nylas-booking-failed-declined',
      expect.objectContaining({
        transactionId: TX,
        attempts: 2,
        source: 'sweeper',
        lastStatus: 503,
      })
    );
  });

  it('does not retry "slot taken": it would fail identically', async () => {
    createBooking.mockRejectedValue(httpError(409));
    const result = await ensureBooking({ transactionId: TX });
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('declined');
    expect(integration.applyTransition).toHaveBeenCalledWith(TX, 'transition/operator-decline');
  });

  it('does not retry a rejected API key either', async () => {
    createBooking.mockRejectedValue(httpError(401));
    await ensureBooking({ transactionId: TX });
    expect(createBooking).toHaveBeenCalledTimes(1);
  });

  it('does not decline if the booking.created webhook lands during the grace period', async () => {
    // The request timed out after Nylas actually made the booking.
    createBooking.mockRejectedValue(new Error('timeout'));
    db.findByTransactionId
      .mockResolvedValueOnce([]) // initial "already recorded?" check
      .mockResolvedValueOnce([{ nylas_booking_id: 'bk-9' }]); // the grace-period poll
    const result = await ensureBooking({ transactionId: TX });
    expect(result).toEqual({ outcome: 'booked', detail: 'recorded-by-webhook' });
    expect(integration.applyTransition).not.toHaveBeenCalled();
    expect(db.finishBookingAttempt).toHaveBeenCalledWith(TX, 'booked');
  });

  it('keeps polling for the webhook across the whole grace period', async () => {
    settings.graceMs = 3;
    settings.graceStepMs = 1;
    createBooking.mockRejectedValue(httpError(409));
    db.findByTransactionId.mockResolvedValue([]);
    await ensureBooking({ transactionId: TX });
    // 1 initial check + (grace steps + 1) polls
    expect(db.findByTransactionId.mock.calls.length).toBeGreaterThanOrEqual(1 + 4);
    expect(integration.applyTransition).toHaveBeenCalledTimes(1);
  });

  it('leaves a booking the webhook already recorded alone', async () => {
    db.findByTransactionId.mockResolvedValue([{ nylas_booking_id: 'bk-1' }]);
    const result = await ensureBooking({ transactionId: TX });
    expect(result.outcome).toBe('booked');
    expect(createBooking).not.toHaveBeenCalled();
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('does nothing if the transaction has already been accepted', async () => {
    integration.loadTransactionAsOperator.mockResolvedValue(
      resources({ tx: { attributes: { lastTransition: 'transition/operator-accept' } } })
    );
    const result = await ensureBooking({ transactionId: TX });
    expect(result).toEqual({ outcome: 'already-resolved', detail: 'transition/operator-accept' });
    expect(createBooking).not.toHaveBeenCalled();
    expect(db.finishBookingAttempt).toHaveBeenCalledWith(TX, 'booked');
  });

  it('does nothing if the transaction has already been declined or expired', async () => {
    integration.loadTransactionAsOperator.mockResolvedValue(
      resources({ tx: { attributes: { lastTransition: 'transition/expire' } } })
    );
    const result = await ensureBooking({ transactionId: TX });
    expect(result.outcome).toBe('already-resolved');
    expect(createBooking).not.toHaveBeenCalled();
    expect(integration.applyTransition).not.toHaveBeenCalled();
    expect(db.finishBookingAttempt).toHaveBeenCalledWith(TX, 'closed');
  });

  it('leaves transactions on listings without calendar booking alone', async () => {
    integration.loadTransactionAsOperator.mockResolvedValue(
      resources({ listing: { attributes: { publicData: {} } } })
    );
    const result = await ensureBooking({ transactionId: TX });
    expect(result.outcome).toBe('not-calendar');
    expect(createBooking).not.toHaveBeenCalled();
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('declines straight away when the listing has no Nylas configuration (retrying cannot help)', async () => {
    integration.loadTransactionAsOperator.mockResolvedValue(
      resources({ listing: { attributes: { publicData: { calendarBookingEnabled: true } } } })
    );
    const result = await ensureBooking({ transactionId: TX });
    expect(result.outcome).toBe('declined');
    expect(createBooking).not.toHaveBeenCalled();
    expect(integration.applyTransition).toHaveBeenCalledWith(TX, 'transition/operator-decline');
  });

  it('skips creating when two attempts are already used (a sweeper picking up after a crash)', async () => {
    attemptCount = 2;
    db.claimBookingAttempt.mockResolvedValue({
      attempts: 2,
      last_error: 'Nylas failed with status 503',
    });
    const result = await ensureBooking({ transactionId: TX, source: 'sweeper' });
    expect(createBooking).not.toHaveBeenCalled();
    expect(result.outcome).toBe('declined');
  });

  it('reads where the transaction is now if the decline is refused, rather than guessing', async () => {
    createBooking.mockRejectedValue(httpError(409));
    integration.applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
    integration.loadTransactionAsOperator
      .mockResolvedValueOnce(resources())
      .mockResolvedValueOnce(
        resources({ tx: { attributes: { lastTransition: 'transition/operator-accept' } } })
      );
    const result = await ensureBooking({ transactionId: TX });
    expect(result).toEqual({ outcome: 'already-resolved', detail: 'transition/operator-accept' });
    expect(db.finishBookingAttempt).toHaveBeenLastCalledWith(TX, 'booked');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('releases the claim for the sweeper and alerts when the decline itself fails', async () => {
    createBooking.mockRejectedValue(httpError(409));
    integration.applyTransition.mockResolvedValue({
      ok: false,
      error: new Error('Sharetribe down'),
    });
    const result = await ensureBooking({ transactionId: TX });
    expect(result.outcome).toBe('error');
    expect(db.finishBookingAttempt).toHaveBeenLastCalledWith(
      TX,
      'pending',
      settings.declineRetrySeconds
    );
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'nylas-decline-failed',
      expect.any(Object)
    );
  });

  it('releases the claim and alerts on an unexpected error', async () => {
    integration.loadTransactionAsOperator.mockRejectedValue(new Error('Sharetribe unreachable'));
    const result = await ensureBooking({ transactionId: TX });
    expect(result.outcome).toBe('error');
    expect(db.finishBookingAttempt).toHaveBeenLastCalledWith(
      TX,
      'pending',
      settings.declineRetrySeconds
    );
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'nylas-booking-recovery-error',
      expect.any(Object)
    );
  });

  it('does nothing without a database or Integration API credentials', async () => {
    db.isAvailable.mockReturnValue(false);
    expect((await ensureBooking({ transactionId: TX })).outcome).toBe('unavailable');
    db.isAvailable.mockReturnValue(true);
    integration.isConfigured.mockReturnValue(false);
    expect((await ensureBooking({ transactionId: TX })).outcome).toBe('unavailable');
    expect(db.claimBookingAttempt).not.toHaveBeenCalled();
  });
});

describe('ensureBooking(): two workers', () => {
  it('only one of two simultaneous calls creates the booking', async () => {
    // Stand-in for the Postgres claim: exactly one caller wins, as the single INSERT ... ON
    // CONFLICT ... WHERE statement guarantees. The loser must neither book nor decline.
    let claimed = false;
    db.claimBookingAttempt.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return { attempts: 0, last_error: null };
    });
    db.getBookingAttempt.mockResolvedValue({ status: 'pending' });

    const [a, b] = await Promise.all([
      ensureBooking({ transactionId: TX, source: 'browser' }),
      ensureBooking({ transactionId: TX, source: 'sweeper' }),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual(['booked', 'busy']);
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(integration.applyTransition).not.toHaveBeenCalled();
  });

  it('reports "already-resolved" to a late caller once the transaction is settled', async () => {
    db.claimBookingAttempt.mockResolvedValue(null);
    db.getBookingAttempt.mockResolvedValue({ status: 'declined' });
    const result = await ensureBooking({ transactionId: TX });
    expect(result).toEqual({ outcome: 'already-resolved', detail: 'declined' });
    expect(createBooking).not.toHaveBeenCalled();
  });
});

describe('cancelIfDeclined() (a webhook that arrives after we declined)', () => {
  it('cancels the orphaned Nylas booking and alerts', async () => {
    integration.loadTransactionAsOperator.mockResolvedValue(
      resources({ tx: { attributes: { lastTransition: 'transition/operator-decline' } } })
    );
    expect(await cancelIfDeclined({ transactionId: TX, bookingId: 'bk-late' })).toBe(true);
    expect(cancelBooking).toHaveBeenCalledWith({ configurationId: 'cfg-1', bookingId: 'bk-late' });
    expect(db.setStatus).toHaveBeenCalledWith('bk-late', 'orphan-cancelled');
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-orphan-booking-cancelled', {
      transactionId: TX,
      bookingId: 'bk-late',
    });
  });

  it('leaves a normal redelivered webhook alone', async () => {
    integration.loadTransactionAsOperator.mockResolvedValue(
      resources({ tx: { attributes: { lastTransition: 'transition/operator-accept' } } })
    );
    expect(await cancelIfDeclined({ transactionId: TX, bookingId: 'bk-1' })).toBe(false);
    expect(cancelBooking).not.toHaveBeenCalled();
  });

  it('never throws: the webhook must still be acknowledged, and a human is told', async () => {
    integration.loadTransactionAsOperator.mockResolvedValue(
      resources({ tx: { attributes: { lastTransition: 'transition/operator-decline' } } })
    );
    cancelBooking.mockRejectedValue(new Error('Nylas down'));
    expect(await cancelIfDeclined({ transactionId: TX, bookingId: 'bk-late' })).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'nylas-orphan-booking-cleanup-failed',
      expect.any(Object)
    );
  });
});
