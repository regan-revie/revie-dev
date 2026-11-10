jest.mock('../../api-util/sdk', () => ({
  createCookieTokenStore: jest.fn(() => ({})),
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));
jest.mock('./config', () => ({ isConfigured: jest.fn() }));
jest.mock('./ensureCoach', () => ({ ensureOwnListings: jest.fn() }));

const { getSdk, handleError } = require('../../api-util/sdk');
const { isConfigured } = require('./config');
const { ensureOwnListings } = require('./ensureCoach');
const handler = require('./syncMe');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const sdkFor = show => ({ currentUser: { show } });
const user = {
  data: {
    data: {
      id: { uuid: 'coach-1' },
      attributes: { profile: { displayName: 'Coach', privateData: { nylasGrantId: 'g' } } },
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  isConfigured.mockReturnValue(true);
  ensureOwnListings.mockResolvedValue({
    locked: true,
    results: [{ listingId: 'a', status: 'synced' }, { listingId: 'b', status: 'unchanged' }],
  });
});

describe('POST /api/nylas/sync-me', () => {
  it("syncs the logged-in coach's own listings and reports counts, not ids", async () => {
    getSdk.mockReturnValue(sdkFor(jest.fn(async () => user)));
    const res = makeRes();
    await handler({ body: {} }, res);

    expect(ensureOwnListings).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'coach-1', profile: user.data.data.attributes.profile })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      locked: true,
      statuses: { synced: 1, unchanged: 1 },
    });
  });

  it('takes no input: a body naming someone else changes nothing about whose listings are synced', async () => {
    getSdk.mockReturnValue(sdkFor(jest.fn(async () => user)));
    await handler({ body: { userId: 'someone-else', listingId: 'theirs' } }, makeRes());
    expect(ensureOwnListings.mock.calls[0][0].userId).toBe('coach-1');
  });

  it('is refused for a caller who is not logged in, and syncs nothing', async () => {
    const error = Object.assign(new Error('unauthorized'), { status: 401 });
    getSdk.mockReturnValue(sdkFor(jest.fn(async () => Promise.reject(error))));
    await handler({ body: {} }, makeRes());
    expect(handleError).toHaveBeenCalled();
    expect(ensureOwnListings).not.toHaveBeenCalled();
  });

  it('answers ok: false, not an error page, when a listing failed to sync', async () => {
    ensureOwnListings.mockResolvedValue({
      locked: true,
      results: [{ listingId: 'a', status: 'error', error: new Error('nylas down') }],
    });
    getSdk.mockReturnValue(sdkFor(jest.fn(async () => user)));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await handler({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ ok: false });
    spy.mockRestore();
  });

  it('is unavailable when calendar integration is not configured', async () => {
    isConfigured.mockReturnValue(false);
    const res = makeRes();
    await handler({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
