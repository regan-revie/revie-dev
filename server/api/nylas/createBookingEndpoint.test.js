const TX = 'tx-uuid-0001-aaaa';
const CUSTOMER = 'customer-uuid-1';

const load = ({ customerId, callerId, ensureOutcome = { outcome: 'booked' }, ownOrders = [] }) => {
  jest.resetModules();
  const ensureBooking = jest.fn(async () => ensureOutcome);
  jest.doMock('../../api-util/sdk', () => ({
    createCookieTokenStore: jest.fn(),
    getSdk: () => ({
      currentUser: { show: async () => ({ data: { data: { id: { uuid: callerId } } } }) },
      transactions: {
        query: async () => ({ data: { data: ownOrders.map(uuid => ({ id: { uuid } })) } }),
      },
    }),
    handleError: jest.fn(),
  }));
  jest.doMock('./config', () => ({ isConfigured: () => true }));
  jest.doMock('./manageBookingShared', () => ({
    loadCalendarBookingTransaction: async () => ({ tx: {}, customerId }),
  }));
  jest.doMock('./bookingRecovery', () => ({ ensureBooking }));
  const handler = require('./createBookingEndpoint');
  return { handler, ensureBooking };
};

const call = async handler => {
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
  await handler({ body: { transactionId: TX } }, res);
  return res;
};

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('POST /api/nylas/create-booking, who may call it', () => {
  it('lets the customer who paid create the booking', async () => {
    const { handler, ensureBooking } = load({ customerId: CUSTOMER, callerId: CUSTOMER });
    const res = await call(handler);
    expect(res.code).toBe(200);
    expect(ensureBooking).toHaveBeenCalledWith({ transactionId: TX, source: 'browser' });
  });

  it('refuses any other user, and never starts a booking for them', async () => {
    const { handler, ensureBooking } = load({ customerId: CUSTOMER, callerId: 'someone-else' });
    const res = await call(handler);
    expect(res.code).toBe(403);
    expect(ensureBooking).not.toHaveBeenCalled();
  });

  it('does not refuse the real customer just because the customer relationship is missing', async () => {
    // The bug: the relationship is only present when included, its absence meant "not the customer".
    const { handler, ensureBooking } = load({
      customerId: null,
      callerId: CUSTOMER,
      ownOrders: [TX],
    });
    const res = await call(handler);
    expect(res.code).toBe(200);
    expect(ensureBooking).toHaveBeenCalledTimes(1);
  });

  it('still refuses a stranger when the customer relationship is missing', async () => {
    const { handler, ensureBooking } = load({
      customerId: null,
      callerId: 'someone-else',
      ownOrders: [],
    });
    const res = await call(handler);
    expect(res.code).toBe(403);
    expect(ensureBooking).not.toHaveBeenCalled();
  });

  it('logs why it refused', async () => {
    const { handler } = load({ customerId: CUSTOMER, callerId: 'someone-else' });
    await call(handler);
    expect(console.error.mock.calls.flat().join(' ')).toMatch(
      /create-booking refused \(not-the-customer\)/
    );
  });
});
