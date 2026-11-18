jest.mock('../nylas/integration', () => ({ getIntegrationSdk: jest.fn() }));
jest.mock('../../log', () => ({ error: jest.fn() }));

const integration = require('../nylas/integration');
const log = require('../../log');
const { runTraitSync } = require('./reconcileTraits');

const page = (listings, users) => ({
  data: { data: listings, included: users, meta: { totalPages: 1 } },
});
const user = (id, publicData) => ({
  id: { uuid: id },
  type: 'user',
  attributes: { profile: { publicData } },
});
const listing = (id, authorId, publicData) => ({
  id: { uuid: id },
  attributes: { publicData },
  relationships: { author: { data: { id: { uuid: authorId } } } },
});

describe('runTraitSync', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing without Integration API credentials', async () => {
    integration.getIntegrationSdk.mockReturnValue(null);
    expect(await runTraitSync()).toEqual({ skipped: true });
  });

  it("copies a coach's profile onto a newly published listing, calendar or not", async () => {
    const sdk = {
      listings: {
        query: jest
          .fn()
          .mockResolvedValue(
            page(
              [listing('l1', 'u1', {})],
              [user('u1', { languages: ['english'], location: 'uk' })]
            )
          ),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    integration.getIntegrationSdk.mockReturnValue(sdk);

    const result = await runTraitSync();
    expect(sdk.listings.update).toHaveBeenCalledWith({
      id: { uuid: 'l1' },
      publicData: { language: ['english'], coachlocation: 'uk' },
    });
    expect(result).toMatchObject({ coaches: 1, listingsUpdated: 1, failed: 0 });
  });

  it('writes nothing for a listing already in step', async () => {
    const sdk = {
      listings: {
        query: jest
          .fn()
          .mockResolvedValue(
            page([listing('l1', 'u1', { coachlocation: 'uk' })], [user('u1', { location: 'uk' })])
          ),
        update: jest.fn(),
      },
    };
    integration.getIntegrationSdk.mockReturnValue(sdk);
    const result = await runTraitSync();
    expect(sdk.listings.update).not.toHaveBeenCalled();
    expect(result.listingsUpdated).toBe(0);
  });

  it('reports a failed listing once, then leaves it alone for ten minutes', async () => {
    const sdk = {
      listings: {
        query: jest
          .fn()
          .mockResolvedValue(page([listing('l9', 'u1', {})], [user('u1', { location: 'uk' })])),
        update: jest.fn().mockRejectedValue(new Error('nope')),
      },
    };
    integration.getIntegrationSdk.mockReturnValue(sdk);

    const t0 = 1_000_000;
    await runTraitSync({ now: t0 });
    await runTraitSync({ now: t0 + 60_000 });
    expect(sdk.listings.update).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][1]).toBe('coach-traits-sync-failed');

    await runTraitSync({ now: t0 + 11 * 60_000 });
    expect(sdk.listings.update).toHaveBeenCalledTimes(2);
  });
});
