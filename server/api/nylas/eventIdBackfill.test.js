jest.mock('./db', () => ({
  isAvailable: jest.fn(),
  findBookingsNeedingEventCheck: jest.fn(),
  recordBookingEvent: jest.fn(),
  recordEventLookupFailure: jest.fn(),
}));
jest.mock('./integration', () => ({
  isConfigured: jest.fn(),
  loadTransactionAsOperator: jest.fn(),
}));
jest.mock('./availability', () => ({ getBooking: jest.fn() }));
jest.mock('./manageBookingShared', () => ({ resolveBookingTarget: jest.fn() }));

const db = require('./db');
const integration = require('./integration');
const { getBooking } = require('./availability');
const { resolveBookingTarget } = require('./manageBookingShared');
const { resolveMissingEventIds, lookupEventId } = require('./eventIdBackfill');

const row = id => ({
  nylas_booking_id: id,
  sharetribe_transaction_id: `tx-${id}`,
  nylas_grant_id: 'g1',
});

// The failures Postgres has counted, per booking.
const failures = {};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(failures).forEach(k => delete failures[k]);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // Mock implementations do not survive between tests in this setup, so every one is set here.
  db.isAvailable.mockReturnValue(true);
  db.findBookingsNeedingEventCheck.mockResolvedValue([row('b1')]);
  db.recordBookingEvent.mockResolvedValue({});
  db.recordEventLookupFailure.mockImplementation(async id => {
    failures[id] = (failures[id] || 0) + 1;
    return failures[id];
  });
  integration.isConfigured.mockReturnValue(true);
  integration.loadTransactionAsOperator.mockResolvedValue({ tx: {}, listing: {}, booking: {} });
  resolveBookingTarget.mockReturnValue({ configurationId: 'cfg-1' });
  getBooking.mockResolvedValue({ event_id: 'ev-1' });
});

afterEach(() => jest.restoreAllMocks());

describe('resolveMissingEventIds()', () => {
  it("stores the event id Nylas reports, marked verified, under the booking's own grant", async () => {
    const summary = await resolveMissingEventIds();
    expect(getBooking).toHaveBeenCalledWith({ configurationId: 'cfg-1', bookingId: 'b1' });
    expect(db.recordBookingEvent).toHaveBeenCalledWith({
      nylasBookingId: 'b1',
      nylasEventId: 'ev-1',
      nylasGrantId: 'g1',
      verified: true,
    });
    expect(summary).toEqual({ checked: 1, resolved: 1, failed: 0, gaveUp: 0 });
  });

  it('also checks bookings whose stored id was never confirmed by Nylas (the query includes them)', async () => {
    await resolveMissingEventIds({ limit: 7 });
    expect(db.findBookingsNeedingEventCheck).toHaveBeenCalledWith(7, 5, 3);
  });

  it('does nothing without a database or Integration credentials', async () => {
    db.isAvailable.mockReturnValue(false);
    expect(await resolveMissingEventIds()).toEqual({
      checked: 0,
      resolved: 0,
      failed: 0,
      gaveUp: 0,
    });
  });

  describe('a booking whose event can never be found (the one logged every few minutes)', () => {
    beforeEach(() => {
      getBooking.mockResolvedValue({}); // "the booking has no event id"
    });

    it('is given up on after three tries, with ONE log line, and the line says it will not be tried again', async () => {
      const results = [];
      for (let i = 0; i < 3; i += 1) results.push(await resolveMissingEventIds());

      expect(results.map(r => r.failed)).toEqual([1, 1, 1]);
      expect(results.map(r => r.gaveUp)).toEqual([0, 0, 1]);
      const lines = console.log.mock.calls.flat().map(String);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/Could not find the calendar event of booking b1 after 3 tries/);
      expect(lines[0]).toMatch(/giving up/);
    });

    it('stays given up across a restart, because the count is in the database, not in memory', async () => {
      // After three failures the query no longer returns it, whichever process asks.
      for (let i = 0; i < 3; i += 1) await resolveMissingEventIds();
      db.findBookingsNeedingEventCheck.mockResolvedValue([]);

      jest.resetModules();
      const fresh = require('./eventIdBackfill');
      expect(await fresh.resolveMissingEventIds()).toEqual({
        checked: 0,
        resolved: 0,
        failed: 0,
        gaveUp: 0,
      });
    });

    it('is not logged on the first two failures', async () => {
      await resolveMissingEventIds();
      await resolveMissingEventIds();
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  it('counts a booking with no configuration as a failure, not a resolution', async () => {
    resolveBookingTarget.mockReturnValue({ configurationId: null });
    expect(await resolveMissingEventIds()).toMatchObject({ resolved: 0, failed: 1 });
    expect(db.recordBookingEvent).not.toHaveBeenCalled();
  });
});

describe('lookupEventId()', () => {
  it('returns the event id Nylas gives for the booking', async () => {
    expect(await lookupEventId(row('b9'))).toBe('ev-1');
  });

  it('throws when the booking has none', async () => {
    getBooking.mockResolvedValue({});
    await expect(lookupEventId(row('b9'))).rejects.toThrow('the booking has no event id');
  });
});
