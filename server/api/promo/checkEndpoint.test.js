const load = ({ resolveResult, resolveThrows, userThrows } = {}) => {
  jest.resetModules();
  const resolvePromo = jest.fn(async () => {
    if (resolveThrows) throw resolveThrows;
    return resolveResult;
  });
  jest.doMock('../../api-util/sdk', () => ({
    createCookieTokenStore: jest.fn(),
    getSdk: () => ({
      currentUser: {
        show: async () => {
          if (userThrows) throw userThrows;
          return { data: { data: { id: { uuid: 'customer-1' } } } };
        },
      },
    }),
    fetchCommission: async () => ({
      data: {
        data: [
          { type: 'jsonAsset', attributes: { data: { providerCommission: { percentage: 20 } } } },
        ],
      },
    }),
  }));
  jest.doMock('./resolve', () => ({ resolvePromo }));
  return { handler: require('./checkEndpoint'), resolvePromo };
};

const call = async (handler, body = { code: 'NEWYEAR15' }) => {
  const res = {
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  await handler({ body }, res);
  return res;
};

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('POST /api/promo/check', () => {
  it('answers ok with the percentage, identifying the caller from their own session', async () => {
    const { handler, resolvePromo } = load({
      resolveResult: { code: 'NEWYEAR15', percentOff: 15 },
    });
    const res = await call(handler);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ ok: true, code: 'NEWYEAR15', percentOff: 15 });
    expect(resolvePromo).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'customer-1', reserve: false, commissionPercent: 20 })
    );
  });

  it('answers a refusal as ok:false with the reason, so the page can say it kindly', async () => {
    const { promoError } = require('./rules');
    const { handler } = load({ resolveThrows: promoError('first-session-only') });
    const res = await call(handler);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: 'first-session-only' });
  });

  it('treats an empty code as invalid', async () => {
    const { handler } = load({ resolveResult: null });
    expect((await call(handler, {})).body).toEqual({ ok: false, reason: 'invalid' });
  });

  it('is a 401 for someone who is not logged in, and never reserves anything', async () => {
    const { handler, resolvePromo } = load({
      userThrows: Object.assign(new Error('x'), { status: 401 }),
    });
    const res = await call(handler);
    expect(res.code).toBe(401);
    expect(resolvePromo).not.toHaveBeenCalled();
  });
});
