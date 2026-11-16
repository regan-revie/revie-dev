// The endpoint a client's Reschedule button calls. Mocked: Sharetribe, Nylas and the database. What is
// under test is the rule: a client may move a session only while cancelling it would still be free.
jest.mock('../../log', () => ({ error: jest.fn() }));
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
  hasPendingEventCancellation: jest.fn(),
}));

const log = require('../../log');
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
const reschedule = async ({ sessionHours, newHours, notice, mappings }) => {
  db.findByTransactionId.mockResolvedValue(
    mappings || [
      {
        nylas_booking_id: 'bk-1',
        nylas_grant_id: 'g1',
        status: 'created',
        booking_start: hoursFromNow(sessionHours),
        booking_end: new Date(hoursFromNow(sessionHours).getTime() + HOUR),
      },
    ]
  );
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
  db.hasPendingEventCancellation.mockResolvedValue(false);
  endpoint.resetMoves();
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

const nylasFailure = (status, type, message) =>
  Object.assign(new Error(`Nylas booking reschedule failed with status ${status}`), {
    status,
    source: 'nylas',
    nylasError: { type, message },
  });

describe('POST /api/nylas/reschedule-booking: when Nylas says no', () => {
  it("tells the client the time isn't available any more (Nylas 400, 'The selected timeslot is unavailable')", async () => {
    rescheduleBooking.mockRejectedValue(
      nylasFailure(400, 'invalid_request_error', 'The selected timeslot is unavailable')
    );
    const res = await reschedule({ sessionHours: 100, newHours: 200 });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('reschedule-slot-unavailable');
    expect(res.body.error).toMatch(/isn't available any more/);
  });

  it("writes Nylas's error type and message to the log and Sentry, and nothing about the people", async () => {
    rescheduleBooking.mockRejectedValue(
      nylasFailure(400, 'invalid_request_error', 'The selected timeslot is unavailable')
    );
    await reschedule({ sessionHours: 100, newHours: 200 });
    expect(log.error).toHaveBeenCalledTimes(1);
    const [, code, data] = log.error.mock.calls[0];
    expect(code).toBe('nylas-reschedule-failed');
    expect(data).toEqual({
      transactionId: 'tx-1',
      nylasStatus: 400,
      nylasErrorType: 'invalid_request_error',
      nylasErrorMessage: 'The selected timeslot is unavailable',
      code: 'reschedule-slot-unavailable',
    });
  });

  it('says the session has been cancelled when Nylas says the booking is cancelled', async () => {
    rescheduleBooking.mockRejectedValue(
      nylasFailure(400, 'invalid_request_error', 'Booking is already cancelled')
    );
    const res = await reschedule({ sessionHours: 100, newHours: 200 });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('booking-cancelled');
  });

  it('says the same when Nylas no longer has the booking (404)', async () => {
    rescheduleBooking.mockRejectedValue(nylasFailure(404, 'not_found_error', 'Booking not found'));
    const res = await reschedule({ sessionHours: 100, newHours: 200 });
    expect(res.body.code).toBe('booking-cancelled');
  });

  it('says the session has been cancelled when our own record says so, without asking Nylas', async () => {
    const res = await reschedule({
      newHours: 200,
      mappings: [
        { nylas_booking_id: 'bk-1', status: 'cancelled', booking_start: hoursFromNow(100) },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('booking-cancelled');
    expect(rescheduleBooking).not.toHaveBeenCalled();
  });

  it('answers anything else with a plain failure code (and still reports it)', async () => {
    rescheduleBooking.mockRejectedValue(nylasFailure(504, 'provider_error', 'Provider failure'));
    const res = await reschedule({ sessionHours: 100, newHours: 200 });
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('reschedule-failed');
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/nylas/reschedule-booking: a coach-deleted booking in its five-minute wait', () => {
  it('is refused, without asking Nylas, with a message that the coach is cancelling it', async () => {
    db.hasPendingEventCancellation.mockResolvedValue(true);
    const res = await reschedule({ sessionHours: 100, newHours: 200 });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('being-cancelled-by-coach');
    expect(res.body.error).toMatch(/being cancelled by the coach/);
    expect(rescheduleBooking).not.toHaveBeenCalled();
  });
});

describe('POST /api/nylas/reschedule-booking: the same move asked for twice', () => {
  it('is a success, not an error, when the session is already at that time (the repeat of a move that landed)', async () => {
    // The first request moved it to 30 hours from now, which is inside 48 hours: the repeat must not
    // be refused by the 48-hour rule or by Nylas.
    const target = 30;
    const start = hoursFromNow(target);
    const res = respond();
    db.findByTransactionId.mockResolvedValue([
      {
        nylas_booking_id: 'bk-1',
        nylas_grant_id: 'g1',
        status: 'rescheduled',
        booking_start: start,
        booking_end: new Date(start.getTime() + HOUR),
      },
    ]);
    loadCalendarBookingTransaction.mockResolvedValue({
      configurationId: 'cfg-1',
      lengthMinutes: 60,
      listing: { attributes: { publicData: {} } },
    });
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
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, alreadyMoved: true });
    expect(rescheduleBooking).not.toHaveBeenCalled();
  });

  it('goes to Nylas once when two requests for the same time overlap, and both succeed', async () => {
    let release;
    rescheduleBooking.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve({ event_id: 'ev-1' });
        })
    );
    const first = reschedule({ sessionHours: 100, newHours: 200 });
    // The same request again, before the first has finished (it must be the same instant).
    const newStart = hoursFromNow(200);
    await new Promise(r => setImmediate(r));
    const secondRes = respond();
    const body = {
      transactionId: 'tx-1',
      start: newStart.toISOString(),
      end: new Date(newStart.getTime() + HOUR).toISOString(),
    };
    // Align the first request's time with the second's.
    expect(rescheduleBooking).toHaveBeenCalledTimes(1);
    const firstStart = rescheduleBooking.mock.calls[0][0].start;
    body.start = firstStart.toISOString();
    body.end = new Date(firstStart.getTime() + HOUR).toISOString();
    const second = endpoint({ body }, secondRes);
    await new Promise(r => setImmediate(r));
    release();
    const [firstRes] = await Promise.all([first, second]);

    expect(rescheduleBooking).toHaveBeenCalledTimes(1);
    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
  });

  it('shares the success for a minute: a repeat before our record catches up does not reach Nylas', async () => {
    const first = await reschedule({ sessionHours: 100, newHours: 200 });
    expect(first.statusCode).toBe(200);
    const firstStart = rescheduleBooking.mock.calls[0][0].start;
    const res = respond();
    await endpoint(
      {
        body: {
          transactionId: 'tx-1',
          start: firstStart.toISOString(),
          end: new Date(firstStart.getTime() + HOUR).toISOString(),
        },
      },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(rescheduleBooking).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed attempt at once, so trying again is a real try', async () => {
    rescheduleBooking.mockRejectedValueOnce(
      nylasFailure(504, 'provider_error', 'Provider failure')
    );
    const failed = await reschedule({ sessionHours: 100, newHours: 200 });
    expect(failed.statusCode).toBe(502);
    const firstStart = rescheduleBooking.mock.calls[0][0].start;

    rescheduleBooking.mockResolvedValue({ event_id: 'ev-1' });
    const res = respond();
    await endpoint(
      {
        body: {
          transactionId: 'tx-1',
          start: firstStart.toISOString(),
          end: new Date(firstStart.getTime() + HOUR).toISOString(),
        },
      },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(rescheduleBooking).toHaveBeenCalledTimes(2);
  });
});
