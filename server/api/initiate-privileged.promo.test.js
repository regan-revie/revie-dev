const { promoError } = require('./promo/rules');

// Built inside load(), after the module registry is reset, so its Money is the same class the code
// under test checks for.
let listing;
const makeListing = () => {
  const { types } = require('sharetribe-flex-sdk'); // eslint-disable-line global-require
  const { Money, UUID } = types;
  return {
    id: new UUID('listing-1'),
    attributes: {
      price: new Money(10000, 'GBP'),
      publicData: { unitType: 'fixed', priceVariationsEnabled: false },
    },
  };
};

const load = ({ resolveResult, resolveThrows, initiateThrows } = {}) => {
  jest.resetModules();
  listing = makeListing();
  const { UUID } = require('sharetribe-flex-sdk').types;
  const initiate = jest.fn(async () => {
    if (initiateThrows) throw initiateThrows;
    return { status: 200, statusText: 'OK', data: { data: { id: new UUID('tx-new') } } };
  });
  const initiateSpeculative = jest.fn(async () => ({
    status: 200,
    statusText: 'OK',
    data: { data: {} },
  }));
  const handleError = jest.fn((res, e) =>
    res.status(e.status || 500).json({ statusText: e.statusText, data: e.data })
  );
  const store = { attachTransaction: jest.fn(async () => {}), release: jest.fn(async () => true) };
  const resolvePromo = jest.fn(async () => {
    if (resolveThrows) throw resolveThrows;
    return resolveResult;
  });

  jest.doMock('../api-util/sdk', () => ({
    createCookieTokenStore: jest.fn(),
    getSdk: () => ({
      listings: { show: async () => ({ data: { data: listing } }) },
      currentUser: { show: async () => ({ data: { data: { id: new UUID('customer-1') } } }) },
    }),
    getTrustedSdk: async () => ({ transactions: { initiate, initiateSpeculative } }),
    fetchCommission: async () => ({
      data: {
        data: [
          { type: 'jsonAsset', attributes: { data: { providerCommission: { percentage: 20 } } } },
        ],
      },
    }),
    serialize: data => JSON.stringify(data),
    handleError,
  }));
  jest.doMock('./nylas/processAliasCheck', () => ({ assertProcessAliasMatchesListing: () => {} }));
  jest.doMock('./promo/resolve', () => ({ resolvePromo }));
  jest.doMock('./promo/store', () => store);
  const handler = require('./initiate-privileged');
  return { handler, initiate, initiateSpeculative, store, resolvePromo, handleError };
};

const call = async (handler, { isSpeculative = false, promoCode } = {}) => {
  const res = {
    statusCode: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    set() {
      return this;
    },
    send() {
      return this;
    },
    end() {
      return this;
    },
  };
  const req = {
    body: {
      isSpeculative,
      orderData: { ...(promoCode ? { promoCode } : {}), currency: 'GBP' },
      bodyParams: {
        processAlias: 'default-booking/release-7',
        transition: 'transition/request-payment',
        params: { listingId: listing.id, bookingStart: new Date(), bookingEnd: new Date() },
      },
      queryParams: {},
    },
  };
  await handler(req, res);
  // the handler's promise chain is not returned, so wait for it to settle
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  return res;
};

const sentLineItems = initiateFn => initiateFn.mock.calls[0][0].params.lineItems;

describe('initiate-privileged with a promo code', () => {
  it('without a code, asks for no promo and sends no discount line', async () => {
    const ctx = load();
    await call(ctx.handler);
    expect(ctx.resolvePromo).not.toHaveBeenCalled();
    expect(sentLineItems(ctx.initiate).map(l => l.code)).not.toContain('line-item/promo-discount');
    expect(ctx.initiate.mock.calls[0][0].params.metadata).toBeUndefined();
  });

  it('a real booking reserves a use, sends the discount line and the promo metadata', async () => {
    const ctx = load({ resolveResult: { code: 'NEWYEAR15', percentOff: 15, redemptionId: '41' } });
    await call(ctx.handler, { promoCode: 'newyear15' });

    expect(ctx.resolvePromo).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCode: 'newyear15',
        customerId: 'customer-1',
        reserve: true,
        commissionPercent: 20,
      })
    );
    const lines = sentLineItems(ctx.initiate);
    const discount = lines.find(l => l.code === 'line-item/promo-discount');
    expect(discount.percentage).toBe(-15);
    expect(discount.includeFor).toEqual(['customer']);
    expect(ctx.initiate.mock.calls[0][0].params.metadata).toEqual({
      promo: { code: 'NEWYEAR15', percentOff: 15 },
    });
    // The use is tied to the booking Sharetribe created.
    expect(ctx.store.attachTransaction).toHaveBeenCalledWith('41', 'tx-new');
    expect(ctx.store.release).not.toHaveBeenCalled();
  });

  it('a price preview reserves nothing and attaches nothing', async () => {
    const ctx = load({ resolveResult: { code: 'NEWYEAR15', percentOff: 15 } });
    await call(ctx.handler, { isSpeculative: true, promoCode: 'NEWYEAR15' });
    expect(ctx.resolvePromo).toHaveBeenCalledWith(expect.objectContaining({ reserve: false }));
    expect(ctx.initiateSpeculative).toHaveBeenCalledTimes(1);
    expect(ctx.store.attachTransaction).not.toHaveBeenCalled();
  });

  it('a refused code stops the booking before Sharetribe is asked, with the reason in the answer', async () => {
    const ctx = load({ resolveThrows: promoError('expired') });
    const res = await call(ctx.handler, { promoCode: 'OLDCODE' });
    expect(ctx.initiate).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.statusText).toBe('promo-expired');
    // An expected answer is not logged as a fault.
    expect(ctx.handleError).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      skipErrorLogging: true,
    });
  });

  it('gives the reserved use back if Sharetribe refuses the booking', async () => {
    const failure = Object.assign(new Error('nope'), {
      status: 409,
      statusText: 'Conflict',
      data: {},
    });
    const ctx = load({
      resolveResult: { code: 'NEWYEAR15', percentOff: 15, redemptionId: '41' },
      initiateThrows: failure,
    });
    await call(ctx.handler, { promoCode: 'NEWYEAR15' });
    expect(ctx.store.release).toHaveBeenCalledWith('41');
    expect(ctx.store.attachTransaction).not.toHaveBeenCalled();
  });

  it('keeps the use if the booking was created but tying it to the code fails (the reconcile job settles it)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = load({ resolveResult: { code: 'NEWYEAR15', percentOff: 15, redemptionId: '41' } });
    ctx.store.attachTransaction.mockRejectedValue(new Error('db'));
    const res = await call(ctx.handler, { promoCode: 'NEWYEAR15' });
    expect(res.statusCode).toBe(200);
    expect(ctx.store.release).not.toHaveBeenCalled();
    console.error.mockRestore();
  });
});
