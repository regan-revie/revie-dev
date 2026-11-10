jest.mock('./db', () => ({ withAdvisoryLock: jest.fn() }));
jest.mock('./ensureBookable', () => ({ ensureListingBookable: jest.fn() }));

const db = require('./db');
const { ensureListingBookable } = require('./ensureBookable');
const { ensureCoachListings, ensureOwnListings, updaterFor } = require('./ensureCoach');

const listing = id => ({ id: { uuid: id }, attributes: { publicData: {} } });

beforeEach(() => {
  jest.clearAllMocks();
  db.withAdvisoryLock.mockImplementation(async (key, fn) => ({ locked: true, value: await fn() }));
  ensureListingBookable.mockResolvedValue({ status: 'synced' });
});

describe('ensureCoachListings()', () => {
  it('runs every listing under one lock named for the coach', async () => {
    const out = await ensureCoachListings({
      userId: 'u1',
      profile: {},
      listings: [listing('a'), listing('b')],
      updateListing: jest.fn(),
      siteUrl: 'https://x',
    });
    expect(db.withAdvisoryLock).toHaveBeenCalledWith('nylas-ensure-coach:u1', expect.any(Function));
    expect(out.results).toEqual([
      { listingId: 'a', status: 'synced' },
      { listingId: 'b', status: 'synced' },
    ]);
  });

  it('does nothing and says so when another worker holds the coach', async () => {
    db.withAdvisoryLock.mockResolvedValue({ locked: false });
    const out = await ensureCoachListings({
      userId: 'u1',
      profile: {},
      listings: [listing('a')],
      updateListing: jest.fn(),
      siteUrl: 'https://x',
    });
    expect(out).toEqual({ locked: false, results: [] });
    expect(ensureListingBookable).not.toHaveBeenCalled();
  });

  it('carries on past a listing that fails, and reports it', async () => {
    ensureListingBookable
      .mockRejectedValueOnce(new Error('nylas down'))
      .mockResolvedValueOnce({ status: 'unchanged' });
    const out = await ensureCoachListings({
      userId: 'u1',
      profile: {},
      listings: [listing('a'), listing('b')],
      updateListing: jest.fn(),
      siteUrl: 'https://x',
    });
    expect(out.results[0]).toMatchObject({ listingId: 'a', status: 'error' });
    expect(out.results[1]).toEqual({ listingId: 'b', status: 'unchanged' });
  });
});

describe('ensureOwnListings()', () => {
  it("reads and writes the coach's published listings with their own SDK", async () => {
    const sdk = {
      ownListings: {
        query: jest.fn(async () => ({ data: { data: [listing('a')] } })),
        update: jest.fn(async () => ({})),
      },
    };
    await ensureOwnListings({
      sdk,
      userId: 'u1',
      profile: { privateData: {} },
      siteUrl: 'https://x',
    });

    expect(sdk.ownListings.query).toHaveBeenCalledWith({ states: 'published', perPage: 100 });
    // Hand the update function to the (mocked) ensure call and use it.
    const { updateListing } = ensureListingBookable.mock.calls[0][0];
    await updateListing({ id: { uuid: 'a' }, publicData: { x: 1 } });
    expect(sdk.ownListings.update).toHaveBeenCalledWith({
      id: { uuid: 'a' },
      publicData: { x: 1 },
    });
  });
});

describe('updaterFor()', () => {
  it('sends no availabilityPlan at all when there is none, rather than undefined', async () => {
    const update = jest.fn();
    await updaterFor(update)({ id: 'a', publicData: { x: 1 } });
    expect(update.mock.calls[0][0]).toEqual({ id: 'a', publicData: { x: 1 } });
    expect('availabilityPlan' in update.mock.calls[0][0]).toBe(false);

    await updaterFor(update)({ id: 'a', publicData: {}, availabilityPlan: { type: 'p' } });
    expect(update.mock.calls[1][0].availabilityPlan).toEqual({ type: 'p' });
  });
});
