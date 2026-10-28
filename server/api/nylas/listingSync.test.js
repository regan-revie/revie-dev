jest.mock('./client', () => ({ nylasRequest: jest.fn() }));
const { nylasRequest } = require('./client');
const {
  resolveBookingProcessAlias,
  manageUrlFor,
  grantProvider,
  syncListingConfigurations,
} = require('./listingSync');

beforeEach(() => jest.clearAllMocks());

describe('resolveBookingProcessAlias()', () => {
  it('returns the configured alias', () => {
    expect(
      resolveBookingProcessAlias({ BOOKING_PROCESS_ALIAS: 'default-booking/release-2' })
    ).toEqual({ alias: 'default-booking/release-2' });
  });

  it('refuses when the setting is missing or blank, instead of defaulting to release-1', () => {
    expect(resolveBookingProcessAlias({}).error).toMatch(/not set/);
    expect(resolveBookingProcessAlias({ BOOKING_PROCESS_ALIAS: '   ' }).error).toMatch(/not set/);
  });

  it('refuses a value that is not a booking process alias', () => {
    expect(resolveBookingProcessAlias({ BOOKING_PROCESS_ALIAS: 'release-2' }).error).toMatch(
      /must look like/
    );
    expect(
      resolveBookingProcessAlias({ BOOKING_PROCESS_ALIAS: 'default-purchase/release-1' }).error
    ).toMatch(/must look like/);
  });
});

describe('manageUrlFor()', () => {
  it('links to the orders list, or to one session when it has a transaction id', () => {
    expect(manageUrlFor('https://revie.example/')).toBe('https://revie.example/inbox/orders');
    expect(manageUrlFor('https://revie.example', 'tx-1')).toBe('https://revie.example/order/tx-1');
  });
});

describe('grantProvider()', () => {
  it("reads the grant's provider and tolerates a failure", async () => {
    nylasRequest.mockResolvedValueOnce({ provider: 'google' });
    expect(await grantProvider('g')).toBe('google');
    nylasRequest.mockRejectedValueOnce(new Error('boom'));
    expect(await grantProvider('g')).toBeNull();
  });
});

describe('syncListingConfigurations()', () => {
  const listing = publicData => ({ attributes: { title: 'Find your focus', publicData } });
  const variants = (...lengths) => ({
    unitType: 'fixed',
    priceVariationsEnabled: true,
    priceVariants: lengths.map(l => ({ name: `${l} min`, bookingLengthInMinutes: l })),
  });
  const run = (publicData, sync) =>
    syncListingConfigurations({
      listing: listing(publicData),
      grantId: 'g',
      provider: 'google',
      coachName: 'Ada',
      coachEmail: 'ada@example.com',
      calendarId: 'cal-1',
      eventTypeKey: 'signature-session',
      minBookingNoticeMinutes: 1440,
      siteUrl: 'https://revie.example',
      processAlias: 'default-booking/release-2',
      sync,
    });

  it('syncs one configuration per length and records them with the alias, in one publicData', async () => {
    const sync = jest.fn(async ({ durationMinutes }) => ({
      configuration: { id: `cfg-${durationMinutes}` },
    }));
    const { publicData } = await run(variants(30, 60, 90), sync);

    expect(sync).toHaveBeenCalledTimes(3);
    expect(publicData).toMatchObject({
      nylasConfigurationIds: { 30: 'cfg-30', 60: 'cfg-60', 90: 'cfg-90' },
      nylasConfigurationId: 'cfg-60',
      nylasCalendarId: 'cal-1',
      calendarBookingEnabled: true,
      transactionProcessAlias: 'default-booking/release-2',
    });
  });

  it('updates the configuration a length already has instead of creating another', async () => {
    const sync = jest.fn(async ({ configurationId, durationMinutes }) => ({
      configuration: { id: configurationId || `new-${durationMinutes}` },
    }));
    const { publicData } = await run(
      { ...variants(60, 90), nylasConfigurationId: 'cfg-old-60' },
      sync
    );
    expect(sync.mock.calls[0][0]).toMatchObject({
      durationMinutes: 60,
      configurationId: 'cfg-old-60',
    });
    expect(sync.mock.calls[1][0]).toMatchObject({
      durationMinutes: 90,
      configurationId: undefined,
    });
    expect(publicData.nylasConfigurationIds).toEqual({ 60: 'cfg-old-60', 90: 'new-90' });
  });

  it('keeps configurations for lengths no longer sold, so booked sessions can still be cancelled', async () => {
    const sync = jest.fn(async ({ durationMinutes }) => ({
      configuration: { id: `cfg-${durationMinutes}` },
    }));
    const { publicData } = await run(
      { ...variants(60), nylasConfigurationIds: { 45: 'cfg-45-old' } },
      sync
    );
    expect(publicData.nylasConfigurationIds).toEqual({ 45: 'cfg-45-old', 60: 'cfg-60' });
  });

  it('syncs a single 60-minute configuration for a listing without variants', async () => {
    const sync = jest.fn(async () => ({ configuration: { id: 'cfg-1' } }));
    const { publicData } = await run({}, sync);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(publicData.nylasConfigurationIds).toEqual({ 60: 'cfg-1' });
  });

  it("passes the listing's title, a Meet request for Google and the Revie link through", async () => {
    const sync = jest.fn(async () => ({ configuration: { id: 'c' } }));
    await run({}, sync);
    expect(sync.mock.calls[0][0]).toMatchObject({
      listingTitle: 'Find your focus',
      conferencing: { provider: 'Google Meet', autocreate: {} },
      manageUrl: 'https://revie.example/inbox/orders',
    });
  });

  it('refuses to write links with no absolute site URL', async () => {
    await expect(
      syncListingConfigurations({
        listing: listing({}),
        grantId: 'g',
        siteUrl: '',
        sync: jest.fn(),
      })
    ).rejects.toThrow(/site URL/);
  });
});
