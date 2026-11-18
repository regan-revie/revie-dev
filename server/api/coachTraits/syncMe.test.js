jest.mock('../../api-util/sdk', () => ({
  createCookieTokenStore: jest.fn(),
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));

const sdkUtil = require('../../api-util/sdk');
const syncMe = require('./syncMe');

const response = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('POST /api/coach-traits/sync-me', () => {
  it("copies the logged-in coach's profile onto their own listings only, with their own session", async () => {
    const sdk = {
      currentUser: {
        show: jest.fn().mockResolvedValue({
          data: { data: { attributes: { profile: { publicData: { location: 'uk' } } } } },
        }),
      },
      ownListings: {
        query: jest.fn().mockResolvedValue({
          data: { data: [{ id: { uuid: 'l1' }, attributes: { publicData: {} } }] },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    sdkUtil.getSdk.mockReturnValue(sdk);
    const res = response();
    await syncMe({}, res);

    expect(sdk.currentUser.show).toHaveBeenCalled();
    expect(sdk.ownListings.update).toHaveBeenCalledWith({
      id: { uuid: 'l1' },
      publicData: { coachlocation: 'uk' },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, updated: 1 });
  });

  it('refuses an anonymous caller without touching anything', async () => {
    const sdk = {
      currentUser: {
        show: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { status: 401 })),
      },
      ownListings: { query: jest.fn(), update: jest.fn() },
    };
    sdkUtil.getSdk.mockReturnValue(sdk);
    await syncMe({}, response());
    expect(sdk.ownListings.query).not.toHaveBeenCalled();
    expect(sdkUtil.handleError).toHaveBeenCalled();
  });
});
