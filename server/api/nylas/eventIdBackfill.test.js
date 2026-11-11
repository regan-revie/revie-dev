jest.mock('./db', () => ({
  isAvailable: jest.fn(),
  findBookingsMissingEvent: jest.fn(),
  recordBookingEvent: jest.fn(),
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

const load = () => {
  let mod;
  jest.isolateModules(() => {
    mod = require('./eventIdBackfill');
  });
  return mod.resolveMissingEventIds;
};

const row = id => ({
  nylas_booking_id: id,
  sharetribe_transaction_id: `tx-${id}`,
  nylas_grant_id: 'g1',
});

beforeEach(() => {
  jest.clearAllMocks();
  db.isAvailable.mockReturnValue(true);
  db.findBookingsMissingEvent.mockResolvedValue([row('b1')]);
  db.recordBookingEvent.mockResolvedValue({});
  integration.isConfigured.mockReturnValue(true);
  integration.loadTransactionAsOperator.mockResolvedValue({ tx: {}, listing: {}, booking: {} });
  resolveBookingTarget.mockReturnValue({ configurationId: 'cfg-1' });
  getBooking.mockResolvedValue({ event_id: 'ev-1' });
});

describe('resolveMissingEventIds()', () => {
  it('stores the event id Nylas reports for a booking that has none', async () => {
    const summary = await load()();
    expect(getBooking).toHaveBeenCalledWith({ configurationId: 'cfg-1', bookingId: 'b1' });
    expect(db.recordBookingEvent).toHaveBeenCalledWith({
      nylasBookingId: 'b1',
      nylasEventId: 'ev-1',
      nylasGrantId: 'g1',
    });
    expect(summary).toEqual({ checked: 1, resolved: 1, failed: 0 });
  });

  it('does nothing without a database or Integration credentials', async () => {
    db.isAvailable.mockReturnValue(false);
    expect(await load()()).toEqual({ checked: 0, resolved: 0, failed: 0 });
  });

  it('leaves a booking it cannot resolve alone for an hour, instead of asking every minute', async () => {
    getBooking.mockRejectedValue(new Error('nope'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const run = load();
    const t0 = 5_000_000;

    expect(await run({ now: t0 })).toMatchObject({ failed: 1 });
    expect(await run({ now: t0 + 60 * 1000 })).toMatchObject({ checked: 0 });
    expect(await run({ now: t0 + 61 * 60 * 1000 })).toMatchObject({ checked: 1 });
    spy.mockRestore();
  });

  it('counts a booking with no configuration or no event id as failed, not resolved', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    resolveBookingTarget.mockReturnValue({ configurationId: null });
    expect(await load()()).toMatchObject({ resolved: 0, failed: 1 });

    resolveBookingTarget.mockReturnValue({ configurationId: 'cfg-1' });
    getBooking.mockResolvedValue({});
    expect(await load()()).toMatchObject({ resolved: 0, failed: 1 });
    expect(db.recordBookingEvent).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
