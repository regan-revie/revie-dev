jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./db', () => ({
  // No real database: run the function straight away, as when the lock is free.
  withAdvisoryLock: jest.fn(async (key, fn) => ({ locked: true, value: await fn() })),
}));
jest.mock('./integration', () => ({ getIntegrationSdk: jest.fn() }));
jest.mock('../../email/postmark', () => ({
  isConfigured: jest.fn(),
  isSendingEnabled: jest.fn(),
  sendTemplateEmail: jest.fn(),
}));

const log = require('../../log');
const db = require('./db');
const { getIntegrationSdk } = require('./integration');
const postmark = require('../../email/postmark');
const status = require('./grantStatus');
const { makeFakeSdk, coach, sessionListing } = require('./grantStatusTestKit');

const NOW = Date.parse('2026-12-01T12:00:00Z');
const MIN = 60 * 1000;

const world = () =>
  makeFakeSdk({
    users: [coach('u1'), coach('u2')],
    listings: [
      sessionListing('l1', 'u1', true),
      sessionListing('l2', 'u1', false),
      sessionListing('l3', 'u2', true),
    ],
  });

const webhook = (sdk, trigger = 'grant.expired', grantId = 'grant-u1', extra = {}) => {
  getIntegrationSdk.mockReturnValue(sdk);
  return status.handleGrantWebhook({ trigger, grantId, now: NOW, ...extra });
};
const privateOf = (sdk, id) => sdk.store.users[id].privateData;

beforeEach(() => {
  jest.clearAllMocks();
  status.resetEmailBackoff();
  // Mock implementations do not survive between tests in this setup, so every one is set here.
  db.withAdvisoryLock.mockImplementation(async (key, fn) => ({ locked: true, value: await fn() }));
  postmark.isConfigured.mockReturnValue(true);
  postmark.isSendingEnabled.mockReturnValue(true);
  postmark.sendTemplateEmail.mockResolvedValue({ messageId: 'm1' });
  process.env.REACT_APP_MARKETPLACE_ROOT_URL = 'https://revie-dev.onrender.com';
});

describe('a grant.expired notice', () => {
  it('marks the coach whose grant it is as reconnect_needed, with when and why', async () => {
    const sdk = world();
    const result = await webhook(sdk);

    expect(result).toEqual({ handled: true, action: 'reconnect-needed' });
    expect(privateOf(sdk, 'u1')).toMatchObject({
      calendarStatus: 'reconnect_needed',
      calendarBrokenAt: new Date(NOW).toISOString(),
      calendarBrokenReason: 'grant.expired',
    });
    // Another coach is untouched.
    expect(privateOf(sdk, 'u2').calendarStatus).toBeUndefined();
  });

  it("switches off the coach's bookable sessions at once, and only theirs", async () => {
    const sdk = world();
    await webhook(sdk);
    expect(sdk.store.listings.l1.publicData.calendarBookingEnabled).toBe(false);
    expect(sdk.store.listings.l3.publicData.calendarBookingEnabled).toBe(true);
    // The one that was already off is not touched again.
    expect(sdk.listings.update).toHaveBeenCalledTimes(1);
  });

  it('leaves existing bookings alone: it never touches a transaction', async () => {
    const sdk = world();
    sdk.transactions = { transition: jest.fn(), updateMetadata: jest.fn() };
    await webhook(sdk);
    expect(sdk.transactions.transition).not.toHaveBeenCalled();
    expect(sdk.transactions.updateMetadata).not.toHaveBeenCalled();
  });

  it('is reported to Sentry as nylas-grant-expired with the coach id and nothing secret', async () => {
    const sdk = world();
    await webhook(sdk);

    expect(log.error).toHaveBeenCalledTimes(1);
    const [error, code, data] = log.error.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(code).toBe('nylas-grant-expired');
    expect(data).toEqual({ coachId: 'u1', reason: 'grant.expired' });
    // No grant id, token or email anywhere in what is sent.
    const sent = JSON.stringify([error.message, data]);
    expect(sent).not.toMatch(/grant-u1|gmail\.example|token|secret/i);
  });

  it('sends the one email: right template, to the coach, with a button to the Calendar page', async () => {
    const sdk = world();
    await webhook(sdk);

    expect(postmark.sendTemplateEmail).toHaveBeenCalledTimes(1);
    expect(postmark.sendTemplateEmail).toHaveBeenCalledWith({
      to: 'u1@coach.example',
      templateAlias: 'calendar-reconnect-coach',
      model: {
        recipientName: 'Sam',
        reconnectUrl: 'https://revie-dev.onrender.com/account/calendar',
      },
      tag: 'calendar-reconnect',
    });
    expect(privateOf(sdk, 'u1').calendarReconnectEmailedAt).toBe(new Date(NOW).toISOString());
  });

  it('a grant.deleted notice breaks the connection the same way', async () => {
    const sdk = world();
    const result = await webhook(sdk, 'grant.deleted');
    expect(result.action).toBe('reconnect-needed');
    expect(privateOf(sdk, 'u1').calendarBrokenReason).toBe('grant.deleted');
  });
});

describe('one email per break, not daily', () => {
  it('a redelivered webhook changes nothing, reports nothing and sends nothing more', async () => {
    const sdk = world();
    await webhook(sdk);
    log.error.mockClear();
    postmark.sendTemplateEmail.mockClear();
    sdk.users.updateProfile.mockClear();

    const again = await webhook(sdk);
    expect(again).toEqual({ handled: true, action: 'unchanged-already' });
    expect(log.error).not.toHaveBeenCalled();
    expect(postmark.sendTemplateEmail).not.toHaveBeenCalled();
    expect(sdk.users.updateProfile).not.toHaveBeenCalled();
  });

  it('the reconcile loop looking at the broken coach every tick never sends it again', async () => {
    const sdk = world();
    await webhook(sdk);
    postmark.sendTemplateEmail.mockClear();

    for (let tick = 1; tick <= 5; tick += 1) {
      // eslint-disable-next-line no-await-in-loop
      await status.reviewBrokenCoach({
        sdk,
        userId: 'u1',
        privateData: privateOf(sdk, 'u1'),
        now: NOW + tick * 24 * 60 * MIN,
        request: async () => ({ grant_status: 'invalid' }),
      });
    }
    expect(postmark.sendTemplateEmail).not.toHaveBeenCalled();
  });

  it('a send that failed is tried again later (not stamped), then goes out once', async () => {
    const sdk = world();
    postmark.sendTemplateEmail.mockRejectedValueOnce(new Error('Postmark down'));
    await webhook(sdk);

    expect(privateOf(sdk, 'u1').calendarReconnectEmailedAt).toBeFalsy();
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-reconnect-email-failed', {
      coachId: 'u1',
    });

    // The loop's next look, after the retry pause.
    await status.reviewBrokenCoach({
      sdk,
      userId: 'u1',
      privateData: privateOf(sdk, 'u1'),
      now: NOW + 11 * MIN,
      request: async () => ({ grant_status: 'invalid' }),
    });
    expect(postmark.sendTemplateEmail).toHaveBeenCalledTimes(2);
    expect(privateOf(sdk, 'u1').calendarReconnectEmailedAt).toBeTruthy();

    // And not again.
    await status.reviewBrokenCoach({
      sdk,
      userId: 'u1',
      privateData: privateOf(sdk, 'u1'),
      now: NOW + 30 * MIN,
      request: async () => ({ grant_status: 'invalid' }),
    });
    expect(postmark.sendTemplateEmail).toHaveBeenCalledTimes(2);
  });

  it('does not hammer Postmark every minute while it keeps failing', async () => {
    const sdk = world();
    postmark.sendTemplateEmail.mockRejectedValue(new Error('Postmark down'));
    await webhook(sdk);
    for (let i = 1; i <= 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await status.reviewBrokenCoach({
        sdk,
        userId: 'u1',
        privateData: privateOf(sdk, 'u1'),
        now: NOW + i * MIN,
        request: async () => ({ grant_status: 'invalid' }),
      });
    }
    expect(postmark.sendTemplateEmail).toHaveBeenCalledTimes(1);
  });

  it('while sending is switched off nothing is sent or stamped, and it goes out once sending is on', async () => {
    const sdk = world();
    postmark.isSendingEnabled.mockReturnValue(false);
    await webhook(sdk);
    expect(postmark.sendTemplateEmail).not.toHaveBeenCalled();
    expect(privateOf(sdk, 'u1').calendarReconnectEmailedAt).toBeFalsy();

    postmark.isSendingEnabled.mockReturnValue(true);
    await status.reviewBrokenCoach({
      sdk,
      userId: 'u1',
      privateData: privateOf(sdk, 'u1'),
      now: NOW + MIN,
      request: async () => ({ grant_status: 'invalid' }),
    });
    expect(postmark.sendTemplateEmail).toHaveBeenCalledTimes(1);
  });

  it('a second break, after reconnecting, is a new break and gets its own one email', async () => {
    const sdk = world();
    await webhook(sdk);
    // The coach reconnects.
    await status.clearReconnectNeeded({ sdk, userId: 'u1' });
    expect(privateOf(sdk, 'u1')).toMatchObject({
      calendarStatus: 'connected',
      calendarBrokenAt: null,
      calendarReconnectEmailedAt: null,
    });
    // It breaks again weeks later.
    await webhook(sdk, 'grant.expired', 'grant-u1', { now: NOW + 30 * 24 * 60 * MIN });
    expect(postmark.sendTemplateEmail).toHaveBeenCalledTimes(2);
  });
});

describe("notices that are not about a coach's current grant", () => {
  it('ignores a grant nobody holds', async () => {
    const sdk = world();
    const result = await webhook(sdk, 'grant.expired', 'grant-nobody');
    expect(result).toEqual({ handled: false, reason: 'grant-not-held' });
    expect(sdk.users.updateProfile).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('ignores a notice with no grant id', async () => {
    const sdk = world();
    expect(await webhook(sdk, 'grant.expired', null)).toEqual({
      handled: false,
      reason: 'no-grant-id',
    });
  });

  it('ignores the old grant of a coach who has since connected a different account', async () => {
    const sdk = world();
    getIntegrationSdk.mockReturnValue(sdk);
    // The scan finds the coach by the grant id in the notice; here the stored grant has changed
    // between the scan and the lock, which is what the check under the lock is for.
    const result = await status.handleGrantWebhook({
      trigger: 'grant.expired',
      grantId: 'grant-u1',
      now: NOW,
      finder: async () => {
        sdk.store.users.u1.privateData.nylasGrantId = 'grant-new-account';
        return { id: { uuid: 'u1' } };
      },
    });
    expect(result).toEqual({ handled: true, action: 'unchanged-grant-replaced' });
    expect(privateOf(sdk, 'u1').calendarStatus).toBeUndefined();
    expect(postmark.sendTemplateEmail).not.toHaveBeenCalled();
  });

  it('fails (so Nylas redelivers) when the Integration API is not configured', async () => {
    getIntegrationSdk.mockReturnValue(null);
    await expect(
      status.handleGrantWebhook({ trigger: 'grant.expired', grantId: 'grant-u1' })
    ).rejects.toThrow(/not configured/);
  });
});

describe('a coach reconnecting (or the grant working again)', () => {
  it('the loop clears the mark within a tick when Nylas says the grant is valid again, with no email', async () => {
    const sdk = world();
    await webhook(sdk);
    postmark.sendTemplateEmail.mockClear();

    const { cleared } = await status.reviewBrokenCoach({
      sdk,
      userId: 'u1',
      privateData: privateOf(sdk, 'u1'),
      now: NOW + MIN,
      request: async () => ({ grant_status: 'valid' }),
    });
    expect(cleared).toBe(true);
    expect(privateOf(sdk, 'u1').calendarStatus).toBe('connected');
    expect(postmark.sendTemplateEmail).not.toHaveBeenCalled();
  });

  it('a coach still broken is not cleared', async () => {
    const sdk = world();
    await webhook(sdk);
    const { cleared } = await status.reviewBrokenCoach({
      sdk,
      userId: 'u1',
      privateData: privateOf(sdk, 'u1'),
      now: NOW + MIN,
      request: async () => ({ grant_status: 'invalid' }),
    });
    expect(cleared).toBe(false);
    expect(privateOf(sdk, 'u1').calendarStatus).toBe('reconnect_needed');
  });

  it('a Nylas outage while looking is not treated as the grant being fine, or as broken', async () => {
    const sdk = world();
    await webhook(sdk);
    const { cleared } = await status.reviewBrokenCoach({
      sdk,
      userId: 'u1',
      privateData: privateOf(sdk, 'u1'),
      now: NOW + MIN,
      request: async () => {
        throw Object.assign(new Error('Nylas down'), { status: 503 });
      },
    });
    expect(cleared).toBe(false);
    expect(privateOf(sdk, 'u1').calendarStatus).toBe('reconnect_needed');
  });
});

describe('asking Nylas whether a grant works', () => {
  const health = request => status.fetchGrantHealth('g', { request });
  const failing = statusCode => async () => {
    throw Object.assign(new Error('x'), { status: statusCode });
  };

  it('valid grant: valid', async () => {
    expect(await health(async () => ({ grant_status: 'valid' }))).toEqual({ state: 'valid' });
  });

  it('an invalid grant, or one that no longer exists: broken', async () => {
    expect((await health(async () => ({ grant_status: 'invalid' }))).state).toBe('broken');
    expect((await health(failing(404))).state).toBe('broken');
  });

  it.each([401, 403, 429, 500, 503, undefined])(
    'anything else (%s) is "unknown": a bad key or an outage must not lock coaches out',
    async code => {
      expect((await health(failing(code))).state).toBe('unknown');
    }
  );
});

describe('statusOf', () => {
  it('is connected unless the coach is marked reconnect_needed', () => {
    expect(status.statusOf(undefined)).toBe('connected');
    expect(status.statusOf({})).toBe('connected');
    expect(status.statusOf({ calendarStatus: 'connected' })).toBe('connected');
    expect(status.statusOf({ calendarStatus: 'reconnect_needed' })).toBe('reconnect_needed');
  });
});
