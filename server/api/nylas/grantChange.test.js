jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./db', () => ({
  isAvailable: jest.fn(() => true),
  findUpcomingByGrantId: jest.fn(async () => []),
}));
jest.mock('./scheduler', () => ({
  listCalendars: jest.fn(),
  defaultCalendarFor: jest.fn(),
}));
jest.mock('./listingSync', () => ({
  grantProvider: jest.fn(async () => 'google'),
  syncListingConfigurations: jest.fn(),
}));

const log = require('../../log');
const db = require('./db');
const { listCalendars, defaultCalendarFor } = require('./scheduler');
const { grantProvider, syncListingConfigurations } = require('./listingSync');
const { handleGrantChange, SENTRY_CODE } = require('./grantChange');

const calendarListing = (id, extra = {}) => ({
  id: { uuid: id },
  attributes: {
    title: 'Session',
    publicData: {
      calendarBookingEnabled: true,
      nylasConfigurationIds: { 60: 'old-cfg-60' },
      nylasConfigurationId: 'old-cfg-60',
      nylasEventTypeKey: 'one-to-one',
      nylasMinBookingNoticeMinutes: 1440,
      transactionProcessAlias: 'default-booking/release-4',
      ...extra,
    },
  },
});
const plainListing = id => ({ id: { uuid: id }, attributes: { publicData: {} } });

const makeSdk = listings => ({
  ownListings: {
    query: jest.fn(async () => ({ data: { data: listings } })),
    update: jest.fn(async () => ({})),
  },
});

const params = sdk => ({
  sdk,
  userId: 'coach-1',
  previousGrantId: 'grant-old',
  newGrantId: 'grant-new',
  newGrantEmail: 'new@example.com',
  coachName: 'Coach',
  siteUrl: 'https://revie-dev.onrender.com',
});

beforeEach(() => {
  jest.clearAllMocks();
  // Mock implementations do not survive between tests in this setup, so every one is set here.
  db.isAvailable.mockReturnValue(true);
  db.findUpcomingByGrantId.mockResolvedValue([]);
  listCalendars.mockResolvedValue([{ id: 'cal-new', timezone: 'Europe/London' }]);
  defaultCalendarFor.mockReturnValue({ id: 'cal-new', timezone: 'Europe/London' });
  grantProvider.mockResolvedValue('google');
  syncListingConfigurations.mockImplementation(async ({ listing, calendarId, processAlias }) => ({
    publicData: {
      nylasConfigurationIds: { 60: 'new-cfg-60' },
      nylasConfigurationId: 'new-cfg-60',
      nylasCalendarId: calendarId,
      calendarBookingEnabled: true,
      transactionProcessAlias: processAlias,
    },
    configurationIds: { 60: 'new-cfg-60' },
  }));
});

describe('handleGrantChange()', () => {
  it("re-creates a calendar listing's configurations on the new grant and points the listing at them", async () => {
    const sdk = makeSdk([calendarListing('l1')]);
    const outcome = await handleGrantChange(params(sdk));

    const call = syncListingConfigurations.mock.calls[0][0];
    expect(call.grantId).toBe('grant-new');
    expect(call.calendarId).toBe('cal-new');
    expect(call.eventTypeKey).toBe('one-to-one');
    expect(call.minBookingNoticeMinutes).toBe(1440);
    expect(call.processAlias).toBe('default-booking/release-4');
    // Handed over with no configuration ids, so the sync creates them rather than trying to update
    // ids that belong to the old grant.
    expect(call.listing.attributes.publicData.nylasConfigurationIds).toBeUndefined();
    expect(call.listing.attributes.publicData.nylasConfigurationId).toBeUndefined();

    const update = sdk.ownListings.update.mock.calls[0][0];
    expect(update.publicData.nylasConfigurationIds).toEqual({ 60: 'new-cfg-60' });
    expect(update.publicData.nylasCalendarId).toBe('cal-new');
    expect(update.publicData.nylasPreviousConfigurationIds).toEqual({ 60: 'old-cfg-60' });
    expect(update.availabilityPlan.timezone).toBe('Europe/London');
    expect(outcome.repointed).toEqual(['l1']);
  });

  it('leaves listings that are not calendar listings alone', async () => {
    const sdk = makeSdk([plainListing('l0'), calendarListing('l1')]);
    await handleGrantChange(params(sdk));
    expect(syncListingConfigurations).toHaveBeenCalledTimes(1);
    expect(sdk.ownListings.update).toHaveBeenCalledTimes(1);
  });

  it('always reports to Sentry under nylas-grant-changed, naming the sessions left on the old calendar', async () => {
    db.findUpcomingByGrantId.mockResolvedValue([{ sharetribe_transaction_id: 'tx-9' }]);
    await handleGrantChange(params(makeSdk([calendarListing('l1')])));

    expect(db.findUpcomingByGrantId).toHaveBeenCalledWith('grant-old');
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      SENTRY_CODE,
      expect.objectContaining({
        userId: 'coach-1',
        previousGrantId: 'grant-old',
        newGrantId: 'grant-new',
        repointedListings: ['l1'],
        failedListings: [],
        upcomingSessionsOnOldGrant: ['tx-9'],
      })
    );
    expect(SENTRY_CODE).toBe('nylas-grant-changed');
  });

  it('carries on and reports when one listing fails', async () => {
    syncListingConfigurations.mockRejectedValueOnce(new Error('nylas down'));
    const sdk = makeSdk([calendarListing('l1'), calendarListing('l2')]);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const outcome = await handleGrantChange(params(sdk));

    expect(outcome.failed).toEqual(['l1']);
    expect(outcome.repointed).toEqual(['l2']);
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      SENTRY_CODE,
      expect.objectContaining({ failedListings: ['l1'], repointedListings: ['l2'] })
    );
    spy.mockRestore();
  });

  it('changes nothing and says why when the new calendar has nothing writable', async () => {
    defaultCalendarFor.mockReturnValue(undefined);
    const sdk = makeSdk([calendarListing('l1')]);
    await handleGrantChange(params(sdk));

    expect(sdk.ownListings.update).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      SENTRY_CODE,
      expect.objectContaining({ problem: 'no-writable-calendar-on-new-grant' })
    );
  });

  it("never throws, even when the coach's listings cannot be read, and still reports", async () => {
    const sdk = makeSdk([]);
    sdk.ownListings.query.mockRejectedValue(new Error('marketplace down'));
    await expect(handleGrantChange(params(sdk))).resolves.toBeDefined();
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      SENTRY_CODE,
      expect.objectContaining({ problem: expect.stringContaining('marketplace down') })
    );
  });
});
