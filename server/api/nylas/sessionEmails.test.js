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
const mockTxState = { last: 'transition/operator-accept' };
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
  cancelSessionEmails: jest.fn(
    async (bookingId, kinds = ['reminder', 'reminder60', 'rescheduled', 'confirmed']) => {
      let n = 0;
      mockStore.rows.forEach(r => {
        if (r.nylas_booking_id === bookingId && kinds.includes(r.kind) && r.status === 'pending') {
          r.status = 'cancelled';
          n += 1;
        }
      });
      return n;
    }
  ),
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
  getSessionEmail: jest.fn(async key => {
    const r = mockStore.rows.get(key);
    return r ? { ...r } : null;
  }),
  postponeSessionEmail: jest.fn(async (key, seconds) => {
    const r = mockStore.rows.get(key);
    if (r && r.status === 'sending') {
      Object.assign(r, {
        status: 'pending',
        send_at: new Date(Date.now() + seconds * 1000),
        attempts: Math.max(r.attempts - 1, 0),
      });
    }
  }),
  countRescheduleEmails: jest.fn(
    async id =>
      [...mockStore.rows.values()].filter(
        r =>
          r.nylas_booking_id === id &&
          r.kind === 'rescheduled' &&
          r.recipient === 'client' &&
          r.status !== 'cancelled'
      ).length
  ),
  findBookingsMissingConfirmation: jest.fn(async (hours, limit) => {
    const cutoff = Date.now() - hours * 3600000;
    return [...mockStore.bookings.values()]
      .filter(
        b =>
          ['created', 'rescheduled'].includes(b.status) &&
          new Date(b.created_at).getTime() > cutoff &&
          new Date(b.booking_start).getTime() > Date.now() &&
          ![...mockStore.rows.values()].some(
            r => r.nylas_booking_id === b.nylas_booking_id && r.kind === 'confirmed'
          )
      )
      .slice(0, limit);
  }),
  claimOverdueConfirmations: jest.fn(async minutes => {
    const cutoff = Date.now() - minutes * 60000;
    const rows = [...mockStore.rows.values()].filter(
      r =>
        r.kind === 'confirmed' &&
        ['pending', 'sending'].includes(r.status) &&
        r.send_at.getTime() < cutoff &&
        !(r.details && r.details.alerted)
    );
    rows.forEach(r => {
      r.details = { ...(r.details || {}), alerted: true };
    });
    return rows.map(r => ({
      nylas_booking_id: r.nylas_booking_id,
      status: r.status,
      attempts: r.attempts,
    }));
  }),
  getOrCreateCalendarToken: jest.fn(async id => `tok-${id}`),
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
    tx: {
      id: { uuid: TX },
      attributes: {
        protectedData: { clientTimeZone: 'America/New_York' },
        payinTotal: { amount: 5000, currency: 'USD' },
        lastTransition: mockTxState.last,
      },
    },
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
    created_at: new Date(),
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
  mockTxState.last = 'transition/operator-accept';
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
    expect(client.model.timeZoneNote).toMatch(/Sam's timezone: UK time/);
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

// --- the client's "You're booked" email -------------------------------------------------------------

describe('"You\'re booked" (the client\'s confirmation)', () => {
  const MINUTE = 60000;
  // Nylas has told us which calendar event the booking is, so its Meet link can be read.
  beforeEach(() => mockStore.eventIds.set(BOOKING, 'ev-1'));
  const advanceMinutes = m => jest.setSystemTime(Date.now() + m * MINUTE);
  const confirmedRows = () => rowsOf().filter(r => r.kind === 'confirmed');
  const decode = attachment => Buffer.from(attachment.content, 'base64').toString('utf8');
  const unfold = text => text.replace(/\r\n /g, '');
  const queue = (startHours = 72) => {
    const start = makeBooking(startHours);
    return emails.queueConfirmation({ bookingId: BOOKING, sessionStart: start });
  };

  describe('queueing', () => {
    it('queues one for the client, due at once, and none for the coach', async () => {
      expect(await queue()).toEqual({ queued: 1 });
      expect(confirmedRows()).toHaveLength(1);
      expect(confirmedRows()[0]).toMatchObject({
        recipient: 'client',
        kind: 'confirmed',
        status: 'pending',
        nylas_booking_id: BOOKING,
      });
      expect(confirmedRows()[0].send_at.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('is once per booking: asking again, or after the session moves, queues nothing more', async () => {
      await queue();
      expect(await queue()).toEqual({ queued: 0 });
      await emails.rescheduleEmails({
        bookingId: BOOKING,
        oldStart: at(72),
        oldEnd: at(73),
        newStart: at(100),
        newEnd: at(101),
      });
      expect(confirmedRows()).toHaveLength(1);
    });

    it('is queued even for a booking made less than 24 hours ahead (which gets no reminder)', async () => {
      expect(await queue(5)).toEqual({ queued: 1 });
    });

    it('is cancelled with the booking, if it has not gone out yet', async () => {
      await queue();
      await emails.cancelBookingEmails(BOOKING);
      expect(confirmedRows()[0].status).toBe('cancelled');
    });
  });

  describe('sending', () => {
    it('sends to the client, by its own template, with the session, the time in their zone, the length, what was paid and the refund line', async () => {
      await queue(72);
      const summary = await emails.processDueSessionEmails({ send });

      expect(summary).toMatchObject({ checked: 1, sent: 1, postponed: 0 });
      const mail = sent[0];
      expect(mail.to).toBe('alex@client.example');
      expect(mail.templateAlias).toBe('booking-confirmed-client');
      expect(mail.tag).toBe('confirmed');
      expect(mail.model).toMatchObject({
        recipientName: 'Alex',
        coachName: 'Sam Coach',
        sessionName: 'Find your focus',
        timeZoneName: 'Eastern Time',
        lengthText: '1 hour',
        meetLink: 'https://meet.google.com/abc-defg',
        hasMeetLink: true,
        totalPaid: '$50.00',
        hasTotalPaid: true,
        freeWindowOpen: true,
        freeWindowClosed: false,
        manageUrl: 'https://revie-dev.onrender.com/order/tx-1',
      });
      expect(mail.model.freeUntil).toMatch(/\(Eastern Time\)$/);
      expect(mail.model.calendarUrl).toBe(
        'https://revie-dev.onrender.com/api/nylas/calendar/tok-bk-1/revie-session.ics'
      );
      expect(confirmedRows()[0].status).toBe('sent');
    });

    it('attaches a calendar file with the Meet link and the booking link, at sequence 0', async () => {
      await queue(72);
      await emails.processDueSessionEmails({ send });

      expect(sent[0].attachments).toHaveLength(1);
      const [file] = sent[0].attachments;
      expect(file.name).toBe('revie-session.ics');
      expect(file.contentType).toMatch(/^text\/calendar/);
      const ics = unfold(decode(file));
      expect(ics).toContain('UID:booking-bk-1@heyrevie.com');
      expect(ics).toContain('SEQUENCE:0');
      expect(ics).toContain('LOCATION:https://meet.google.com/abc-defg');
      expect(ics).toContain('URL:https://revie-dev.onrender.com/order/tx-1');
      expect(ics).toContain('Join on Google Meet: https://meet.google.com/abc-defg');
      expect(ics).toContain('SUMMARY:Find your focus with Sam Coach');
    });

    it('says there is no free window for a booking made less than 48 hours ahead', async () => {
      await queue(30);
      await emails.processDueSessionEmails({ send });
      expect(sent[0].model).toMatchObject({ freeWindowOpen: false, freeWindowClosed: true });
    });
  });

  describe('waiting for the Meet link', () => {
    const noLink = () => nylasRequest.mockResolvedValue({ conferencing: null });

    it('is put back, without using a try, while the booking is new and there is no link yet', async () => {
      noLink();
      await queue(72);
      const summary = await emails.processDueSessionEmails({ send });

      expect(summary).toMatchObject({ sent: 0, postponed: 1, retried: 0, failed: 0 });
      expect(sent).toHaveLength(0);
      const row = confirmedRows()[0];
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(0);
      expect(row.send_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('goes as soon as the link exists, on a later tick', async () => {
      noLink();
      await queue(72);
      await emails.processDueSessionEmails({ send });
      advanceMinutes(2);
      nylasRequest.mockResolvedValue({
        conferencing: { details: { url: 'https://meet.google.com/new-link' } },
      });
      const summary = await emails.processDueSessionEmails({ send });
      expect(summary.sent).toBe(1);
      expect(sent[0].model.meetLink).toBe('https://meet.google.com/new-link');
    });

    it('waits through many ticks without ever being counted as failing', async () => {
      noLink();
      await queue(72);
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await emails.processDueSessionEmails({ send });
        advanceMinutes(1.5);
      }
      expect(sent).toHaveLength(0);
      expect(confirmedRows()[0].attempts).toBeLessThanOrEqual(1);
      expect(confirmedRows()[0].status).toBe('pending');
    });

    it('goes without a link after ten minutes (a coach whose calendar has no Meet), with the calendar file still attached', async () => {
      noLink();
      await queue(72);
      advanceMinutes(11);
      const summary = await emails.processDueSessionEmails({ send });

      expect(summary.sent).toBe(1);
      expect(sent[0].model.hasMeetLink).toBe(false);
      const ics = unfold(decode(sent[0].attachments[0]));
      expect(ics).not.toMatch(/LOCATION:/);
      expect(ics).toContain('URL:https://revie-dev.onrender.com/order/tx-1');
    });

    it("does not wait for a reschedule confirmation, whatever the booking's age", async () => {
      noLink();
      makeBooking(72);
      await emails.rescheduleEmails({
        bookingId: BOOKING,
        oldStart: at(72),
        oldEnd: at(73),
        newStart: at(100),
        newEnd: at(101),
      });
      const summary = await emails.processDueSessionEmails({ send });
      expect(summary.postponed).toBe(0);
      expect(summary.sent).toBe(2);
    });
  });

  describe('until the session starts', () => {
    it('is still sent hours later (sending had been off): it is not dropped as stale', async () => {
      await queue(72);
      advance(10);
      const summary = await emails.processDueSessionEmails({ send });
      expect(summary).toMatchObject({ sent: 1, skipped: 0 });
    });

    it('is skipped, and reported to Sentry, if the session has already started', async () => {
      await queue(5);
      advance(6);
      const summary = await emails.processDueSessionEmails({ send });

      expect(summary).toMatchObject({ sent: 0, skipped: 1 });
      expect(confirmedRows()[0].status).toBe('skipped');
      expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'postmark-confirmation-missed', {
        bookingId: BOOKING,
      });
    });

    it('is skipped quietly for a booking that was cancelled meanwhile', async () => {
      await queue(72);
      mockStore.bookings.get(BOOKING).status = 'cancelled';
      await emails.processDueSessionEmails({ send });
      expect(confirmedRows()[0]).toMatchObject({ status: 'skipped', last_error: 'inactive' });
      expect(log.error).not.toHaveBeenCalled();
    });
  });

  describe('a value that cannot be worked out', () => {
    const withoutAmount = () =>
      integration.loadTransactionAsOperator.mockImplementation(async () => ({
        tx: {
          id: { uuid: TX },
          attributes: { protectedData: { clientTimeZone: 'America/New_York' } },
        },
        listing: {
          attributes: {
            title: 'Find your focus',
            availabilityPlan: { timezone: 'Europe/London' },
            publicData: { nylasCalendarId: 'cal-1' },
          },
        },
        customer: {
          attributes: { email: 'alex@client.example', profile: { displayName: 'Alex' } },
        },
        provider: {
          attributes: {
            email: 'sam@coach.example',
            profile: { displayName: 'Sam', privateData: {} },
          },
        },
      }));

    it('still sends, and reports the missing field to Sentry with the booking and the field names', async () => {
      withoutAmount();
      await queue(72);
      const summary = await emails.processDueSessionEmails({ send });

      expect(summary.sent).toBe(1);
      expect(sent[0].model.totalPaid).toBe('');
      expect(log.error).toHaveBeenCalledWith(
        expect.any(Error),
        'postmark-confirmation-missing-field',
        { bookingId: BOOKING, fields: ['totalPaid'] }
      );
    });

    it('reports once per email, not on every tick it waits for the Meet link', async () => {
      withoutAmount();
      nylasRequest.mockResolvedValue({ conferencing: null });
      await queue(72);
      await emails.processDueSessionEmails({ send });
      advanceMinutes(2);
      await emails.processDueSessionEmails({ send });
      expect(log.error).not.toHaveBeenCalled(); // still waiting: nothing sent, nothing reported
      advanceMinutes(11);
      await emails.processDueSessionEmails({ send });
      const reports = log.error.mock.calls.filter(
        c => c[1] === 'postmark-confirmation-missing-field'
      );
      expect(reports).toHaveLength(1);
    });

    it('says nothing when everything is there', async () => {
      await queue(72);
      await emails.processDueSessionEmails({ send });
      expect(log.error).not.toHaveBeenCalled();
      expect(sent[0].model.totalPaid).toBe('$50.00');
      expect(sent[0].model.freeUntil).not.toBe('');
    });

    it('shows a promo discount in the client\'s "You\'re booked": the full price, the discount, the total paid', async () => {
      integration.loadTransactionAsOperator.mockImplementation(async () => ({
        tx: {
          id: { uuid: TX },
          attributes: {
            protectedData: { clientTimeZone: 'America/New_York' },
            payinTotal: { amount: 8500, currency: 'USD' },
            lineItems: [
              { code: 'line-item/fixed', lineTotal: { amount: 10000, currency: 'USD' } },
              { code: 'line-item/promo-discount', lineTotal: { amount: -1500, currency: 'USD' } },
              {
                code: 'line-item/provider-commission',
                lineTotal: { amount: -2000, currency: 'USD' },
              },
            ],
            metadata: { promo: { code: 'NEWYEAR15', percentOff: 15 } },
            lastTransition: mockTxState.last,
          },
        },
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
      await queue(72);
      await emails.processDueSessionEmails({ send });
      expect(sent[0].model.fullPriceText).toBe('Session price: $100.00');
      expect(sent[0].model.discountText).toBe('Promo discount (NEWYEAR15): -$15.00');
      expect(sent[0].model.totalPaid).toBe('$85.00');
    });

    it('leaves the discount lines empty when no code was used, so the email is as before', async () => {
      await queue(72);
      await emails.processDueSessionEmails({ send });
      expect(sent[0].model.fullPriceText).toBe('');
      expect(sent[0].model.discountText).toBe('');
    });
  });

  describe('when it fails', () => {
    it('is reported to Sentry as a missing confirmation once the third try fails', async () => {
      send.mockRejectedValue(new Error('postmark down'));
      await queue(72);
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await emails.processDueSessionEmails({ send });
      }
      expect(confirmedRows()[0].status).toBe('failed');
      const tags = log.error.mock.calls.map(c => c[1]);
      expect(tags.filter(t => t === 'postmark-confirmation-failed')).toHaveLength(1);
      expect(tags.filter(t => t === 'postmark-send-failed')).toHaveLength(3);
    });

    it('does not report a reminder that fails as a missing confirmation', async () => {
      send.mockRejectedValue(new Error('postmark down'));
      const start = makeBooking(72);
      await emails.scheduleReminders({ bookingId: BOOKING, sessionStart: start });
      advance(48);
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await emails.processDueSessionEmails({ send });
      }
      expect(log.error.mock.calls.map(c => c[1])).not.toContain('postmark-confirmation-failed');
    });
  });

  describe('a confirmation that never went out', () => {
    it('is reported once when it is still unsent half an hour after it was due', async () => {
      await queue(72);
      send.mockRejectedValue(new Error('postmark down')); // never leaves the queue within the half hour
      await emails.processDueSessionEmails({ send });
      advanceMinutes(31);
      expect(await emails.reportOverdueConfirmations()).toBe(1);
      expect(log.error).toHaveBeenCalledWith(
        expect.any(Error),
        'postmark-confirmation-overdue',
        expect.objectContaining({ bookingId: BOOKING })
      );
      expect(await emails.reportOverdueConfirmations()).toBe(0); // once each
    });

    it('is not reported while sending is switched off (nothing is expected to go out)', async () => {
      process.env.POSTMARK_SENDING_ENABLED = 'false';
      await queue(72);
      advanceMinutes(60);
      expect(await emails.reportOverdueConfirmations()).toBe(0);
      expect(log.error).not.toHaveBeenCalled();
    });

    it('is not reported when it went out', async () => {
      await queue(72);
      await emails.processDueSessionEmails({ send });
      advanceMinutes(60);
      expect(await emails.reportOverdueConfirmations()).toBe(0);
    });

    it('is queued by the catch-up when the webhook never did, and reported because that path failed', async () => {
      makeBooking(72);
      const result = await emails.backfillConfirmations();
      expect(result).toEqual({ checked: 1, queued: 1 });
      expect(confirmedRows()).toHaveLength(1);
      expect(log.error).toHaveBeenCalledWith(
        expect.any(Error),
        'postmark-confirmation-not-queued',
        { bookingId: BOOKING }
      );
      // And not again.
      log.error.mockClear();
      expect(await emails.backfillConfirmations()).toEqual({ checked: 0, queued: 0 });
      expect(log.error).not.toHaveBeenCalled();
    });

    it('is not queued by the catch-up for an old booking (nobody is emailed about a session booked long ago)', async () => {
      makeBooking(72, { created_at: new Date(Date.now() - 3 * 24 * HOUR) });
      expect(await emails.backfillConfirmations()).toEqual({ checked: 0, queued: 0 });
    });
  });

  describe('the reminder that follows it', () => {
    const remindersFor = booking =>
      emails.scheduleReminders({ bookingId: BOOKING, sessionStart: booking });

    it('is skipped for the client when the confirmation went out less than two hours before it is due, and still sent to the coach', async () => {
      const start = makeBooking(25); // reminder due in one hour
      await emails.queueConfirmation({ bookingId: BOOKING, sessionStart: start });
      await remindersFor(start);
      await emails.processDueSessionEmails({ send }); // the confirmation goes now
      advance(1);
      const summary = await emails.processDueSessionEmails({ send });

      expect(sent.filter(s => s.templateAlias === 'session-reminder-client')).toHaveLength(0);
      expect(sent.filter(s => s.templateAlias === 'session-reminder-coach')).toHaveLength(1);
      expect(summary.skipped).toBe(1);
      const skipped = rowsOf('skipped').find(r => r.kind === 'reminder');
      expect(skipped.last_error).toBe('confirmation-just-sent');
    });

    it('is sent as usual when the booking was made more than two hours before it is due', async () => {
      const start = makeBooking(30); // reminder due in six hours
      await emails.queueConfirmation({ bookingId: BOOKING, sessionStart: start });
      await remindersFor(start);
      await emails.processDueSessionEmails({ send });
      advance(6);
      await emails.processDueSessionEmails({ send });
      expect(sent.filter(s => s.templateAlias === 'session-reminder-client')).toHaveLength(1);
    });

    it('is sent as usual when there was no confirmation (an older booking)', async () => {
      const start = makeBooking(72);
      await remindersFor(start);
      advance(48);
      await emails.processDueSessionEmails({ send });
      expect(sent.filter(s => s.templateAlias === 'session-reminder-client')).toHaveLength(1);
    });
  });
});

describe("the client's reschedule email and its calendar file", () => {
  const decode = attachment => Buffer.from(attachment.content, 'base64').toString('utf8');
  const unfold = text => text.replace(/\r\n /g, '');
  const move = async (from, to, extra = {}) => {
    await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart: at(from),
      oldEnd: at(from + 1),
      newStart: at(to),
      newEnd: at(to + 1),
      ...extra,
    });
  };

  it('attaches the moved event for the client: the same UID as the first file, one sequence higher', async () => {
    makeBooking(72);
    await move(72, 100);
    await emails.processDueSessionEmails({ send });

    const client = sent.find(s => s.templateAlias === 'session-rescheduled-client');
    const ics = unfold(decode(client.attachments[0]));
    expect(ics).toContain('UID:booking-bk-1@heyrevie.com');
    expect(ics).toContain('SEQUENCE:1');
    const newStart = at(100)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    expect(ics).toContain(`DTSTART:${newStart}`);
  });

  it('raises the sequence with every further move', async () => {
    makeBooking(72);
    await move(72, 100);
    await emails.processDueSessionEmails({ send });
    sent.length = 0;
    mockStore.bookings.get(BOOKING).booking_start = at(100);
    await move(100, 130);
    await emails.processDueSessionEmails({ send });

    const client = sent.find(s => s.templateAlias === 'session-rescheduled-client');
    expect(unfold(decode(client.attachments[0]))).toContain('SEQUENCE:2');
  });

  it('gives the coach no file (their calendar has the event already)', async () => {
    makeBooking(72);
    await move(72, 100);
    await emails.processDueSessionEmails({ send });
    const coach = sent.find(s => s.templateAlias === 'session-rescheduled-coach');
    expect(coach.attachments).toBeUndefined();
  });

  it('says when it is free to cancel or move until, for the new time', async () => {
    makeBooking(72);
    await move(72, 100);
    await emails.processDueSessionEmails({ send });
    const client = sent.find(s => s.templateAlias === 'session-rescheduled-client');
    expect(client.model).toMatchObject({ freeWindowOpen: true, timeZoneName: 'Eastern Time' });
    expect(client.model.freeUntil).toMatch(/\(Eastern Time\)$/);
  });
});

// --- the client's 60-hour reminder ------------------------------------------------------------------

describe('the 60-hour reminder (client only)', () => {
  const rows60 = status => rowsOf(status).filter(r => r.kind === 'reminder60');
  const queue60 = async (startHours, extra) => {
    const start = makeBooking(startHours, extra);
    return emails.schedule60hReminder({ bookingId: BOOKING, sessionStart: start });
  };
  const ALIAS = 'session-reminder-60h-client';

  describe('queueing', () => {
    it('queues one for the client, due 60 hours before the start, for a booking made more than 60 hours ahead', async () => {
      expect(await queue60(100)).toEqual({ queued: 1 });
      expect(rows60()).toHaveLength(1);
      const row = rows60()[0];
      expect(row.recipient).toBe('client');
      expect(row.send_at.getTime() - Date.now()).toBeCloseTo(40 * HOUR, -4);
    });

    it('is once per booking and start time: asking again queues nothing more', async () => {
      await queue60(100);
      expect(await queue60(100)).toMatchObject({ queued: 0 });
    });

    it('queues nothing for a booking made inside 60 hours (its "You\'re booked" already says when it is free until)', async () => {
      expect(await queue60(59)).toEqual({ queued: 0, skipped: 'under-60h' });
      expect(rows60()).toHaveLength(0);
    });
  });

  describe('a reschedule', () => {
    const move = (from, to) =>
      emails.rescheduleEmails({
        bookingId: BOOKING,
        oldStart: at(from),
        oldEnd: at(from + 1),
        newStart: at(to),
        newEnd: at(to + 1),
      });

    it('follows the new time: the old one is cancelled and a new one queued for 60 hours before it', async () => {
      await queue60(100);
      await move(100, 130);
      expect(rows60('cancelled')).toHaveLength(1);
      const pending = rows60('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].session_start.getTime()).toBe(at(130).getTime());
    });

    it('queues none when the 60-hour mark has already passed for the new time, and still cancels the old', async () => {
      await queue60(100);
      await move(100, 70 - 20); // 50 hours out
      expect(rows60('pending')).toHaveLength(0);
      expect(rows60('cancelled')).toHaveLength(1);
    });

    it('sends none to the coach', async () => {
      await queue60(100);
      await move(100, 130);
      expect(rowsOf().filter(r => r.kind === 'reminder60' && r.recipient === 'coach')).toHaveLength(
        0
      );
    });
  });

  describe('sending', () => {
    it('goes to the client by its own template, with the date, the free-until time in their zone, and the booking link', async () => {
      await queue60(100);
      advance(40);
      const summary = await emails.processDueSessionEmails({ send });

      expect(summary).toMatchObject({ sent: 1, skipped: 0 });
      const mail = sent[0];
      expect(mail.to).toBe('alex@client.example');
      expect(mail.templateAlias).toBe(ALIAS);
      expect(mail.tag).toBe('reminder60');
      expect(mail.attachments).toBeUndefined();
      expect(mail.model).toMatchObject({
        recipientName: 'Alex',
        coachName: 'Sam Coach',
        timeZoneName: 'Eastern Time',
        manageUrl: 'https://revie-dev.onrender.com/order/tx-1',
      });
      expect(mail.model.freeUntilOpen).toMatch(/\(Eastern Time\)$/);
    });

    it.each([
      ['cancelled', 'transition/cancel'],
      ['declined', 'transition/operator-decline'],
      ['late-cancelled', 'transition/late-cancel'],
      ['expired', 'transition/expire'],
    ])('never goes for a %s transaction', async (_, transition) => {
      await queue60(100);
      advance(40);
      mockTxState.last = transition;
      const summary = await emails.processDueSessionEmails({ send });
      expect(summary).toMatchObject({ sent: 0, skipped: 1 });
      expect(rows60('skipped')[0].last_error).toBe('not-accepted');
    });

    it('goes for a transaction whose last transition is a reschedule update', async () => {
      await queue60(100);
      advance(40);
      mockTxState.last = 'transition/update-booking';
      expect((await emails.processDueSessionEmails({ send })).sent).toBe(1);
    });

    it('never goes for a booking that was cancelled on our side', async () => {
      await queue60(100);
      advance(40);
      mockStore.bookings.get(BOOKING).status = 'cancelled';
      await emails.processDueSessionEmails({ send });
      expect(sent).toHaveLength(0);
      expect(rows60('skipped')[0].last_error).toBe('inactive');
    });

    it('is dropped if the session moved after it was queued', async () => {
      await queue60(100);
      advance(40);
      mockStore.bookings.get(BOOKING).booking_start = at(200);
      await emails.processDueSessionEmails({ send });
      expect(sent).toHaveLength(0);
      expect(rows60('skipped')[0].last_error).toBe('moved');
    });

    it('is dropped, not sent late, once the free window it describes has closed (sending had been off)', async () => {
      await queue60(100);
      advance(40 + 13); // 47 hours before the session
      await emails.processDueSessionEmails({ send });
      expect(sent).toHaveLength(0);
      expect(rows60('skipped')[0].last_error).toBe('free-window-closed');
    });

    it('is cancelled with the booking', async () => {
      await queue60(100);
      await emails.cancelBookingEmails(BOOKING);
      expect(rows60('cancelled')).toHaveLength(1);
    });
  });

  describe('when it fails', () => {
    it('is reported to Sentry as postmark-reminder-60h-failed once the third try fails, and not as anything about a confirmation', async () => {
      send.mockRejectedValue(new Error('postmark down'));
      await queue60(100);
      advance(40);
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await emails.processDueSessionEmails({ send });
      }
      expect(rows60('failed')).toHaveLength(1);
      const tags = log.error.mock.calls.map(c => c[1]);
      expect(tags.filter(t => t === 'postmark-reminder-60h-failed')).toHaveLength(1);
      expect(tags).not.toContain('postmark-confirmation-failed');
    });
  });
});

describe('the calendar file behind "Add to calendar"', () => {
  beforeEach(() => mockStore.eventIds.set(BOOKING, 'ev-1'));
  const unfold = text => text.replace(/\r\n /g, '');

  it('is the booking as it stands: the current time, the Meet link, the same UID as the attachment', async () => {
    makeBooking(72);
    const ics = unfold(
      await emails.buildBookingCalendar({ mapping: mockStore.bookings.get(BOOKING) })
    );
    expect(ics).toContain('UID:booking-bk-1@heyrevie.com');
    expect(ics).toContain('LOCATION:https://meet.google.com/abc-defg');
    expect(ics).toContain('URL:https://revie-dev.onrender.com/order/tx-1');
    expect(ics).toContain('SEQUENCE:0');
  });

  it('shows the new time after a reschedule, with the same UID and a higher sequence', async () => {
    makeBooking(72);
    await emails.rescheduleEmails({
      bookingId: BOOKING,
      oldStart: at(72),
      oldEnd: at(73),
      newStart: at(100),
      newEnd: at(101),
    });
    Object.assign(mockStore.bookings.get(BOOKING), {
      booking_start: at(100),
      booking_end: at(101),
    });
    const ics = unfold(
      await emails.buildBookingCalendar({ mapping: mockStore.bookings.get(BOOKING) })
    );
    const start = at(100)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    expect(ics).toContain(`DTSTART:${start}`);
    expect(ics).toContain('UID:booking-bk-1@heyrevie.com');
    expect(ics).toContain('SEQUENCE:1');
  });
});
