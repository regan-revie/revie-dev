const { runBackfill } = require('./backfill');

const userRes = (id, publicData) => ({
  id: { uuid: id },
  type: 'user',
  attributes: { profile: { publicData } },
});
const listingRes = (id, authorId, publicData) => ({
  id: { uuid: id },
  attributes: { publicData },
  relationships: { author: { data: { id: { uuid: authorId } } } },
});

const fakeSdk = ({ listings, users }) => ({
  listings: {
    query: jest.fn().mockResolvedValue({
      data: { data: listings, included: users, meta: { totalPages: 1 } },
    }),
    update: jest.fn().mockResolvedValue({}),
  },
  users: { updateProfile: jest.fn().mockResolvedValue({}) },
});

describe('runBackfill', () => {
  it('forward dry run: reports the diff per coach and writes nothing', async () => {
    const sdk = fakeSdk({
      users: [userRes('u1', { languages: ['english'] })],
      listings: [listingRes('l1', 'u1', {}), listingRes('l2', 'u1', { language: ['english'] })],
    });
    const { rows, totals } = await runBackfill({ sdk, direction: 'forward', dryRun: true });
    expect(sdk.listings.update).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual([{ listingId: 'l1', changes: { language: ['english'] } }]);
    expect(totals).toMatchObject({ coaches: 1, coachesChanged: 1, listingsChanged: 1, errors: 0 });
  });

  it('forward apply: writes, then a second run has nothing left to do', async () => {
    const sdk = fakeSdk({
      users: [userRes('u1', { location: 'uk' })],
      listings: [listingRes('l1', 'u1', {})],
    });
    await runBackfill({ sdk, direction: 'forward', dryRun: false });
    expect(sdk.listings.update).toHaveBeenCalledWith({
      id: { uuid: 'l1' },
      publicData: { coachlocation: 'uk' },
    });

    const synced = fakeSdk({
      users: [userRes('u1', { location: 'uk' })],
      listings: [listingRes('l1', 'u1', { coachlocation: 'uk' })],
    });
    const { rows } = await runBackfill({ sdk: synced, direction: 'forward', dryRun: false });
    expect(rows).toEqual([]);
    expect(synced.listings.update).not.toHaveBeenCalled();
  });

  it('forward leaves coaches with an empty profile completely alone', async () => {
    const sdk = fakeSdk({
      users: [userRes('u1', {})],
      listings: [listingRes('l1', 'u1', { language: ['english'], coachlocation: 'uk' })],
    });
    const { rows } = await runBackfill({ sdk, direction: 'forward', dryRun: false });
    expect(rows).toEqual([]);
    expect(sdk.listings.update).not.toHaveBeenCalled();
  });

  it('reverse: fills only empty profile traits from listings, dry run first', async () => {
    const users = [userRes('u1', { languages: ['english'] })];
    const listings = [listingRes('l1', 'u1', { language: ['french'], coachlocation: 'latam' })];

    const dry = fakeSdk({ users, listings });
    const { rows } = await runBackfill({ sdk: dry, direction: 'reverse', dryRun: true });
    expect(dry.users.updateProfile).not.toHaveBeenCalled();
    expect(rows[0].fills).toEqual({ location: 'latin-america' });

    const applied = fakeSdk({ users, listings });
    await runBackfill({ sdk: applied, direction: 'reverse', dryRun: false });
    expect(applied.users.updateProfile).toHaveBeenCalledWith({
      id: 'u1',
      publicData: { location: 'latin-america' },
    });
  });
});
