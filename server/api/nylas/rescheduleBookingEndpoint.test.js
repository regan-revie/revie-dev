// The endpoint a client's Reschedule button calls. Mocked: Sharetribe, Nylas and the database. What is
// under test is the rule: a client may move a session only while cancelling it would still be free.
jest.mock('../../api-util/sdk', () => ({
  createCookieTokenStore: jest.fn(),
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));
jest.mock('./config', () => ({ isConfigured: jest.fn() }));
jest.mock('./availability', () => ({ rescheduleBooking: jest.fn() }));
jest.mock('./manageBookingShared', () => ({ loadCalendarBookingTransaction: jest.fn() }));
jest.mock('./db', () => ({
  isAvailable: jest.fn(),
  findByTransactionId: jest.fn(),
  recordBookingEvent: jest.fn(),
}));

const { rescheduleBooking } = require('./availability');
const { loadCalendarBookingTransaction } = require('./manageBookingShared');
const db = require('./db');
const { getSdk, handleError } = require('../../api-util/sdk');
const { isConfigured } = require('./config');
const endpoint = require('./rescheduleBookingEndpoint');

const HOUR = 3600000;
const hoursFromNow = h => new Date(Date.now() + h * HOUR);

const respond = () => {
  const res = { statusCode: null, body: null };
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = body => {
    res.body = body;
    return res;
  };
  return res;
};

// A session `sessionHours` away now, moved to `newHours` away.
const reschedule = async ({ sessionHours, newHours, notice }) => {
  db.findByTransactionId.mockResolvedValue([
    {
      nylas_booking_id: 'bk-1',
      nylas_grant_id: 'g1',
      status: 'created',
      booking_start: hoursFromNow(sessionHours),
    },
  ]);
  loadCalendarBookingTransaction.mockResolvedValue({
    configurationId: 'cfg-1',
    lengthMinutes: 60,
    listing: {
      attributes: {
        publicData: notice === undefined ? {} : { nylasMinBookingNoticeMinutes: notice },
      },
    },
  });
  const start = hoursFromNow(newHours);
  const res = respond();
  await endpoint(
    {
      body: {
        transactionId: 'tx-1',
        start: start.toISOString(),
        end: new Date(start.getTime() + HOUR).toISOString(),
      },
    },
    res
  );
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Mock implementations do not survive between tests in this setup, so they are set here.
  isConfigured.mockReturnValue(true);
  db.isAvailable.mockReturnValue(true);
  db.recordBookingEvent.mockResolvedValue({});
  getSdk.mockReturnValue({});
  handleError.mockImplementation((res, e) =>
    res.status(e.status || 500).json({ error: e.message })
  );
  rescheduleBooking.mockResolvedValue({ event_id: 'ev-1' });
});

describe('POST /api/nylas/reschedule-booking: the 48-hour window', () => {
  it('allows a client to move a session that is 49 hours away', async () => {
    const res = await reschedule({ sessionHours: 49, newHours: 100 });
    expect(res.statusCode).toBe(200);
    expect(rescheduleBooking).toHaveBeenCalledTimes(1);
  });

  it('rejects, on the server, a session that is 47 hours away - and never asks Nylas', async () => {
    const res = await reschedule({ sessionHours: 47, newHours: 100 });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('reschedule-too-late');
    expect(res.body.error).toMatch(/less than 48 hours/);
    expect(rescheduleBooking).not.toHaveBeenCalled();
  });

  it('measures from the real start in our database, not the original Sharetribe booking', async () => {
    // Already moved once to a time 10 hours away: that is the time that counts.
    const res = await reschedule({ sessionHours: 10, newHours: 100 });
    expect(res.statusCode).toBe(409);
  });

  it('refuses rather than guesses when the row has no usable start', async () => {
    db.findByTransactionId.mockResolvedValue([
      { nylas_booking_id: 'bk-1', nylas_grant_id: 'g1', status: 'created', booking_start: null },
    ]);
    loadCalendarBookingTransaction.mockResolvedValue({
      configurationId: 'cfg-1',
      lengthMinutes: 60,
      listing: { attributes: { publicData: {} } },
    });
    const start = hoursFromNow(100);
    const res = respond();
    await endpoint(
      {
        body: {
          transactionId: 'tx-1',
          start: start.toISOString(),
          end: new Date(start.getTime() + HOUR).toISOString(),
        },
      },
      res
    );
    expect(res.statusCode).toBe(409);
    expect(rescheduleBooking).not.toHaveBeenCalled();
  });
});

describe('POST /api/nylas/reschedule-booking: notice for the new time', () => {
  it('still needs the normal 24 hours: 23 hours away is refused, 25 is allowed', async () => {
    const tooSoon = await reschedule({ sessionHours: 100, newHours: 23 });
    expect(tooSoon.statusCode).toBe(400);
    expect(tooSoon.body.code).toBe('reschedule-too-soon');
    expect(rescheduleBooking).not.toHaveBeenCalled();

    const fine = await reschedule({ sessionHours: 100, newHours: 25 });
    expect(fine.statusCode).toBe(200);
  });

  it("uses the coach's own notice when the listing has one", async () => {
    const res = await reschedule({ sessionHours: 100, newHours: 25, notice: 72 * 60 });
    expect(res.statusCode).toBe(400);
  });
});
