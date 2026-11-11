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
  it('records an event against a booking, replacing an older one', async () => {
    const db = loadDb(URL);
    await db.recordBookingEvent({ nylasBookingId: 'b1', nylasEventId: 'e1', nylasGrantId: 'g1' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO nylas_booking_events/);
    expect(sql).toMatch(/ON CONFLICT \(nylas_booking_id\) DO UPDATE/);
    expect(params).toEqual(['b1', 'e1', 'g1']);
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

  it('lists only active upcoming bookings that have no event recorded', async () => {
    await loadDb(URL).findBookingsMissingEvent(5);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN nylas_booking_events/);
    expect(sql).toMatch(/e\.nylas_booking_id IS NULL/);
    expect(sql).toMatch(/status IN \('created', 'rescheduled'\)/);
    expect(sql).toMatch(/booking_start > now\(\)/);
    expect(params).toEqual([5]);
  });

  it('creates its table and lookup index with the rest of the schema', async () => {
    await loadDb(URL).initSchema();
    const all = mockQuery.mock.calls.map(c => c[0]).join('\n');
    expect(all).toMatch(/CREATE TABLE IF NOT EXISTS nylas_booking_events/);
    expect(all).toMatch(/nylas_booking_events_event_idx/);
  });
});
