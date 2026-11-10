jest.mock('../../api-util/sdk', () => ({
  getSdk: jest.fn(),
  getTrustedSdk: jest.fn(),
  createCookieTokenStore: jest.fn(() => ({})),
}));
jest.mock('./client', () => ({ exchangeCodeForGrant: jest.fn() }));
jest.mock('./ensureCoach', () => ({ ensureOwnListings: jest.fn(async () => ({})) }));
jest.mock('./grantChange', () => ({ handleGrantChange: jest.fn(async () => ({})) }));
jest.mock('./connect', () => ({
  STATE_COOKIE: 'nylas-connect-state',
  RETURN_PATH_COOKIE: 'nylas-connect-return-path',
  callbackUri: () => 'https://revie-dev.onrender.com/api/nylas/callback',
}));

const { getSdk, getTrustedSdk } = require('../../api-util/sdk');
const { exchangeCodeForGrant } = require('./client');
const { handleGrantChange } = require('./grantChange');
const { ensureOwnListings } = require('./ensureCoach');
const callback = require('./callback');

const makeRes = () => ({
  redirect: jest.fn(),
  clearCookie: jest.fn(),
  status: jest.fn(),
  type: jest.fn(),
  send: jest.fn(),
});
const makeReq = () => ({
  query: { code: 'code-1', state: 'state-1' },
  cookies: { 'nylas-connect-state': 'state-1' },
});

const setup = ({ storedGrantId, newGrantId }) => {
  getSdk.mockReturnValue({
    currentUser: {
      show: jest.fn(async () => ({
        data: {
          data: {
            id: { uuid: 'coach-1' },
            attributes: {
              profile: {
                displayName: 'Coach',
                privateData: storedGrantId ? { nylasGrantId: storedGrantId } : {},
              },
            },
          },
        },
      })),
    },
  });
  getTrustedSdk.mockResolvedValue({ currentUser: { updateProfile: jest.fn(async () => ({})) } });
  exchangeCodeForGrant.mockResolvedValue({
    grantId: newGrantId,
    provider: 'google',
    email: 'coach@example.com',
  });
};

const run = async () => {
  const res = makeRes();
  callback(makeReq(), res);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  handleGrantChange.mockResolvedValue({});
  ensureOwnListings.mockResolvedValue({});
});

describe('Nylas callback and a changed grant', () => {
  it('hands over to the grant-change handling when the new grant id differs from the stored one', async () => {
    setup({ storedGrantId: 'grant-old', newGrantId: 'grant-new' });
    const res = await run();

    expect(handleGrantChange).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'coach-1',
        previousGrantId: 'grant-old',
        newGrantId: 'grant-new',
        newGrantEmail: 'coach@example.com',
        coachName: 'Coach',
      })
    );
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('calendarConnect=connected'));
  });

  it('does nothing extra when the same account reconnects and the grant id is unchanged', async () => {
    setup({ storedGrantId: 'grant-same', newGrantId: 'grant-same' });
    const res = await run();

    expect(handleGrantChange).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('calendarConnect=connected'));
  });

  it("does nothing extra on a coach's first connection", async () => {
    setup({ storedGrantId: null, newGrantId: 'grant-new' });
    await run();
    expect(handleGrantChange).not.toHaveBeenCalled();
  });

  it('still sends the coach back as connected if the grant-change handling fails', async () => {
    setup({ storedGrantId: 'grant-old', newGrantId: 'grant-new' });
    handleGrantChange.mockRejectedValue(new Error('boom'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await run();

    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('calendarConnect=connected'));
    spy.mockRestore();
  });

  it('defaults to returning to the Calendar page', async () => {
    setup({ storedGrantId: null, newGrantId: 'grant-new' });
    const res = await run();
    expect(res.redirect.mock.calls[0][0]).toContain('/account/calendar');
  });

  describe('setting up listings after the connect', () => {
    it('runs for the coach with the grant just stored, not the one read before', async () => {
      setup({ storedGrantId: null, newGrantId: 'grant-new' });
      await run();

      expect(ensureOwnListings).toHaveBeenCalledTimes(1);
      const call = ensureOwnListings.mock.calls[0][0];
      expect(call.userId).toBe('coach-1');
      expect(call.profile.privateData).toMatchObject({
        nylasGrantId: 'grant-new',
        nylasGrantEmail: 'coach@example.com',
      });
    });

    it('runs after a changed grant has been handled, and also when the same account reconnects', async () => {
      setup({ storedGrantId: 'grant-old', newGrantId: 'grant-new' });
      await run();
      expect(handleGrantChange).toHaveBeenCalled();
      expect(ensureOwnListings).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      setup({ storedGrantId: 'grant-same', newGrantId: 'grant-same' });
      await run();
      expect(ensureOwnListings).toHaveBeenCalledTimes(1);
    });

    it('never fails the connect: a problem setting up listings still sends the coach back as connected', async () => {
      setup({ storedGrantId: null, newGrantId: 'grant-new' });
      ensureOwnListings.mockRejectedValue(new Error('nylas down'));
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = await run();
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('calendarConnect=connected')
      );
      spy.mockRestore();
    });
  });
});
