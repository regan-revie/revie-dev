// Real sessionEmails, sessionEmailModel and postmark settings; a stand-in database that behaves like
// the real one (keyed rows, atomic claims), a controllable clock, and mocks only for Sharetribe,
// Nylas and Sentry.
jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./integration', () => ({
  isConfigured: jest.fn(),
  loadTransactionAsOperator: jest.fn(),
}));
jest.mock('./client', () => ({ nylasRequest: jest.fn() }));
jest.mock('./eventIdBackfill', () => ({ lookupEventId: jest.fn() }));

const mockStore = { rows: new Map(), bookings: new Map(), eventIds: new Map() };
jest.mock('./db', () => ({
  isAvailable: jest.fn(() => true),
  queueSessionEmail: jest.fn(async r => {
    const existing = mockStore.rows.get(r.dedupeKey);
    if (existing && existing.status !== 'cancelled') return false;
    mockStore.rows.set(r.dedupeKey, {
      dedupe_key: r.dedupeKey,
      kind: r.kind,
      nylas_booking_id: r.nylasBookingId,
      recipient: r.recipient,
      send_at: new Date(r.sendAt),
      session_start: r.sessionStart ? new Date(r.sessionStart) : null,
      details: r.details || null,
      status: 'pending',
      attempts: 0,
    });
    return true;
  }),
  cancelSessionEmails: jest.fn(async (bookingId, kinds = ['reminder', 'rescheduled']) => {
    let n = 0;
    mockStore.rows.forEach(r => {
      if (r.nylas_booking_id === bookingId && kinds.includes(r.kind) && r.status === 'pending') {
        r.status = 'cancelled';
        n += 1;
      }
    });
    return n;
  }),
  claimDueSessionEmails: jest.fn(async () => {
    const now = Date.now();
    const rows = [...mockStore.rows.values()].filter(
      r => r.status === 'pending' && r.send_at.getTime() <= now
    );
    rows.forEach(r => {
      r.status = 'sending';
      r.attempts += 1;
    });
    return rows.map(r => ({ ...r }));
  }),
  finishSessionEmail: jest.fn(async (key, status, lastError) => {
    Object.assign(mockStore.rows.get(key), { status, last_error: lastError || null });
  }),
  retrySessionEmail: jest.fn(async (key, lastError) => {
    const r = mockStore.rows.get(key);
    if (r.status === 'sending') Object.assign(r, { status: 'pending', last_error: lastError });
  }),
  findBookingsMissingReminders: jest.fn(async (hours, limit) => {
    const cutoff = Date.now() + hours * 3600000;
    return [...mockStore.bookings.values()]
      .filter(
        b =>
          ['created', 'rescheduled'].includes(b.status) &&
          new Date(b.booking_start).getTime() > cutoff &&
          ![...mockStore.rows.values()].some(
            r => r.nylas_booking_id === b.nylas_booking_id && r.kind === 'reminder'
          )
      )
      .slice(0, limit);
  }),
  findByBookingId: jest.fn(async id => mockStore.bookings.get(id) || null),
  // Only ids Nylas itself has given us (verified) are ever returned.
  findVerifiedEventIdForBooking: jest.fn(async id => mockStore.eventIds.get(id) || null),
  recordBookingEvent: jest.fn(async ({ nylasBookingId, nylasEventId }) => {
    mockStore.eventIds.set(nylasBookingId, nylasEventId);
  }),
}));

const HOUR = 3600000;
const BOOKING = 'bk-1';
const TX = 'tx-1';

let log;
let integration;
let lookupEventId;
let nylasRequest;
let db;
let emails;
const sent = [];
const send = jest.fn();

const load = () => {
  jest.resetModules();
  log = require('../../log');
  integration = require('./integration');
  ({ nylasRequest } = require('./client'));
  ({ lookupEventId } = require('./eventIdBackfill'));
  db = require('./db');

  db.isAvailable.mockReturnValue(true);
  integration.isConfigured.mockReturnValue(true);
  integration.loadTransactionAsOperator.mockImplementation(async () => ({
    tx: { id: { uuid: TX }, attributes: { protectedData: { clientTimeZone: 'America/New_York' } } },
    listing: {
      attributes: {
        title: 'Find your focus',
        availabilityPlan: { timezone: 'Europe/London' },
        publicData: { nylasCalendarId: 'cal-1' },
      },
    },
    customer: {
      attributes: { email: 'alex@client.example', profile: { displayName: 'Alex Client' } },
    },
    provider: {
      attributes: {
        email: 'sam@coach.example',
        profile: { displayName: 'Sam Coach', privateData: {} },
      },
    },
  }));
  nylasRequest.mockResolvedValue({
    conferencing: { details: { url: 'https://meet.google.com/abc-defg' } },
  });

  emails = require('./sessionEmails');
  return emails;
};

const at = hoursFromNow => new Date(Date.now() + hoursFromNow * HOUR);
const advance = hours => jest.setSystemTime(Date.now() + hours * HOUR);
const rowsOf = status => [...mockStore.rows.values()].filter(r => !status || r.status === status);

const makeBooking = (startHours, extra = {}) => {
  const start = at(startHours);
  mockStore.bookings.set(BOOKING, {
    nylas_booking_id: BOOKING,
    sharetribe_transaction_id: TX,
    nylas_grant_id: 'g1',
    booking_start: start,
    booking_end: new Date(start.getTime() + HOUR),
    status: 'created',
    ...extra,
  });
  return start;
};

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  jest.clearAllMocks();
  mockStore.rows.clear();
  mockStore.bookings.clear();
  mockStore.eventIds.clear();
  sent.length = 0;
  // Mock implementations do not survive between tests in this setup, so it is set here.
  send.mockImplementation(async args => {
    sent.push(args);
    return { messageId: 'm' };
  });
  process.env.POSTMARK_SENDING_ENABLED = 'true';
  process.env.POSTMARK_SERVER_TOKEN = 'token-not-printed';
  process.env.REACT_APP_MARKETPLACE_ROOT_URL = 'https://revie-dev.onrender.com';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  load();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete process.env.POSTMARK_SENDING_ENABLED;
});

describe('scheduling reminders', () => {
  it('a confirmed session more than 24 hours away gets a reminder for the client and one for the coach, due 24 hours before', async () => {
    const start = makeBooking(72);
    const result = await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });

    expect(result.queued).toBe(2);
    const rows = rowsOf('pending');
    expect(rows.map(r => r.recipient).sort()).toEqual(['client', 'coach']);
    rows.forEach(r => {
      expect(r.kind).toBe('reminder');
      expect(r.send_at.getTime()).toBe(start.getTime() - 24 * HOUR);
      expect(r.session_start.getTime()).toBe(start.getTime());
    });
  });

  it('a session booked less than 24 hours ahead gets none', async () => {
    const start = makeBooking(10);
    const result = await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    expect(result).toEqual({ queued: 0, skipped: 'under-24h' });
    expect(mockStore.rows.size).toBe(0);
  });

  it('exactly 24 hours ahead is also too late: there is no time left before the reminder is due', async () => {
    const start = makeBooking(24);
    expect(
      (await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start })).queued
    ).toBe(0);
  });

  it('asking twice (a redelivered webhook) queues nothing more', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    const again = await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    expect(again.queued).toBe(0);
    expect(mockStore.rows.size).toBe(2);
  });

  it('never throws into a booking: a failing database is logged and swallowed', async () => {
    db.queueSessionEmail.mockRejectedValueOnce(new Error('db down'));
    await expect(
      emails.safeScheduleReminders({ bookingId: BOOKING, sessionStart: at(72) })
    ).resolves.toBeNull();
  });
});

describe('rescheduling', () => {
  it('moves the reminders: the old ones are cancelled and new ones queued from the new time', async () => {
    const oldStart = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: oldStart });

    const newStart = at(120);
    await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart,
      oldEnd: new Date(oldStart.getTime() + HOUR),
      newStart,
      newEnd: new Date(newStart.getTime() + HOUR),
    });

    const reminders = [...mockStore.rows.values()].filter(r => r.kind === 'reminder');
    expect(reminders.filter(r => r.status === 'cancelled')).toHaveLength(2);
    const fresh = reminders.filter(r => r.status === 'pending');
    expect(fresh).toHaveLength(2);
    fresh.forEach(r => expect(r.send_at.getTime()).toBe(newStart.getTime() - 24 * HOUR));
  });

  it('moved to under 24 hours away: the old reminders are cancelled and no new ones queued', async () => {
    const oldStart = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: oldStart });
    await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart,
      oldEnd: oldStart,
      newStart: at(10),
      newEnd: at(11),
    });
    expect(rowsOf('pending').filter(r => r.kind === 'reminder')).toHaveLength(0);
  });

  it('queues a confirmation for each person, due now, with the old and new times', async () => {
    const oldStart = makeBooking(72);
    const newStart = at(96);
    const result = await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart,
      oldEnd: new Date(oldStart.getTime() + HOUR),
      newStart,
      newEnd: new Date(newStart.getTime() + HOUR),
    });

    expect(result.confirmations).toBe(2);
    const confirmations = [...mockStore.rows.values()].filter(r => r.kind === 'rescheduled');
    expect(confirmations.map(r => r.recipient).sort()).toEqual(['client', 'coach']);
    confirmations.forEach(r => {
      expect(r.send_at.getTime()).toBeLessThanOrEqual(Date.now());
      expect(r.details).toMatchObject({
        oldStart: oldStart.toISOString(),
        newStart: newStart.toISOString(),
      });
    });
  });

  it('is repeated harmlessly when Nylas delivers the notice twice', async () => {
    const oldStart = makeBooking(72);
    const args = {
      bookingId: BOOKING,
      oldStart,
      oldEnd: oldStart,
      newStart: at(96),
      newEnd: at(97),
    };
    await emails.rescheduleEmails(args);
    const again = await emails.rescheduleEmails(args);
    expect(again.confirmations).toBe(0);
    expect(rowsOf().filter(r => r.kind === 'rescheduled')).toHaveLength(2);
  });

  it('moved away and back: the reminder for the original time is put back, not lost', async () => {
    const original = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: original });
    await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart: original,
      oldEnd: original,
      newStart: at(120),
      newEnd: at(121),
    });
    await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart: at(120),
      oldEnd: at(121),
      newStart: original,
      newEnd: original,
    });

    const back = [...mockStore.rows.values()].filter(
      r => r.kind === 'reminder' && r.session_start.getTime() === original.getTime()
    );
    expect(back.every(r => r.status === 'pending')).toBe(true);
    expect(back).toHaveLength(2);
  });

  it('no confirmation when the time did not actually change', async () => {
    const start = makeBooking(72);
    const result = await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart: start,
      oldEnd: start,
      newStart: start,
      newEnd: start,
    });
    expect(result.confirmations).toBe(0);
  });
});

describe('cancelling', () => {
  it('cancels everything still pending, reminders and confirmations alike', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart: start,
      oldEnd: start,
      newStart: at(96),
      newEnd: at(97),
    });

    await emails.cancelBookingEmails(BOOKING);

    expect(rowsOf('pending')).toHaveLength(0);
    advance(200);
    const summary = await emails.processDueSessionEmails({ send });
    expect(summary.checked).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves an email that has already gone alone', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);
    await emails.processDueSessionEmails({ send });
    await emails.cancelBookingEmails(BOOKING);
    expect(rowsOf('sent')).toHaveLength(2);
  });
});

describe('sending', () => {
  it('sends each reminder once: to the right person, by template alias, with a model in their timezone', async () => {
    const start = makeBooking(72);
    mockStore.eventIds.set(BOOKING, 'ev-1');
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });

    advance(48); // 24 hours before the session
    const summary = await emails.processDueSessionEmails({ send });

    expect(summary).toMatchObject({ checked: 2, sent: 2, failed: 0, retried: 0 });
    const client = sent.find(s => s.templateAlias === 'session-reminder-client');
    const coach = sent.find(s => s.templateAlias === 'session-reminder-coach');
    expect(client.to).toBe('alex@client.example');
    expect(coach.to).toBe('sam@coach.example');
    expect(client.tag).toBe('reminder');
    // The client sees their own zone (New York), the coach theirs (London); both get the Meet link and
    // their own booking page.
    expect(client.model.timeZoneNote).toBe('');
    expect(client.model.meetLink).toBe('https://meet.google.com/abc-defg');
    expect(client.model.manageUrl).toBe('https://revie-dev.onrender.com/order/tx-1');
    expect(coach.model.manageUrl).toBe('https://revie-dev.onrender.com/sale/tx-1');
    expect(client.model.sessionTime).not.toBe(coach.model.sessionTime);
    expect(client.model.recipientName).toBe('Alex');
    expect(coach.model.recipientName).toBe('Sam');
  });

  it("says the times are in the coach's timezone when the client's is not known", async () => {
    integration.loadTransactionAsOperator.mockImplementation(async () => ({
      tx: { id: { uuid: TX }, attributes: { protectedData: {} } },
      listing: {
        attributes: { title: 'S', availabilityPlan: { timezone: 'Europe/London' }, publicData: {} },
      },
      customer: { attributes: { email: 'alex@client.example', profile: { displayName: 'Alex' } } },
      provider: {
        attributes: {
          email: 'sam@coach.example',
          profile: { displayName: 'Sam', privateData: {} },
        },
      },
    }));
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);
    await emails.processDueSessionEmails({ send });
    const client = sent.find(s => s.templateAlias === 'session-reminder-client');
    expect(client.model.timeZoneNote).toMatch(/Sam's timezone: London time/);
  });

  it('sends the email without a Meet link rather than not at all when the link cannot be read', async () => {
    const start = makeBooking(72);
    mockStore.eventIds.set(BOOKING, 'ev-1');
    nylasRequest.mockRejectedValue(new Error('nylas down'));
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);
    const summary = await emails.processDueSessionEmails({ send });
    expect(summary.sent).toBe(2);
    expect(sent[0].model.hasMeetLink).toBe(false);
  });

  describe('the Meet link and the event id it is read with', () => {
    const sendReminders = async () => {
      const start = makeBooking(72);
      await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
      advance(48);
      return emails.processDueSessionEmails({ send });
    };

    it('reads the event by the verified id', async () => {
      mockStore.eventIds.set(BOOKING, 'ev-verified');
      await sendReminders();
      expect(nylasRequest.mock.calls[0][0]).toContain('/events/ev-verified?');
      expect(lookupEventId).not.toHaveBeenCalled();
    });

    it('with no verified id yet, asks Nylas for the real one, keeps it as verified, and uses it (never the creation-time id)', async () => {
      lookupEventId.mockResolvedValue('ev-from-nylas');
      await sendReminders();
      expect(lookupEventId).toHaveBeenCalledWith({
        nylas_booking_id: BOOKING,
        sharetribe_transaction_id: TX,
      });
      expect(db.recordBookingEvent).toHaveBeenCalledWith({
        nylasBookingId: BOOKING,
        nylasEventId: 'ev-from-nylas',
        nylasGrantId: 'g1',
        verified: true,
      });
      expect(nylasRequest.mock.calls[0][0]).toContain('/events/ev-from-nylas?');
      expect(sent[0].model.meetLink).toBe('https://meet.google.com/abc-defg');
    });

    it('sends without a link when Nylas cannot name the event either', async () => {
      lookupEventId.mockRejectedValue(new Error('the booking has no event id'));
      const summary = await sendReminders();
      expect(summary.sent).toBe(2);
      expect(sent[0].model.hasMeetLink).toBe(false);
      expect(nylasRequest).not.toHaveBeenCalled();
    });
  });

  it('sends nothing before the reminder is due', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(47);
    expect((await emails.processDueSessionEmails({ send })).checked).toBe(0);
  });

  it('sends exactly once however many times the tick runs', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);
    await emails.processDueSessionEmails({ send });
    await emails.processDueSessionEmails({ send });
    advance(1);
    await emails.processDueSessionEmails({ send });
    expect(sent).toHaveLength(2);
  });

  it('sends exactly once with two workers on the same tick', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);
    const [a, b] = await Promise.all([
      emails.processDueSessionEmails({ send }),
      emails.processDueSessionEmails({ send }),
    ]);
    expect(a.sent + b.sent).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it('sends exactly once across a restart: new module instances over the same database', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);
    await emails.processDueSessionEmails({ send });

    load(); // the server restarts
    await emails.processDueSessionEmails({ send });
    expect(sent).toHaveLength(2);
  });

  it('never repeats an email a dying worker had claimed (it stays "sending", not resent)', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);
    await db.claimDueSessionEmails(); // a worker claims them and dies before sending anything

    load();
    advance(1);
    const summary = await emails.processDueSessionEmails({ send });
    expect(summary.checked).toBe(0);
    expect(sent).toHaveLength(0);
    expect(rowsOf('sending')).toHaveLength(2);
  });

  it('sends a reschedule confirmation with the old and the new time, once', async () => {
    const oldStart = makeBooking(72);
    const newStart = at(96);
    await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart,
      oldEnd: new Date(oldStart.getTime() + HOUR),
      newStart,
      newEnd: new Date(newStart.getTime() + HOUR),
    });
    // The booking row has the new time by now, as the webhook handler writes it first.
    mockStore.bookings.get(BOOKING).booking_start = newStart;
    mockStore.bookings.get(BOOKING).booking_end = new Date(newStart.getTime() + HOUR);

    await emails.processDueSessionEmails({ send });
    await emails.processDueSessionEmails({ send });

    const coach = sent.find(s => s.templateAlias === 'session-rescheduled-coach');
    const client = sent.find(s => s.templateAlias === 'session-rescheduled-client');
    expect(sent.filter(s => s.tag === 'rescheduled')).toHaveLength(2);
    expect(coach.model.oldSessionDate).toBeDefined();
    expect(client.model.oldSessionTime).toBeDefined();
    expect(coach.model.sessionDate).not.toBe(coach.model.oldSessionDate);
  });
});

describe('when an email is no longer wanted', () => {
  it('skips one for a booking that has been cancelled since', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    mockStore.bookings.get(BOOKING).status = 'cancelled'; // cancelled in a way that did not cancel the rows
    advance(48);
    const summary = await emails.processDueSessionEmails({ send });
    expect(summary).toMatchObject({ checked: 2, skipped: 2, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('skips a reminder whose session has moved since it was queued', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    mockStore.bookings.get(BOOKING).booking_start = at(200);
    advance(48);
    expect((await emails.processDueSessionEmails({ send })).skipped).toBe(2);
  });

  it('skips a reminder that is overdue to the point of being useless (sending was off, session nearly here)', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(71); // an hour before the session
    expect((await emails.processDueSessionEmails({ send })).skipped).toBe(2);
    expect(send).not.toHaveBeenCalled();
  });

  it('skips a reschedule confirmation that is many hours old', async () => {
    const oldStart = makeBooking(72);
    const newStart = at(100);
    await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart,
      oldEnd: oldStart,
      newStart,
      newEnd: newStart,
    });
    mockStore.bookings.get(BOOKING).booking_start = newStart;
    advance(8);
    const summary = await emails.processDueSessionEmails({ send });
    expect(summary.skipped).toBe(2);
  });
});

describe('failures', () => {
  const queued = async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);
  };

  it('are reported to Sentry as postmark-send-failed (with the domain only), and retried on the next tick', async () => {
    await queued();
    const failing = jest.fn(async () => {
      throw Object.assign(new Error('Postmark send failed (HTTP 500, code none) for template x'), {
        status: 500,
      });
    });

    const first = await emails.processDueSessionEmails({ send: failing });
    expect(first).toMatchObject({ checked: 2, retried: 2, sent: 0, failed: 0 });
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'postmark-send-failed',
      expect.objectContaining({
        kind: 'reminder',
        bookingId: BOOKING,
        attempt: 1,
        domain: 'client.example',
      })
    );
    // Nothing in what is reported carries an address.
    log.error.mock.calls.forEach(c => expect(JSON.stringify(c[2])).not.toMatch(/@/));
    expect(rowsOf('pending')).toHaveLength(2);

    // The next tick tries again, and this time it goes.
    const second = await emails.processDueSessionEmails({ send });
    expect(second).toMatchObject({ checked: 2, sent: 2 });
    expect(rowsOf('sent')).toHaveLength(2);
  });

  it('give up after three tries, and are not tried a fourth time', async () => {
    await queued();
    const failing = jest.fn(async () => {
      throw new Error('nope');
    });

    const r1 = await emails.processDueSessionEmails({ send: failing });
    const r2 = await emails.processDueSessionEmails({ send: failing });
    const r3 = await emails.processDueSessionEmails({ send: failing });
    expect([r1.retried, r2.retried, r3.retried]).toEqual([2, 2, 0]);
    expect(r3.failed).toBe(2);
    expect(rowsOf('failed')).toHaveLength(2);

    const r4 = await emails.processDueSessionEmails({ send: failing });
    expect(r4.checked).toBe(0);
    expect(failing).toHaveBeenCalledTimes(6);
  });

  it('a recipient with no email address is a failure like any other, not a crash', async () => {
    await queued();
    integration.loadTransactionAsOperator.mockResolvedValue({
      tx: { id: { uuid: TX }, attributes: { protectedData: {} } },
      listing: { attributes: { title: 'S', publicData: {} } },
      customer: { attributes: { profile: { displayName: 'A' } } },
      provider: { attributes: { profile: { displayName: 'B', privateData: {} } } },
    });
    const summary = await emails.processDueSessionEmails({ send });
    expect(summary.retried).toBe(2);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the sending switch', () => {
  it('with POSTMARK_SENDING_ENABLED off, nothing is claimed or sent, and everything waits', async () => {
    process.env.POSTMARK_SENDING_ENABLED = 'false';
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);

    const summary = await emails.processDueSessionEmails({ send });
    expect(summary).toMatchObject({ disabled: true, checked: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(db.claimDueSessionEmails).not.toHaveBeenCalled();
    expect(rowsOf('pending')).toHaveLength(2);

    // Switched on later: the reminders are there, ready.
    process.env.POSTMARK_SENDING_ENABLED = 'true';
    expect((await emails.processDueSessionEmails({ send })).sent).toBe(2);
  });

  it('scheduling still happens while sending is off', async () => {
    process.env.POSTMARK_SENDING_ENABLED = 'false';
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: makeBooking(72) });
    expect(rowsOf('pending')).toHaveLength(2);
  });

  it('does nothing without a token, even when switched on', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN;
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: makeBooking(72) });
    advance(48);
    expect((await emails.processDueSessionEmails({ send })).disabled).toBe(true);
  });
});

describe('logs', () => {
  it('say a send happened with ids and the recipient domain, never a body or an address', async () => {
    const start = makeBooking(72);
    await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
    advance(48);
    await emails.processDueSessionEmails({ send });
    const lines = console.log.mock.calls
      .flat()
      .map(String)
      .filter(l => l.startsWith('[postmark]'));
    expect(lines).toHaveLength(2);
    lines.forEach(l => {
      expect(l).not.toMatch(/@/);
      expect(l).not.toMatch(/Alex|Sam/);
    });
    expect(lines[0]).toMatch(/\((client|coach)\.example\)/);
  });
});

describe('backfill', () => {
  it('queues reminders for confirmed upcoming sessions that never had any', async () => {
    makeBooking(72);
    const result = await emails.backfillReminders();
    expect(result).toEqual({ checked: 1, queued: 2 });
    expect((await emails.backfillReminders()).checked).toBe(0);
  });

  it('leaves a session under 24 hours away alone', async () => {
    makeBooking(10);
    expect((await emails.backfillReminders()).checked).toBe(0);
  });
});
