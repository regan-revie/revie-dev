jest.mock('./db', () => ({
  isAvailable: jest.fn(),
  findBookingByCalendarToken: jest.fn(),
}));
jest.mock('./integration', () => ({ isConfigured: jest.fn() }));
jest.mock('./sessionEmails', () => ({ buildBookingCalendar: jest.fn() }));

const db = require('./db');
const integration = require('./integration');
const { buildBookingCalendar } = require('./sessionEmails');
const endpoint = require('./calendarLinkEndpoint');

const HOUR = 3600000;
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const booking = (over = {}) => ({
  nylas_booking_id: 'bk-1',
  status: 'created',
  booking_start: new Date(Date.now() + 48 * HOUR),
  booking_end: new Date(Date.now() + 49 * HOUR),
  ...over,
});

const respond = () => {
  const res = { headers: {}, statusCode: null, body: null };
  res.status = c => {
    res.statusCode = c;
    return res;
  };
  res.type = t => {
    res.headers['Content-Type'] = t;
    return res;
  };
  res.set = h => {
    Object.assign(res.headers, h);
    return res;
  };
  res.send = b => {
    res.body = b;
    return res;
  };
  return res;
};
const get = async token => {
  const res = respond();
  await endpoint({ params: { token } }, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  db.isAvailable.mockReturnValue(true);
  integration.isConfigured.mockReturnValue(true);
  db.findBookingByCalendarToken.mockResolvedValue(booking());
  buildBookingCalendar.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
});

describe('GET /api/nylas/calendar/:token/revie-session.ics', () => {
  it("serves the booking's calendar file as text/calendar named revie-session.ics, never stored", async () => {
    const res = await get(TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/^text\/calendar/);
    expect(res.headers['Content-Disposition']).toContain('filename="revie-session.ics"');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    expect(db.findBookingByCalendarToken).toHaveBeenCalledWith(TOKEN);
  });

  it('serves a rescheduled booking too (the file is built from its current time)', async () => {
    db.findBookingByCalendarToken.mockResolvedValue(booking({ status: 'rescheduled' }));
    expect((await get(TOKEN)).statusCode).toBe(200);
    expect(buildBookingCalendar.mock.calls[0][0].mapping.status).toBe('rescheduled');
  });

  it('is 404 for an unknown token, and says no more than for any other refusal', async () => {
    db.findBookingByCalendarToken.mockResolvedValue(null);
    const unknown = await get(TOKEN);
    db.findBookingByCalendarToken.mockResolvedValue(booking({ status: 'cancelled' }));
    const cancelled = await get(TOKEN);
    expect(unknown.statusCode).toBe(404);
    expect(cancelled.statusCode).toBe(404);
    expect(cancelled.body).toBe(unknown.body);
    expect(buildBookingCalendar).not.toHaveBeenCalled();
  });

  it('expires when the booking is cancelled', async () => {
    db.findBookingByCalendarToken.mockResolvedValue(booking({ status: 'cancelled' }));
    expect((await get(TOKEN)).statusCode).toBe(404);
  });

  it('expires 7 days after the session: good just before, gone just after', async () => {
    const end = Date.now() - 7 * 24 * HOUR;
    db.findBookingByCalendarToken.mockResolvedValue(
      booking({ booking_start: new Date(end - HOUR), booking_end: new Date(end + 60000) })
    );
    expect((await get(TOKEN)).statusCode).toBe(200);
    db.findBookingByCalendarToken.mockResolvedValue(
      booking({ booking_start: new Date(end - HOUR), booking_end: new Date(end - 60000) })
    );
    expect((await get(TOKEN)).statusCode).toBe(404);
  });

  it('does not even look a malformed token up (a transaction id or a guess)', async () => {
    for (const bad of [
      '',
      'short',
      '6afb4b88-42eb-402c-888e-c7c1fa2a6760!',
      'a'.repeat(200),
      undefined,
    ]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await get(bad)).statusCode).toBe(404);
    }
    expect(db.findBookingByCalendarToken).not.toHaveBeenCalled();
  });

  it('is 404 without a database, and 500 (no details) if the file cannot be built', async () => {
    db.isAvailable.mockReturnValue(false);
    expect((await get(TOKEN)).statusCode).toBe(404);
    db.isAvailable.mockReturnValue(true);
    buildBookingCalendar.mockRejectedValue(new Error('sharetribe down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get(TOKEN);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/sharetribe/);
    spy.mockRestore();
  });
});
