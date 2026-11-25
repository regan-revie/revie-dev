jest.mock('../../api-util/sdk', () => ({
  createCookieTokenStore: jest.fn(),
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));
jest.mock('./config', () => ({ isConfigured: jest.fn() }));
jest.mock('./manageBookingShared', () => ({ loadCalendarBookingTransaction: jest.fn() }));
jest.mock('./sessionEmails', () => ({ meetLinkFor: jest.fn(), calendarUrlFor: jest.fn() }));
jest.mock('./db', () => ({
  isAvailable: jest.fn(),
  findByTransactionId: jest.fn(),
  hasPendingEventCancellation: jest.fn(),
}));

const db = require('./db');
const { getSdk } = require('../../api-util/sdk');
const { isConfigured } = require('./config');
const { loadCalendarBookingTransaction } = require('./manageBookingShared');
const { meetLinkFor, calendarUrlFor } = require('./sessionEmails');
const endpoint = require('./bookingStatusEndpoint');

const HOUR = 3600000;

const statusFor = async ({ startsInHours = 100, pending = false, query = {} } = {}) => {
  const start = new Date(Date.now() + startsInHours * HOUR);
  db.findByTransactionId.mockResolvedValue([
    {
      nylas_booking_id: 'bk-1',
      nylas_grant_id: 'grant-1',
      sharetribe_transaction_id: 'tx-1',
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
  await endpoint({ query: { transactionId: 'tx-1', ...query } }, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Mock implementations do not survive between tests in this setup, so they are set here.
  isConfigured.mockReturnValue(true);
  db.isAvailable.mockReturnValue(true);
  getSdk.mockReturnValue({});
  loadCalendarBookingTransaction.mockResolvedValue({
    booking: null,
    listing: { attributes: { publicData: { nylasCalendarId: 'cal-1' } } },
  });
  meetLinkFor.mockResolvedValue('https://meet.google.com/abc-defg');
  calendarUrlFor.mockResolvedValue('https://example.com/api/nylas/calendar/tok/revie-session.ics');
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

describe('GET /api/nylas/booking-status with links', () => {
  it('leaves the links out unless asked (the page polls this after a reschedule)', async () => {
    const res = await statusFor();
    expect(res.body.meetLink).toBeUndefined();
    expect(res.body.calendarUrl).toBeUndefined();
    expect(meetLinkFor).not.toHaveBeenCalled();
  });

  it('carries the Meet link and the Add to calendar link of an active session when asked', async () => {
    const res = await statusFor({ query: { links: '1' } });
    expect(res.body.meetLink).toBe('https://meet.google.com/abc-defg');
    expect(res.body.calendarUrl).toBe(
      'https://example.com/api/nylas/calendar/tok/revie-session.ics'
    );
    // Found the way the email finds them: the booking, its grant and the listing's calendar.
    expect(meetLinkFor).toHaveBeenCalledWith({
      bookingId: 'bk-1',
      transactionId: 'tx-1',
      grantId: 'grant-1',
      calendarId: 'cal-1',
    });
    expect(calendarUrlFor).toHaveBeenCalledWith('bk-1');
  });

  it('still answers, with empty links, when either cannot be found', async () => {
    meetLinkFor.mockRejectedValue(new Error('nylas down'));
    calendarUrlFor.mockRejectedValue(new Error('db down'));
    const res = await statusFor({ query: { links: '1' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ meetLink: '', calendarUrl: '', status: 'created' });
  });
});
