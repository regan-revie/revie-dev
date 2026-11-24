jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./db', () => ({
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
const { runGrantHealthCheck } = require('./grantHealth');
const { makeFakeSdk, coach, sessionListing } = require('./grantStatusTestKit');

const NOW = Date.parse('2026-12-01T12:00:00Z');

// Nylas's answer for each grant, by grant id.
const nylas = answers => async path => {
  const id = path.split('/').pop();
  const answer = answers[id];
  if (answer instanceof Error) throw answer;
  return answer;
};
const failing = code => Object.assign(new Error('x'), { status: code });
const valid = { grant_status: 'valid' };
const invalid = { grant_status: 'invalid' };

const check = (sdk, answers) => {
  getIntegrationSdk.mockReturnValue(sdk);
  return runGrantHealthCheck({ now: NOW, request: nylas(answers) });
};

beforeEach(() => {
  jest.clearAllMocks();
  status.resetEmailBackoff();
  db.withAdvisoryLock.mockImplementation(async (key, fn) => ({ locked: true, value: await fn() }));
  postmark.isConfigured.mockReturnValue(true);
  postmark.isSendingEnabled.mockReturnValue(true);
  postmark.sendTemplateEmail.mockResolvedValue({ messageId: 'm1' });
});

describe("the daily check of every coach's grant", () => {
  it('catches a break whose webhook was missed: marks the coach, stops bookings, emails once', async () => {
    const sdk = makeFakeSdk({
      users: [coach('u1'), coach('u2'), coach('u3')],
      listings: [sessionListing('l1', 'u1', true)],
    });
    const summary = await check(sdk, {
      'grant-u1': invalid,
      'grant-u2': valid,
      'grant-u3': valid,
    });

    expect(summary).toMatchObject({ checked: 3, valid: 2, broken: 1, marked: 1 });
    expect(sdk.store.users.u1.privateData).toMatchObject({
      calendarStatus: 'reconnect_needed',
      calendarBrokenReason: 'daily-check-invalid',
    });
    expect(sdk.store.listings.l1.publicData.calendarBookingEnabled).toBe(false);
    expect(postmark.sendTemplateEmail).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-grant-expired', {
      coachId: 'u1',
      reason: 'daily-check-invalid',
    });
    // The others are untouched.
    expect(sdk.store.users.u2.privateData.calendarStatus).toBeUndefined();
  });

  it('treats a grant Nylas no longer has (404) as broken', async () => {
    const sdk = makeFakeSdk({ users: [coach('u1'), coach('u2'), coach('u3')] });
    await check(sdk, { 'grant-u1': failing(404), 'grant-u2': valid, 'grant-u3': valid });
    expect(sdk.store.users.u1.privateData.calendarStatus).toBe('reconnect_needed');
  });

  it('running it every day does not email again for a break it already knows about', async () => {
    const sdk = makeFakeSdk({ users: [coach('u1'), coach('u2'), coach('u3')] });
    const answers = { 'grant-u1': invalid, 'grant-u2': valid, 'grant-u3': valid };
    await check(sdk, answers);
    await check(sdk, answers);
    await check(sdk, answers);
    expect(postmark.sendTemplateEmail).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls.filter(c => c[1] === 'nylas-grant-expired')).toHaveLength(1);
  });

  it('does not mark anyone for a Nylas outage, a rate limit or a rejected key', async () => {
    const sdk = makeFakeSdk({ users: [coach('u1'), coach('u2'), coach('u3'), coach('u4')] });
    const summary = await check(sdk, {
      'grant-u1': failing(503),
      'grant-u2': failing(429),
      'grant-u3': failing(401),
      'grant-u4': new Error('network'),
    });
    expect(summary).toMatchObject({ checked: 4, unknown: 4, marked: 0 });
    expect(Object.values(sdk.store.users).every(u => !u.privateData.calendarStatus)).toBe(true);
    expect(postmark.sendTemplateEmail).not.toHaveBeenCalled();
  });

  it('flags nobody, and says so, when EVERY grant looks broken (a wrong region or key, not coaches)', async () => {
    const sdk = makeFakeSdk({ users: [coach('u1'), coach('u2'), coach('u3')] });
    const summary = await check(sdk, {
      'grant-u1': failing(404),
      'grant-u2': failing(404),
      'grant-u3': failing(404),
    });
    expect(summary).toMatchObject({ suspicious: true });
    expect(Object.values(sdk.store.users).every(u => !u.privateData.calendarStatus)).toBe(true);
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-grant-check-suspicious', {
      checked: 3,
    });
    expect(postmark.sendTemplateEmail).not.toHaveBeenCalled();
  });

  it('one broken grant out of one or two coaches is still marked (too few to call it suspicious)', async () => {
    const sdk = makeFakeSdk({ users: [coach('u1')] });
    await check(sdk, { 'grant-u1': invalid });
    expect(sdk.store.users.u1.privateData.calendarStatus).toBe('reconnect_needed');
  });

  it('clears a mark whose grant is valid again', async () => {
    const sdk = makeFakeSdk({
      users: [
        coach('u1', { calendarStatus: 'reconnect_needed', calendarReconnectEmailedAt: 'x' }),
        coach('u2'),
        coach('u3'),
      ],
    });
    const summary = await check(sdk, {
      'grant-u1': valid,
      'grant-u2': valid,
      'grant-u3': valid,
    });
    expect(summary.cleared).toBe(1);
    expect(sdk.store.users.u1.privateData.calendarStatus).toBe('connected');
  });

  it('ignores users with no calendar', async () => {
    const sdk = makeFakeSdk({
      users: [coach('u1'), { id: 'client1', email: 'c@x', privateData: {} }],
    });
    const summary = await check(sdk, { 'grant-u1': valid });
    expect(summary.checked).toBe(1);
  });

  it('does nothing without Integration credentials', async () => {
    getIntegrationSdk.mockReturnValue(null);
    expect(await runGrantHealthCheck({ now: NOW })).toEqual({ skipped: true });
  });

  it('pages through every user, not just the first hundred', async () => {
    const users = Array.from({ length: 230 }, (_, i) => coach(`u${i}`));
    const sdk = makeFakeSdk({ users });
    const answers = Object.fromEntries(users.map(u => [u.privateData.nylasGrantId, valid]));
    const summary = await check(sdk, answers);
    expect(summary.checked).toBe(230);
  });
});
