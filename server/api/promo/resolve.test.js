const load = ({
  dbAvailable = true,
  promo = { code: 'NEWYEAR15', first_session_only: false },
  verdict = { ok: true, percentOff: 15, redemptionId: '7' },
  earlier = false,
  storeThrows = false,
} = {}) => {
  jest.resetModules();
  const store = {
    findCode: jest.fn(async () => {
      if (storeThrows) throw new Error('db down');
      return promo;
    }),
    check: jest.fn(async () => verdict),
    reserve: jest.fn(async () => verdict),
  };
  const hasEarlierPaidBooking = jest.fn(async () => earlier);
  jest.doMock('../nylas/db', () => ({ isAvailable: () => dbAvailable }));
  jest.doMock('./store', () => store);
  jest.doMock('./eligibility', () => ({ hasEarlierPaidBooking }));
  const { resolvePromo } = require('./resolve');
  const attempts = require('./attemptLimit');
  attempts.reset();
  return { resolvePromo, store, hasEarlierPaidBooking, attempts };
};

const base = { sdk: {}, customerId: 'u1', commissionPercent: 20, reserve: false, now: 1000 };
const refusal = async promise => {
  try {
    await promise;
  } catch (e) {
    return e.statusText;
  }
  return null;
};

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('resolving a typed code', () => {
  it('returns null when no code was given, touching nothing', async () => {
    const { resolvePromo, store } = load();
    expect(await resolvePromo({ ...base, rawCode: undefined })).toBeNull();
    expect(await resolvePromo({ ...base, rawCode: '' })).toBeNull();
    expect(await resolvePromo({ ...base, rawCode: '   ' })).toBeNull();
    expect(store.findCode).not.toHaveBeenCalled();
  });

  it('accepts a good code case-insensitively and returns the percentage from the database', async () => {
    const { resolvePromo, store } = load();
    const promo = await resolvePromo({ ...base, rawCode: ' newyear15 ' });
    expect(promo).toEqual({ code: 'NEWYEAR15', percentOff: 15, redemptionId: '7' });
    expect(store.check).toHaveBeenCalledWith(expect.objectContaining({ code: 'NEWYEAR15' }));
  });

  it('only a real booking reserves a use; a price preview does not', async () => {
    const preview = load();
    await preview.resolvePromo({ ...base, rawCode: 'NEWYEAR15', reserve: false });
    expect(preview.store.reserve).not.toHaveBeenCalled();

    const real = load();
    await real.resolvePromo({ ...base, rawCode: 'NEWYEAR15', reserve: true });
    expect(real.store.reserve).toHaveBeenCalledTimes(1);
    expect(real.store.check).not.toHaveBeenCalled();
  });

  it('one code per booking: anything but a single piece of text is refused', async () => {
    const { resolvePromo, store } = load();
    expect(await refusal(resolvePromo({ ...base, rawCode: ['A1B', 'C2D'] }))).toBe('promo-invalid');
    expect(await refusal(resolvePromo({ ...base, rawCode: { code: 'A1B' } }))).toBe(
      'promo-invalid'
    );
    expect(store.findCode).not.toHaveBeenCalled();
  });

  it('says "invalid" for an unknown code, with no hint of why', async () => {
    const { resolvePromo } = load({ promo: null });
    expect(await refusal(resolvePromo({ ...base, rawCode: 'NOSUCHCODE' }))).toBe('promo-invalid');
  });

  it('passes the specific reason of a refusal on, and does not count it as a guess', async () => {
    const { resolvePromo, attempts } = load({ verdict: { ok: false, reason: 'expired' } });
    expect(await refusal(resolvePromo({ ...base, rawCode: 'NEWYEAR15' }))).toBe('promo-expired');
    expect(attempts.isLimited('u1', 1000)).toBe(false);
  });

  it("only looks through the client's orders for a first-session-only code", async () => {
    const plain = load();
    await plain.resolvePromo({ ...base, rawCode: 'NEWYEAR15' });
    expect(plain.hasEarlierPaidBooking).not.toHaveBeenCalled();

    const first = load({ promo: { code: 'WELCOME10', first_session_only: true }, earlier: true });
    await first.resolvePromo({ ...base, rawCode: 'WELCOME10' });
    expect(first.hasEarlierPaidBooking).toHaveBeenCalledTimes(1);
    expect(first.store.check).toHaveBeenCalledWith(
      expect.objectContaining({ hasEarlierPaidBooking: true })
    );
  });

  it('treats a failed look-through as "has booked before", never as "first session"', async () => {
    const ctx = load({ promo: { code: 'WELCOME10', first_session_only: true } });
    ctx.hasEarlierPaidBooking.mockRejectedValue(new Error('sharetribe down'));
    await ctx.resolvePromo({ ...base, rawCode: 'WELCOME10' });
    expect(ctx.store.check).toHaveBeenCalledWith(
      expect.objectContaining({ hasEarlierPaidBooking: true })
    );
  });
});

describe('guessing codes', () => {
  it('limits a user after 8 unknown codes, then refuses even a good one until the window passes', async () => {
    const { resolvePromo, store } = load({ promo: null });
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect(await refusal(resolvePromo({ ...base, rawCode: `GUESS${i}` }))).toBe('promo-invalid');
    }
    store.findCode.mockClear();
    expect(await refusal(resolvePromo({ ...base, rawCode: 'GUESS9' }))).toBe(
      'promo-too-many-attempts'
    );
    expect(store.findCode).not.toHaveBeenCalled();
  });

  it('counts badly formed codes as guesses too, without asking the database', async () => {
    const { resolvePromo, store, attempts } = load();
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await refusal(resolvePromo({ ...base, rawCode: 'x y!' }));
    }
    expect(attempts.isLimited('u1', 1000)).toBe(true);
    expect(store.findCode).not.toHaveBeenCalled();
  });
});

describe('when the database is not there', () => {
  it('answers "unavailable" (503) rather than letting the code through', async () => {
    const { resolvePromo } = load({ dbAvailable: false });
    expect(await refusal(resolvePromo({ ...base, rawCode: 'NEWYEAR15' }))).toBe(
      'promo-unavailable'
    );
  });

  it('does the same when the database errors mid-way', async () => {
    const { resolvePromo } = load({ storeThrows: true });
    expect(await refusal(resolvePromo({ ...base, rawCode: 'NEWYEAR15' }))).toBe(
      'promo-unavailable'
    );
  });
});
