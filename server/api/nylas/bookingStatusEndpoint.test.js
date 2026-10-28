const hoursFromNow = h => new Date(Date.now() + h * 3600000);

const call = async rows => {
  jest.resetModules();
  jest.doMock('../../api-util/sdk', () => ({
    createCookieTokenStore: jest.fn(),
    getSdk: jest.fn(() => ({})),
    handleError: jest.fn(),
  }));
  jest.doMock('./config', () => ({ isConfigured: () => true }));
  jest.doMock('./manageBookingShared', () => ({
    loadCalendarBookingTransaction: async () => ({ booking: null }),
  }));
  jest.doMock('./db', () => ({
    isAvailable: () => true,
    findByTransactionId: async () => rows,
  }));
  const handler = require('./bookingStatusEndpoint');
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
  await handler({ query: { transactionId: 'tx-1' } }, res);
  return res;
};

describe('GET /api/nylas/booking-status', () => {
  it('says whether cancelling now would be refunded (more than 48 hours out)', async () => {
    const res = await call([
      { status: 'created', booking_start: hoursFromNow(72), booking_end: hoursFromNow(73) },
    ]);
    expect(res.body).toMatchObject({ status: 'created', freeCancellationNow: true });
  });

  it('says it would be charged inside 48 hours', async () => {
    const res = await call([
      { status: 'created', booking_start: hoursFromNow(12), booking_end: hoursFromNow(13) },
    ]);
    expect(res.body.freeCancellationNow).toBe(false);
  });

  it('reports a cancelled session, and whether that cancellation was refunded', async () => {
    const start = hoursFromNow(72);
    const res = await call([
      {
        status: 'cancelled',
        booking_start: start,
        booking_end: hoursFromNow(73),
        updated_at: new Date(),
      },
    ]);
    expect(res.body).toMatchObject({ status: 'cancelled', freeCancellation: true });
  });

  it('reports a late cancellation as charged', async () => {
    const res = await call([
      {
        status: 'cancelled',
        booking_start: hoursFromNow(12),
        booking_end: hoursFromNow(13),
        updated_at: new Date(),
      },
    ]);
    expect(res.body.freeCancellation).toBe(false);
  });

  it('prefers an active booking over an older cancelled one (a rebooked transaction)', async () => {
    const res = await call([
      { status: 'created', booking_start: hoursFromNow(72), booking_end: hoursFromNow(73) },
      {
        status: 'cancelled',
        booking_start: hoursFromNow(10),
        booking_end: hoursFromNow(11),
        updated_at: new Date(),
      },
    ]);
    expect(res.body.status).toBe('created');
  });
});
