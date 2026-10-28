const { permissiveAvailabilityPlan, WEEKDAYS } = require('./enableListing');

describe('permissiveAvailabilityPlan()', () => {
  const plan = permissiveAvailabilityPlan('Europe/London');

  it('carries the calendar timezone, without which no booking form renders at all', () => {
    // OrderPanel derives timeZone from availabilityPlan.timezone and renders nothing without it,
    // so a plan missing this makes the booking UI silently disappear.
    expect(plan.timezone).toBe('Europe/London');
    expect(plan.type).toBe('availability-plan/time');
  });

  it('opens every day fully, so Sharetribe never second-guesses Nylas', () => {
    // create-pending-booking validates the requested time against this plan. Nylas is the real
    // authority on availability, so anything narrower would reject bookings Nylas had just offered.
    expect(plan.entries).toHaveLength(7);
    expect(new Set(plan.entries.map(e => e.dayOfWeek))).toEqual(new Set(WEEKDAYS));
    plan.entries.forEach(e => {
      expect(e.startTime).toBe('00:00');
      // '00:00' means end of day here. The API rejects '24:00' as a format error and '23:59' as not
      // a multiple of five minutes; '24:00' is only the template's internal representation.
      expect(e.endTime).toBe('00:00');
      expect(e.seats).toBe(1);
    });
  });

  it('keeps one seat per slot, matching the listing type', () => {
    // The listing type is availabilityType oneSeat; more would let two clients book one session.
    plan.entries.forEach(e => expect(e.seats).toBe(1));
  });
});

// The handler itself. The permissive plan above was tested while nothing exercised the endpoint, so
// these run it end to end with the Marketplace SDK and Nylas mocked.
describe('enable-listing handler', () => {
  jest.resetModules();
  const mockOwnListingsUpdate = jest.fn();
  const mockSync = jest.fn();

  const load = () => {
    jest.resetModules();
    jest.doMock('../../api-util/sdk', () => ({
      createCookieTokenStore: jest.fn(),
      getSdk: jest.fn(() => ({
        currentUser: {
          show: async () => ({
            data: {
              data: {
                attributes: {
                  profile: {
                    displayName: 'Ada',
                    privateData: { nylasGrantId: 'g', nylasGrantEmail: 'ada@example.com' },
                  },
                },
              },
            },
          }),
        },
        ownListings: {
          show: async () => ({
            data: { data: { attributes: { title: 'Find your focus', publicData: {} } } },
          }),
          update: mockOwnListingsUpdate,
        },
      })),
      handleError: jest.fn(),
      serialize: x => JSON.stringify(x),
    }));
    jest.doMock('./config', () => ({ isConfigured: () => true }));
    jest.doMock('./scheduler', () => ({
      listCalendars: async () => [
        { id: 'cal-1', read_only: false, is_primary: true, timezone: 'Europe/London' },
      ],
      defaultCalendarFor: cals => cals[0],
      getEventType: key => (key === 'signature-session' ? {} : undefined),
      SCHEDULING_DEFAULTS: { minBookingNoticeMinutes: 1440 },
    }));
    jest.doMock('./listingSync', () => ({
      resolveBookingProcessAlias: jest.requireActual('./listingSync').resolveBookingProcessAlias,
      grantProvider: async () => 'google',
      syncListingConfigurations: mockSync,
    }));
    return require('./enableListing');
  };

  const call = async body => {
    const handler = load();
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      },
      set() {
        return this;
      },
      send(b) {
        this.body = b;
        return this;
      },
    };
    await handler({ body }, res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOwnListingsUpdate.mockResolvedValue({ data: { data: { id: { uuid: 'l-1' } } } });
    mockSync.mockResolvedValue({
      publicData: {
        nylasConfigurationIds: { 60: 'cfg-60' },
        calendarBookingEnabled: true,
        transactionProcessAlias: 'default-booking/release-2',
      },
      configurationIds: { 60: 'cfg-60' },
    });
    delete process.env.BOOKING_PROCESS_ALIAS;
  });

  it('refuses, before touching Nylas or the listing, when BOOKING_PROCESS_ALIAS is missing', async () => {
    const res = await call({ listingId: 'l-1', eventTypeKey: 'signature-session' });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('no-process-alias');
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockOwnListingsUpdate).not.toHaveBeenCalled();
  });

  it('writes the alias in the same listing update as the configuration ids', async () => {
    process.env.BOOKING_PROCESS_ALIAS = 'default-booking/release-2';
    process.env.REACT_APP_MARKETPLACE_ROOT_URL = 'https://revie.example';
    const res = await call({ listingId: 'l-1', eventTypeKey: 'signature-session' });

    expect(res.statusCode).toBe(200);
    expect(mockSync.mock.calls[0][0]).toMatchObject({
      processAlias: 'default-booking/release-2',
      siteUrl: 'https://revie.example',
      calendarId: 'cal-1',
    });
    expect(mockOwnListingsUpdate).toHaveBeenCalledTimes(1);
    expect(mockOwnListingsUpdate.mock.calls[0][0].publicData).toMatchObject({
      nylasConfigurationIds: { 60: 'cfg-60' },
      transactionProcessAlias: 'default-booking/release-2',
    });
  });
});
