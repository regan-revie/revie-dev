jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./db', () => ({ isAvailable: jest.fn() }));
jest.mock('./integration', () => ({ getIntegrationSdk: jest.fn() }));
jest.mock('./ensureCoach', () => ({
  ensureCoachListings: jest.fn(),
  updaterFor: jest.fn(update => update),
}));

const log = require('../../log');
const db = require('./db');
const { getIntegrationSdk } = require('./integration');
const { ensureCoachListings } = require('./ensureCoach');

const loadReconcile = () => {
  let mod;
  // Fresh module state (the failure backoff and the one-time warning live in the module).
  jest.isolateModules(() => {
    mod = require('./reconcile');
  });
  return mod.runReconcile;
};

const listing = (id, authorId) => ({
  id: { uuid: id },
  attributes: { publicData: {} },
  relationships: { author: { data: { id: { uuid: authorId } } } },
});
const author = (id, privateData) => ({
  type: 'user',
  id: { uuid: id },
  attributes: { profile: { displayName: id, privateData } },
});

const makeSdk = pages => {
  const query = jest.fn(async ({ page }) => pages[page - 1]);
  return { listings: { query, update: jest.fn() } };
};
const page = (listings, users, totalPages = 1) => ({
  data: { data: listings, included: users, meta: { totalPages } },
});

beforeEach(() => {
  jest.clearAllMocks();
  // Mock implementations do not survive between tests in this setup, so every one is set here.
  db.isAvailable.mockReturnValue(true);
  ensureCoachListings.mockImplementation(async ({ listings }) => ({
    locked: true,
    results: listings.map(l => ({ listingId: l.id.uuid, status: 'unchanged' })),
  }));
  process.env.BOOKING_PROCESS_ALIAS = 'default-booking/release-4';
});

describe('runReconcile()', () => {
  it('does nothing without Integration credentials or a database', async () => {
    getIntegrationSdk.mockReturnValue(null);
    expect(await loadReconcile()()).toEqual({ skipped: true });

    getIntegrationSdk.mockReturnValue(makeSdk([]));
    db.isAvailable.mockReturnValue(false);
    expect(await loadReconcile()()).toEqual({ skipped: true });
  });

  it("hands each coach's listings, with that coach's profile, to the per-coach runner", async () => {
    getIntegrationSdk.mockReturnValue(
      makeSdk([
        page(
          [listing('l1', 'u1'), listing('l2', 'u1'), listing('l3', 'u2')],
          [author('u1', { nylasGrantId: 'g1' }), author('u2', { nylasGrantId: 'g2' })]
        ),
      ])
    );
    const summary = await loadReconcile()();

    expect(ensureCoachListings).toHaveBeenCalledTimes(2);
    const first = ensureCoachListings.mock.calls[0][0];
    expect(first.userId).toBe('u1');
    expect(first.profile.privateData.nylasGrantId).toBe('g1');
    expect(first.listings.map(l => l.id.uuid)).toEqual(['l1', 'l2']);
    expect(summary).toMatchObject({ coaches: 2, listings: 3, statuses: { unchanged: 3 } });
  });

  it("passes the coach's payout status (a user attribute, not part of the profile) along", async () => {
    const user = author('u1', { nylasGrantId: 'g1' });
    user.attributes.stripeConnected = true;
    getIntegrationSdk.mockReturnValue(makeSdk([page([listing('l1', 'u1')], [user])]));
    await loadReconcile()();
    expect(ensureCoachListings.mock.calls[0][0].stripeConnected).toBe(true);
  });

  it('asks only for published listings, with their authors', async () => {
    const sdk = makeSdk([page([], [])]);
    getIntegrationSdk.mockReturnValue(sdk);
    await loadReconcile()();
    expect(sdk.listings.query).toHaveBeenCalledWith(
      expect.objectContaining({ states: 'published', include: ['author'] })
    );
  });

  it('skips coaches with no connected calendar without any further call', async () => {
    getIntegrationSdk.mockReturnValue(makeSdk([page([listing('l1', 'u1')], [author('u1', {})])]));
    const summary = await loadReconcile()();
    expect(ensureCoachListings).not.toHaveBeenCalled();
    expect(summary.coaches).toBe(0);
  });

  it('reads every page of listings', async () => {
    const sdk = makeSdk([
      page([listing('l1', 'u1')], [author('u1', { nylasGrantId: 'g1' })], 2),
      page([listing('l2', 'u1')], [author('u1', { nylasGrantId: 'g1' })], 2),
    ]);
    getIntegrationSdk.mockReturnValue(sdk);
    await loadReconcile()();
    expect(sdk.listings.query).toHaveBeenCalledTimes(2);
    expect(ensureCoachListings.mock.calls[0][0].listings).toHaveLength(2);
  });

  it('counts a coach another worker holds as locked, and moves on', async () => {
    ensureCoachListings.mockResolvedValue({ locked: false, results: [] });
    getIntegrationSdk.mockReturnValue(
      makeSdk([page([listing('l1', 'u1')], [author('u1', { nylasGrantId: 'g1' })])])
    );
    const summary = await loadReconcile()();
    expect(summary.locked).toBe(1);
    expect(summary.listings).toBe(0);
  });

  it('is paused, once and quietly, while BOOKING_PROCESS_ALIAS is missing', async () => {
    delete process.env.BOOKING_PROCESS_ALIAS;
    const sdk = makeSdk([page([], [])]);
    getIntegrationSdk.mockReturnValue(sdk);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const run = loadReconcile();

    expect(await run()).toMatchObject({ skipped: true });
    await run();
    expect(sdk.listings.query).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  describe('a listing that keeps failing', () => {
    const failing = () =>
      ensureCoachListings.mockImplementation(async ({ listings }) => ({
        locked: true,
        results: listings.map(l => ({
          listingId: l.id.uuid,
          status: 'error',
          error: new Error('nylas down'),
        })),
      }));

    it('is reported to Sentry, then left alone for ten minutes before being tried again', async () => {
      failing();
      getIntegrationSdk.mockReturnValue(
        makeSdk([page([listing('l1', 'u1')], [author('u1', { nylasGrantId: 'g1' })])])
      );
      const run = loadReconcile();
      const t0 = 1_000_000;

      await run({ now: t0 });
      expect(log.error).toHaveBeenCalledWith(
        expect.any(Error),
        'nylas-ensure-bookable-failed',
        expect.objectContaining({ userId: 'u1', listingId: 'l1' })
      );

      await run({ now: t0 + 60 * 1000 });
      expect(ensureCoachListings).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledTimes(1);

      await run({ now: t0 + 11 * 60 * 1000 });
      expect(ensureCoachListings).toHaveBeenCalledTimes(2);
    });
  });
});
