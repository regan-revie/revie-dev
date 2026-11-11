jest.mock('../../log', () => ({ error: jest.fn() }));
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

const { listCalendars, defaultCalendarFor, getEventType } = require('./scheduler');
const { grantProvider, syncListingConfigurations } = require('./listingSync');
const log = require('../../log');
const { ensureListingBookable, signatureOf } = require('./ensureBookable');

const ENV = { BOOKING_PROCESS_ALIAS: 'default-booking/release-4' };
const profile = (privateData = { nylasGrantId: 'g1', nylasGrantEmail: 'coach@example.com' }) => ({
  displayName: 'Coach',
  privateData,
});

// A listing as a coach publishes it: stock alias, no Nylas fields at all.
const newListing = (publicData = {}, extra = {}) => ({
  id: { uuid: 'l1' },
  attributes: {
    title: 'Find your focus',
    publicData: {
      listingType: 'signature-session',
      unitType: 'fixed',
      transactionProcessAlias: 'default-booking/release-1',
      ...publicData,
    },
    ...extra,
  },
});

const run = (listing, extra = {}) => {
  const updateListing = jest.fn(async () => ({ data: { data: { id: { uuid: 'l1' } } } }));
  const promise = ensureListingBookable({
    listing,
    profile: profile(),
    stripeConnected: true,
    updateListing,
    siteUrl: 'https://revie-dev.onrender.com',
    env: ENV,
    ...extra,
  });
  return promise.then(result => ({ result, updateListing }));
};

beforeEach(() => {
  jest.clearAllMocks();
  // Mock implementations do not survive between tests in this setup, so every one is set here.
  getEventType.mockImplementation(key =>
    key === 'signature-session' ? { title: 'Signature' } : undefined
  );
  listCalendars.mockResolvedValue([{ id: 'cal-1', timezone: 'Europe/London', read_only: false }]);
  defaultCalendarFor.mockImplementation(cals => cals[0]);
  grantProvider.mockResolvedValue('google');
  syncListingConfigurations.mockImplementation(async ({ listing, calendarId, processAlias }) => {
    const lengths = (
      listing.attributes.publicData.priceVariants || [{ bookingLengthInMinutes: 60 }]
    ).map(v => v.bookingLengthInMinutes);
    const ids = Object.fromEntries(lengths.map(l => [String(l), `cfg-${l}`]));
    return {
      configurationIds: ids,
      publicData: {
        nylasConfigurationIds: ids,
        nylasCalendarId: calendarId,
        nylasMinBookingNoticeMinutes: 1440,
        nylasEventTypeKey: 'signature-session',
        calendarBookingEnabled: true,
        transactionProcessAlias: processAlias,
      },
    };
  });
});

describe('a brand-new session listing', () => {
  it('gets configurations, calendar, default Mon-Fri 9-17 hours, the release-4 alias and a plan in one update', async () => {
    const { result, updateListing } = await run(newListing());

    expect(result.status).toBe('synced');
    expect(syncListingConfigurations.mock.calls[0][0]).toMatchObject({
      grantId: 'g1',
      calendarId: 'cal-1',
      processAlias: 'default-booking/release-4',
      eventTypeKey: 'signature-session',
      minBookingNoticeMinutes: 1440,
      coachEmail: 'coach@example.com',
      coachName: 'Coach',
    });
    expect(updateListing).toHaveBeenCalledTimes(1);
    const update = updateListing.mock.calls[0][0];
    expect(update.publicData).toMatchObject({
      calendarBookingEnabled: true,
      transactionProcessAlias: 'default-booking/release-4',
      nylasOpenHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
      nylasSyncSignature: expect.any(String),
    });
    expect(update.availabilityPlan.timezone).toBe('Europe/London');
  });

  it("uses the coach's saved hours and timezone instead of the default", async () => {
    const { updateListing } = await run(newListing(), {
      profile: profile({
        nylasGrantId: 'g1',
        bookingHours: { days: [2, 4], start: '10:00', end: '14:00', timeZone: 'Europe/Paris' },
      }),
    });
    const update = updateListing.mock.calls[0][0];
    expect(update.publicData.nylasOpenHours).toEqual({
      days: [2, 4],
      start: '10:00',
      end: '14:00',
    });
    expect(update.availabilityPlan.timezone).toBe('Europe/Paris');
  });

  it('syncs one configuration per price variant length', async () => {
    const listing = newListing({
      unitType: 'fixed',
      priceVariationsEnabled: true,
      priceVariants: [
        { name: 'Short', bookingLengthInMinutes: 30, priceInSubunits: 5000 },
        { name: 'Long', bookingLengthInMinutes: 90, priceInSubunits: 12000 },
      ],
    });
    const { updateListing } = await run(listing);
    expect(updateListing.mock.calls[0][0].publicData.nylasConfigurationIds).toEqual({
      30: 'cfg-30',
      90: 'cfg-90',
    });
  });

  it('is refused, writing nothing, when the process alias is not configured', async () => {
    const { result, updateListing } = await run(newListing(), { env: {} });
    expect(result.status).toBe('no-process-alias');
    expect(listCalendars).not.toHaveBeenCalled();
    expect(updateListing).not.toHaveBeenCalled();
  });
});

describe('idempotence', () => {
  it('does nothing at all the second time: no Nylas call, no listing write', async () => {
    const first = await run(newListing());
    const written = first.updateListing.mock.calls[0][0];

    // The listing as it is after the first update.
    const settled = newListing(written.publicData, {
      availabilityPlan: written.availabilityPlan,
    });
    jest.clearAllMocks();
    const second = await run(settled);

    expect(second.result.status).toBe('unchanged');
    expect(listCalendars).not.toHaveBeenCalled();
    expect(syncListingConfigurations).not.toHaveBeenCalled();
    expect(second.updateListing).not.toHaveBeenCalled();
  });

  it('syncs again when hours, a price variant or the title change', async () => {
    const first = await run(newListing());
    const written = first.updateListing.mock.calls[0][0];
    const settled = (extra = {}, attrs = {}) =>
      newListing(
        { ...written.publicData, ...extra },
        { availabilityPlan: written.availabilityPlan, ...attrs }
      );

    const changedHours = await run(settled(), {
      profile: profile({
        nylasGrantId: 'g1',
        bookingHours: { days: [1], start: '10:00', end: '12:00', timeZone: 'Europe/London' },
      }),
    });
    expect(changedHours.result.status).toBe('synced');

    const newVariant = await run(
      settled({
        priceVariationsEnabled: true,
        priceVariants: [{ name: 'A', bookingLengthInMinutes: 45, priceInSubunits: 1 }],
      })
    );
    expect(newVariant.result.status).toBe('synced');

    const retitled = await run(settled({}, { title: 'A new title' }));
    expect(retitled.result.status).toBe('synced');
  });
});

describe('a listing enabled before signatures existed (the Test Session)', () => {
  const legacy = () =>
    newListing(
      {
        calendarBookingEnabled: true,
        transactionProcessAlias: 'default-booking/release-4',
        nylasConfigurationIds: { 60: 'cfg-60' },
        nylasCalendarId: 'cal-1',
        nylasMinBookingNoticeMinutes: 1440,
        nylasOpenHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
      },
      { availabilityPlan: { timezone: 'America/Los_Angeles' } }
    );

  it('is adopted: the signature is stamped and nothing else is touched', async () => {
    const { result, updateListing } = await run(legacy());

    expect(result.status).toBe('adopted');
    expect(updateListing).toHaveBeenCalledTimes(1);
    expect(updateListing.mock.calls[0][0]).toEqual({
      id: { uuid: 'l1' },
      publicData: { nylasSyncSignature: expect.any(String) },
    });
    expect(listCalendars).not.toHaveBeenCalled();
    expect(syncListingConfigurations).not.toHaveBeenCalled();
  });

  it('keeps the process it is on, even if the configured alias is different', async () => {
    const listing = legacy();
    listing.attributes.publicData.transactionProcessAlias = 'default-booking/release-3';
    const { result } = await run(listing);
    expect(result.status).toBe('adopted');
  });

  it('is fully synced, not adopted, if it is missing a configuration for one of its lengths', async () => {
    const listing = legacy();
    Object.assign(listing.attributes.publicData, {
      priceVariationsEnabled: true,
      priceVariants: [
        { name: 'A', bookingLengthInMinutes: 60, priceInSubunits: 1 },
        { name: 'B', bookingLengthInMinutes: 90, priceInSubunits: 1 },
      ],
    });
    const { result } = await run(listing);
    expect(result.status).toBe('synced');
  });

  it('is synced when the coach has since saved different hours', async () => {
    const { result, updateListing } = await run(legacy(), {
      profile: profile({
        nylasGrantId: 'g1',
        bookingHours: { days: [1], start: '10:00', end: '12:00', timeZone: 'Europe/London' },
      }),
    });
    expect(result.status).toBe('synced');
    expect(updateListing.mock.calls[0][0].publicData.nylasOpenHours).toEqual({
      days: [1],
      start: '10:00',
      end: '12:00',
    });
    // The calendar it was already on is kept.
    expect(syncListingConfigurations.mock.calls[0][0].calendarId).toBe('cal-1');
  });
});

describe('who and what it leaves alone', () => {
  it('does nothing for a coach with no connected calendar', async () => {
    const { result, updateListing } = await run(newListing(), { profile: profile({}) });
    expect(result.status).toBe('no-grant');
    expect(listCalendars).not.toHaveBeenCalled();
    expect(updateListing).not.toHaveBeenCalled();
  });

  it('does nothing for a listing that is not a session', async () => {
    const { result, updateListing } = await run(newListing({ listingType: 'something-else' }));
    expect(result.status).toBe('ineligible');
    expect(updateListing).not.toHaveBeenCalled();
  });

  it('writes nothing and says so when the calendar has nothing writable', async () => {
    defaultCalendarFor.mockReturnValue(undefined);
    const { result, updateListing } = await run(newListing());
    expect(result.status).toBe('no-calendar');
    expect(updateListing).not.toHaveBeenCalled();
  });

  it('forces a sync of an already-synced listing when asked to (an explicit enable)', async () => {
    const first = await run(newListing());
    const written = first.updateListing.mock.calls[0][0];
    const settled = newListing(written.publicData, { availabilityPlan: written.availabilityPlan });
    const forced = await run(settled, { force: true });
    expect(forced.result.status).toBe('synced');
  });
});

// A session is bookable only with a connected calendar AND payout details.
describe('payout details', () => {
  const withPayouts = stripeConnected => ({ stripeConnected });

  it('calendar only (no payouts): a new listing is left not bookable and nothing is written or called', async () => {
    const { result, updateListing } = await run(newListing(), withPayouts(false));
    expect(result.status).toBe('no-payouts');
    expect(listCalendars).not.toHaveBeenCalled();
    expect(syncListingConfigurations).not.toHaveBeenCalled();
    expect(updateListing).not.toHaveBeenCalled();
  });

  it('payouts only (no calendar): not bookable either', async () => {
    const { result, updateListing } = await run(newListing(), {
      ...withPayouts(true),
      profile: profile({}),
    });
    expect(result.status).toBe('no-grant');
    expect(updateListing).not.toHaveBeenCalled();
  });

  it('both: bookable', async () => {
    const { result, updateListing } = await run(newListing(), withPayouts(true));
    expect(result.status).toBe('synced');
    expect(updateListing.mock.calls[0][0].publicData.calendarBookingEnabled).toBe(true);
  });

  it('payouts added later: the next run enables a listing that was left not bookable', async () => {
    const first = await run(newListing(), withPayouts(false));
    expect(first.result.status).toBe('no-payouts');

    // The coach adds payout details; the listing is exactly as it was.
    const second = await run(newListing(), withPayouts(true));
    expect(second.result.status).toBe('synced');
    expect(second.updateListing.mock.calls[0][0].publicData).toMatchObject({
      calendarBookingEnabled: true,
      nylasConfigurationIds: expect.any(Object),
    });
  });

  it('payouts added later: also re-enables a listing that was switched off, with its setup intact', async () => {
    const first = await run(newListing(), withPayouts(true));
    const written = first.updateListing.mock.calls[0][0].publicData;
    // Booking switched off by the payouts check; everything else kept.
    const switchedOff = newListing(
      { ...written, calendarBookingEnabled: false },
      { availabilityPlan: first.updateListing.mock.calls[0][0].availabilityPlan }
    );
    jest.clearAllMocks();
    const back = await run(switchedOff, withPayouts(true));
    expect(back.result.status).toBe('synced');
    expect(back.updateListing.mock.calls[0][0].publicData.calendarBookingEnabled).toBe(true);
  });

  it('payouts removed: an enabled listing is switched off (only that), and reported once', async () => {
    const first = await run(newListing(), withPayouts(true));
    const written = first.updateListing.mock.calls[0][0];
    const enabled = newListing(written.publicData, { availabilityPlan: written.availabilityPlan });
    jest.clearAllMocks();

    const off = await run(enabled, withPayouts(false));
    expect(off.result.status).toBe('disabled-no-payouts');
    expect(off.updateListing).toHaveBeenCalledTimes(1);
    expect(off.updateListing.mock.calls[0][0]).toEqual({
      id: { uuid: 'l1' },
      publicData: { calendarBookingEnabled: false },
    });
    expect(listCalendars).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-booking-disabled-no-payouts', {
      listingId: 'l1',
    });

    // The next tick finds a listing that is already off: nothing written, nothing reported again.
    const disabled = newListing({ ...written.publicData, calendarBookingEnabled: false });
    jest.clearAllMocks();
    const again = await run(disabled, withPayouts(false));
    expect(again.result.status).toBe('no-payouts');
    expect(again.updateListing).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('payout status unknown (not readable): a working listing is left exactly as it is', async () => {
    const first = await run(newListing(), withPayouts(true));
    const written = first.updateListing.mock.calls[0][0];
    const enabled = newListing(written.publicData, { availabilityPlan: written.availabilityPlan });
    jest.clearAllMocks();

    const unknown = await run(enabled, { stripeConnected: undefined });
    expect(unknown.result.status).toBe('payouts-unknown');
    expect(unknown.updateListing).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('an enabled listing from before payouts were part of the signature is re-stamped, not re-synced, when the coach has payouts', async () => {
    // The Test Session: enabled, complete, carrying the old signature (without payout status).
    const legacySignature = signatureOf({
      v: 1,
      grantId: 'g1',
      eventTypeKey: 'signature-session',
      lengths: [60],
      title: 'Find your focus',
      coachName: 'Coach',
      notice: 1440,
      alias: 'default-booking/release-4',
      hours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
      timeZone: null,
      calendarId: null,
    });
    const listing = newListing(
      {
        calendarBookingEnabled: true,
        transactionProcessAlias: 'default-booking/release-4',
        nylasConfigurationIds: { 60: 'cfg-60' },
        nylasCalendarId: 'cal-1',
        nylasMinBookingNoticeMinutes: 1440,
        nylasOpenHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
        nylasSyncSignature: legacySignature,
      },
      { availabilityPlan: { timezone: 'America/Los_Angeles' } }
    );

    const { result, updateListing } = await run(listing, withPayouts(true));

    expect(result.status).toBe('adopted');
    expect(updateListing.mock.calls[0][0]).toEqual({
      id: { uuid: 'l1' },
      publicData: { nylasSyncSignature: expect.any(String) },
    });
    expect(updateListing.mock.calls[0][0].publicData.nylasSyncSignature).not.toBe(legacySignature);
    expect(listCalendars).not.toHaveBeenCalled();
    expect(syncListingConfigurations).not.toHaveBeenCalled();
  });
});
