// The whole chain, real except at its edges: the reconcile loop -> the per-coach runner ->
// ensureListingBookable. Only Sharetribe, Nylas, Postgres and Sentry are stand-ins, so this shows
// what the loop does to a listing as a coach's calendar and payout details come and go.
jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./db', () => ({
  isAvailable: jest.fn(),
  withAdvisoryLock: jest.fn(),
}));
jest.mock('./integration', () => ({ getIntegrationSdk: jest.fn() }));
jest.mock('./scheduler', () => ({
  listCalendars: jest.fn(),
  defaultCalendarFor: jest.fn(),
  getEventType: jest.fn(),
  SCHEDULING_DEFAULTS: { minBookingNoticeMinutes: 1440 },
}));
jest.mock('./listingSync', () => ({
  resolveBookingProcessAlias: jest.requireActual('./listingSync').resolveBookingProcessAlias,
  grantProvider: jest.fn(),
  syncListingConfigurations: jest.fn(),
}));

const log = require('../../log');
const db = require('./db');
const { getIntegrationSdk } = require('./integration');
const { listCalendars, defaultCalendarFor, getEventType } = require('./scheduler');
const { grantProvider, syncListingConfigurations } = require('./listingSync');
const { runReconcile } = require('./reconcile');

// A tiny in-memory marketplace: one coach, one published session listing. `listings.update` merges
// publicData the way Sharetribe does, so each loop sees what the previous one wrote.
const makeMarketplace = ({ stripeConnected, grant = 'g1' }) => {
  const state = {
    stripeConnected,
    listing: {
      id: { uuid: 'l1' },
      relationships: { author: { data: { id: { uuid: 'u1' } } } },
      attributes: {
        title: 'Find your focus',
        publicData: {
          listingType: 'signature-session',
          unitType: 'fixed',
          transactionProcessAlias: 'default-booking/release-1',
        },
      },
    },
  };
  const sdk = {
    listings: {
      query: jest.fn(async () => ({
        data: {
          data: [state.listing],
          included: [
            {
              type: 'user',
              id: { uuid: 'u1' },
              attributes: {
                stripeConnected: state.stripeConnected,
                profile: {
                  displayName: 'Coach',
                  privateData: grant ? { nylasGrantId: grant } : {},
                },
              },
            },
          ],
          meta: { totalPages: 1 },
        },
      })),
      update: jest.fn(async ({ publicData, availabilityPlan }) => {
        state.listing.attributes.publicData = {
          ...state.listing.attributes.publicData,
          ...publicData,
        };
        if (availabilityPlan) state.listing.attributes.availabilityPlan = availabilityPlan;
        return {};
      }),
    },
  };
  return { state, sdk };
};

const bookable = state => !!state.listing.attributes.publicData.calendarBookingEnabled;

beforeEach(() => {
  jest.clearAllMocks();
  // Mock implementations do not survive between tests in this setup, so every one is set here.
  process.env.BOOKING_PROCESS_ALIAS = 'default-booking/release-4';
  db.isAvailable.mockReturnValue(true);
  db.withAdvisoryLock.mockImplementation(async (key, fn) => ({ locked: true, value: await fn() }));
  getEventType.mockImplementation(key => (key === 'signature-session' ? {} : undefined));
  listCalendars.mockResolvedValue([{ id: 'cal-1', timezone: 'Europe/London', read_only: false }]);
  defaultCalendarFor.mockImplementation(cals => cals[0]);
  grantProvider.mockResolvedValue('google');
  syncListingConfigurations.mockImplementation(async ({ calendarId, processAlias }) => ({
    configurationIds: { 60: 'cfg-60' },
    publicData: {
      nylasConfigurationIds: { 60: 'cfg-60' },
      nylasCalendarId: calendarId,
      nylasMinBookingNoticeMinutes: 1440,
      nylasEventTypeKey: 'signature-session',
      calendarBookingEnabled: true,
      transactionProcessAlias: processAlias,
    },
  }));
});

describe('the reconcile loop and payout details', () => {
  it('calendar only: the listing stays not bookable, loop after loop', async () => {
    const { state, sdk } = makeMarketplace({ stripeConnected: false });
    getIntegrationSdk.mockReturnValue(sdk);

    await runReconcile();
    await runReconcile();

    expect(bookable(state)).toBe(false);
    expect(syncListingConfigurations).not.toHaveBeenCalled();
    expect(sdk.listings.update).not.toHaveBeenCalled();
  });

  it('payouts only (no calendar): not bookable', async () => {
    const { state, sdk } = makeMarketplace({ stripeConnected: true, grant: null });
    getIntegrationSdk.mockReturnValue(sdk);

    const summary = await runReconcile();

    expect(bookable(state)).toBe(false);
    expect(summary.coaches).toBe(0);
    expect(sdk.listings.update).not.toHaveBeenCalled();
  });

  it('both: bookable', async () => {
    const { state, sdk } = makeMarketplace({ stripeConnected: true });
    getIntegrationSdk.mockReturnValue(sdk);

    await runReconcile();

    expect(bookable(state)).toBe(true);
    expect(state.listing.attributes.publicData.transactionProcessAlias).toBe(
      'default-booking/release-4'
    );
  });

  it('payouts added later: the very next loop enables the listing, with no other action', async () => {
    const { state, sdk } = makeMarketplace({ stripeConnected: false });
    getIntegrationSdk.mockReturnValue(sdk);

    await runReconcile();
    expect(bookable(state)).toBe(false);

    state.stripeConnected = true; // the coach adds payout details
    const next = await runReconcile();

    expect(bookable(state)).toBe(true);
    expect(next.statuses).toEqual({ synced: 1 });
  });

  it('then stays quiet: once enabled, further loops change nothing', async () => {
    const { state, sdk } = makeMarketplace({ stripeConnected: true });
    getIntegrationSdk.mockReturnValue(sdk);

    await runReconcile();
    sdk.listings.update.mockClear();
    syncListingConfigurations.mockClear();
    const again = await runReconcile();

    expect(again.statuses).toEqual({ unchanged: 1 });
    expect(sdk.listings.update).not.toHaveBeenCalled();
    expect(syncListingConfigurations).not.toHaveBeenCalled();
    expect(bookable(state)).toBe(true);
  });

  it('payouts removed: the next loop switches booking off and reports it once; adding them back switches it on', async () => {
    const { state, sdk } = makeMarketplace({ stripeConnected: true });
    getIntegrationSdk.mockReturnValue(sdk);
    await runReconcile();
    expect(bookable(state)).toBe(true);
    log.error.mockClear();

    state.stripeConnected = false;
    const off = await runReconcile();
    expect(off.statuses).toEqual({ 'disabled-no-payouts': 1 });
    expect(bookable(state)).toBe(false);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'nylas-booking-disabled-no-payouts',
      expect.anything()
    );

    // Later loops: still off, and not reported again.
    const still = await runReconcile();
    expect(still.statuses).toEqual({ 'no-payouts': 1 });
    expect(log.error).toHaveBeenCalledTimes(1);

    state.stripeConnected = true;
    await runReconcile();
    expect(bookable(state)).toBe(true);
  });
});
