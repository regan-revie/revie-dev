// The pg Pool is mocked: these tests assert the SQL shape and the availability behaviour, not
// Postgres itself. Anything needing a real database is verified against the Render instance.
const mockQuery = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: mockQuery, on: jest.fn(), end: jest.fn() })),
}));

const loadDb = url => {
  let db;
  jest.isolateModules(() => {
    const original = process.env.DATABASE_URL;
    if (url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = url;
    db = require('./db');
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });
  return db;
};

const URL = 'postgres://user:pw@localhost:5432/revie_dev';

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('availability', () => {
  it('reports unavailable with no DATABASE_URL', () => {
    expect(loadDb(undefined).isAvailable()).toBe(false);
  });

  it('reports available once DATABASE_URL is set', () => {
    expect(loadDb(URL).isAvailable()).toBe(true);
  });

  it('refuses to run a query rather than pretending to succeed', async () => {
    // Losing a booking mapping silently would break cancellation with no visible cause.
    await expect(loadDb(undefined).findByBookingId('bk_1')).rejects.toThrow(/DATABASE_URL/);
  });

  it('initSchema reports failure instead of throwing when there is no database', async () => {
    await expect(loadDb(undefined).initSchema()).resolves.toBe(false);
  });
});

describe('schema', () => {
  it('creates the table and the reverse-lookup index idempotently', async () => {
    await loadDb(URL).initSchema();
    const sql = mockQuery.mock.calls.map(c => c[0]).join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS nylas_bookings/);
    expect(sql).toMatch(/ALTER TABLE nylas_bookings ADD COLUMN IF NOT EXISTS booking_end/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS nylas_bookings_transaction_idx/);
    // Safe to run on every boot, which is why there is no migration framework.
    expect(sql).not.toMatch(/DROP /);
  });
});

describe('recordBooking()', () => {
  it('upserts, so a redelivered webhook does not fail on a duplicate key', async () => {
    // Nylas can deliver the same booking.created more than once.
    mockQuery.mockResolvedValue({ rows: [{ nylas_booking_id: 'bk_1' }] });
    await loadDb(URL).recordBooking({
      nylasBookingId: 'bk_1',
      sharetribeTransactionId: 'tx_1',
      nylasGrantId: 'grant_1',
      bookingStart: '2026-06-01T12:00:00Z',
      bookingEnd: '2026-06-01T13:00:00Z',
      status: 'created',
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO nylas_bookings/);
    expect(sql).toMatch(/ON CONFLICT \(nylas_booking_id\) DO UPDATE/);
    expect(params).toEqual([
      'bk_1',
      'tx_1',
      'grant_1',
      '2026-06-01T12:00:00Z',
      '2026-06-01T13:00:00Z',
      'created',
    ]);
  });

  it('stores a null booking_start and booking_end rather than undefined', async () => {
    mockQuery.mockResolvedValue({ rows: [{}] });
    await loadDb(URL).recordBooking({
      nylasBookingId: 'bk_2',
      sharetribeTransactionId: 'tx_2',
      nylasGrantId: 'g',
      status: 'created',
    });
    expect(mockQuery.mock.calls[0][1][3]).toBeNull();
    expect(mockQuery.mock.calls[0][1][4]).toBeNull();
  });

  it('updates booking_start and booking_end on a reschedule, keyed on the same booking id', async () => {
    // A reschedule upserts the same row rather than inserting a new one - the primary key is the
    // Nylas booking id, which does not change when only the time does.
    mockQuery.mockResolvedValue({ rows: [{ nylas_booking_id: 'bk_1' }] });
    await loadDb(URL).recordBooking({
      nylasBookingId: 'bk_1',
      sharetribeTransactionId: 'tx_1',
      nylasGrantId: 'grant_1',
      bookingStart: '2026-06-02T12:00:00Z',
      bookingEnd: '2026-06-02T13:00:00Z',
      status: 'rescheduled',
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([
      'bk_1',
      'tx_1',
      'grant_1',
      '2026-06-02T12:00:00Z',
      '2026-06-02T13:00:00Z',
      'rescheduled',
    ]);
  });
});

describe('lookups', () => {
  it('finds by Nylas booking id, the direction webhooks need', async () => {
    mockQuery.mockResolvedValue({ rows: [{ nylas_booking_id: 'bk_1' }] });
    const row = await loadDb(URL).findByBookingId('bk_1');
    expect(row.nylas_booking_id).toBe('bk_1');
    expect(mockQuery.mock.calls[0][1]).toEqual(['bk_1']);
  });

  it('returns null rather than undefined when a booking is unknown', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(loadDb(URL).findByBookingId('nope')).resolves.toBeNull();
  });

  it('finds by transaction id for reconciling from the Sharetribe side', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    const rows = await loadDb(URL).findByTransactionId('tx_1');
    expect(rows).toHaveLength(2);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE sharetribe_transaction_id = \$1/);
  });
});

describe('calendar event ids', () => {
  it('records an event against a booking, never letting an unconfirmed id replace a confirmed one', async () => {
    const db = loadDb(URL);
    await db.recordBookingEvent({
      nylasBookingId: 'b1',
      nylasEventId: 'e1',
      nylasGrantId: 'g1',
      verified: true,
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO nylas_booking_events/);
    expect(sql).toMatch(/ON CONFLICT \(nylas_booking_id\) DO UPDATE/);
    // A write that is not confirmed by Nylas does not replace a row that is.
    expect(sql).toMatch(/WHERE EXCLUDED\.verified OR NOT nylas_booking_events\.verified/);
    expect(params).toEqual(['b1', 'e1', 'g1', true]);

    await db.recordBookingEvent({ nylasBookingId: 'b2', nylasEventId: 'e2', nylasGrantId: 'g1' });
    expect(mockQuery.mock.calls[1][1]).toEqual(['b2', 'e2', 'g1', false]);
  });

  it('finds a booking by grant id and event id together, and nothing else', async () => {
    mockQuery.mockResolvedValue({ rows: [{ nylas_booking_id: 'b1' }] });
    const row = await loadDb(URL).findBookingByEvent('g1', 'e1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/nylas_grant_id = \$1 AND e\.nylas_event_id = \$2/);
    expect(params).toEqual(['g1', 'e1']);
    expect(row).toEqual({ nylas_booking_id: 'b1' });
  });

  it('returns null for an event that is not a booking', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await loadDb(URL).findBookingByEvent('g1', 'someone-elses-meeting')).toBeNull();
  });

  it('lists active upcoming bookings whose id is missing or unconfirmed, skipping given-up and recently tried ones', async () => {
    await loadDb(URL).findBookingsNeedingEventCheck(5, 5, 3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/e\.nylas_booking_id IS NULL OR e\.verified = false/);
    expect(sql).toMatch(/status IN \('created', 'rescheduled'\)/);
    expect(sql).toMatch(/booking_start > now\(\)/);
    expect(sql).toMatch(/COALESCE\(f\.attempts, 0\) < \$3/);
    expect(sql).toMatch(/f\.last_attempt_at < now\(\) - \(\$2 \|\| ' minutes'\)::interval/);
    expect(params).toEqual([5, '5', 3]);
  });

  it('counts a failed lookup in the database and says how many so far', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ attempts: 2 }] });
    expect(await loadDb(URL).recordEventLookupFailure('b1')).toBe(2);
    expect(mockQuery.mock.calls[0][0]).toMatch(/attempts = nylas_event_lookups\.attempts \+ 1/);
  });

  it("looks only at one grant's bookings when asked about a grant (never other coaches')", async () => {
    await loadDb(URL).findActiveBookingsByGrant('g1', 20);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE nylas_grant_id = \$1/);
    expect(params).toEqual(['g1', 20]);
  });

  it('creates its tables and the confirmed-id column with the rest of the schema', async () => {
    await loadDb(URL).initSchema();
    const all = mockQuery.mock.calls.map(c => c[0]).join('\n');
    expect(all).toMatch(/CREATE TABLE IF NOT EXISTS nylas_booking_events/);
    expect(all).toMatch(/ADD COLUMN IF NOT EXISTS verified boolean/);
    expect(all).toMatch(/CREATE TABLE IF NOT EXISTS nylas_event_lookups/);
  });
});

describe('calendar deletion waits', () => {
  it('starts a wait with a due time five minutes on, and reports whether it started one', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ nylas_booking_id: 'b1' }] });
    const started = await loadDb(URL).scheduleEventCancellation({
      nylasBookingId: 'b1',
      nylasEventId: 'e1',
      nylasGrantId: 'g1',
      calendarId: 'cal-1',
      delayMinutes: 5,
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO nylas_event_cancellations/);
    expect(sql).toMatch(/now\(\) \+ \(\$5 \|\| ' minutes'\)::interval/);
    // A wait that is already pending is left alone (its time is not pushed back); only a finished
    // one is started again.
    expect(sql).toMatch(/WHERE nylas_event_cancellations\.status <> 'pending'/);
    expect(params).toEqual(['b1', 'e1', 'g1', 'cal-1', '5']);
    expect(started).toBe(true);
  });

  it('says a wait was already running when nothing was written', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(
      await loadDb(URL).scheduleEventCancellation({
        nylasBookingId: 'b1',
        nylasEventId: 'e1',
        nylasGrantId: 'g1',
        delayMinutes: 5,
      })
    ).toBe(false);
  });

  it('ends a wait as restored only while it is still pending', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ nylas_booking_id: 'b1' }] });
    const row = await loadDb(URL).markEventRestored('b1');
    expect(mockQuery.mock.calls[0][0]).toMatch(/status = 'restored'[\s\S]*status = 'pending'/);
    expect(row).toEqual({ nylas_booking_id: 'b1' });
  });

  it('claims only waits that are due and not locked, skipping any another worker holds', async () => {
    await loadDb(URL).claimDueEventCancellations(10, 120);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/status = 'pending' AND due_at <= now\(\) AND locked_until <= now\(\)/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(params).toEqual([10, '120']);
  });

  it('retries a failed one later without ending it, and finishes one with a status', async () => {
    const db = loadDb(URL);
    await db.retryEventCancellation('b1', 300);
    expect(mockQuery.mock.calls[0][0]).toMatch(
      /locked_until = now\(\) \+ \(\$2 \|\| ' seconds'\)::interval/
    );
    expect(mockQuery.mock.calls[0][0]).toMatch(/status = 'pending'/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['b1', '300']);

    await db.finishEventCancellation('b1', 'done');
    expect(mockQuery.mock.calls[1][1]).toEqual(['b1', 'done']);
  });

  it('creates its table with the rest of the schema', async () => {
    await loadDb(URL).initSchema();
    expect(mockQuery.mock.calls.map(c => c[0]).join('\n')).toMatch(
      /CREATE TABLE IF NOT EXISTS nylas_event_cancellations/
    );
  });
});
