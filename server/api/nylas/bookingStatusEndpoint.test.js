jest.mock('../../api-util/sdk', () => ({
  createCookieTokenStore: jest.fn(),
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));
jest.mock('./config', () => ({ isConfigured: jest.fn() }));
jest.mock('./manageBookingShared', () => ({ loadCalendarBookingTransaction: jest.fn() }));
jest.mock('./db', () => ({
  isAvailable: jest.fn(),
  findByTransactionId: jest.fn(),
  hasPendingEventCancellation: jest.fn(),
}));

const db = require('./db');
const { getSdk } = require('../../api-util/sdk');
const { isConfigured } = require('./config');
const { loadCalendarBookingTransaction } = require('./manageBookingShared');
const endpoint = require('./bookingStatusEndpoint');

const HOUR = 3600000;

const statusFor = async ({ startsInHours = 100, pending = false } = {}) => {
  const start = new Date(Date.now() + startsInHours * HOUR);
  db.findByTransactionId.mockResolvedValue([
    {
      nylas_booking_id: 'bk-1',
      status: 'created',
      booking_start: start,
      booking_end: new Date(start.getTime() + HOUR),
    },
  ]);
  db.hasPendingEventCancellation.mockResolvedValue(pending);
  const res = { statusCode: null, body: null };
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = body => {
    res.body = body;
    return res;
  };
  await endpoint({ query: { transactionId: 'tx-1' } }, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Mock implementations do not survive between tests in this setup, so they are set here.
  isConfigured.mockReturnValue(true);
  db.isAvailable.mockReturnValue(true);
  getSdk.mockReturnValue({});
  loadCalendarBookingTransaction.mockResolvedValue({ booking: null });
});

describe('GET /api/nylas/booking-status', () => {
  it('says a session more than 48 hours away can be moved and is not being cancelled', async () => {
    const res = await statusFor({ startsInHours: 100 });
    expect(res.body).toMatchObject({
      status: 'created',
      rescheduleAllowed: true,
      cancellationPending: false,
    });
  });

  it('says a session inside 48 hours cannot be moved', async () => {
    const res = await statusFor({ startsInHours: 47 });
    expect(res.body.rescheduleAllowed).toBe(false);
  });

  it("says when the coach's deletion of the event is in its five-minute wait", async () => {
    const res = await statusFor({ pending: true });
    expect(res.body.cancellationPending).toBe(true);
  });
});
