const load = ({ publicData }) => {
  jest.resetModules();
  const { types } = require('sharetribe-flex-sdk'); // eslint-disable-line global-require
  const { Money, UUID } = types;
  const listing = {
    id: new UUID('listing-1'),
    attributes: { price: new Money(10000, 'GBP'), publicData },
  };
  const initiate = jest.fn(async () => ({ status: 200, statusText: 'OK', data: { data: {} } }));
  const initiateSpeculative = jest.fn(async () => ({
    status: 200,
    statusText: 'OK',
    data: { data: {} },
  }));
  const handleError = jest.fn((res, e) => res.status(e.status || 500).json({ code: e.statusText }));
  jest.doMock('../api-util/sdk', () => ({
    createCookieTokenStore: jest.fn(),
    getSdk: () => ({ listings: { show: async () => ({ data: { data: listing } }) } }),
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
  return {
    handler: require('./initiate-privileged'),
    initiate,
    initiateSpeculative,
    handleError,
    listing,
  };
};

const call = async (handler, listing, { isSpeculative = false } = {}) => {
  const res = {
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
  await handler(
    {
      body: {
        isSpeculative,
        orderData: { currency: 'GBP' },
        bodyParams: {
          processAlias: 'default-booking/release-7',
          transition: 'transition/request-payment',
          params: { listingId: listing.id, bookingStart: new Date(), bookingEnd: new Date() },
        },
        queryParams: {},
      },
    },
    res
  );
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  return res;
};

const sessionData = {
  unitType: 'fixed',
  priceVariationsEnabled: false,
  transactionProcessAlias: 'default-booking/release-7',
  nylasConfigurationIds: { 60: 'cfg-60' },
};

describe('starting a booking on a calendar session whose coach has to reconnect', () => {
  it('is refused before Sharetribe is asked, so no booking and no payment can start from an old page', async () => {
    const ctx = load({ publicData: { ...sessionData, calendarBookingEnabled: false } });
    const res = await call(ctx.handler, ctx.listing);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('calendar-not-bookable');
    expect(ctx.initiate).not.toHaveBeenCalled();
    expect(ctx.initiateSpeculative).not.toHaveBeenCalled();
  });

  it('the price preview is refused too, so the checkout says so instead of showing a price', async () => {
    const ctx = load({ publicData: { ...sessionData, calendarBookingEnabled: false } });
    const res = await call(ctx.handler, ctx.listing, { isSpeculative: true });
    expect(res.body.code).toBe('calendar-not-bookable');
    expect(ctx.initiateSpeculative).not.toHaveBeenCalled();
  });

  it('is not logged to Sentry as a fault: it is an expected refusal', async () => {
    const ctx = load({ publicData: { ...sessionData, calendarBookingEnabled: false } });
    await call(ctx.handler, ctx.listing);
    expect(ctx.handleError).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      skipErrorLogging: true,
    });
  });

  it('once the coach has reconnected and the session is bookable again, a booking goes through', async () => {
    const ctx = load({ publicData: { ...sessionData, calendarBookingEnabled: true } });
    const res = await call(ctx.handler, ctx.listing);
    expect(res.statusCode).toBe(200);
    expect(ctx.initiate).toHaveBeenCalledTimes(1);
  });
});
