/**
 * Persistence for the Nylas booking ↔ Sharetribe transaction mapping.
 *
 * Why this exists at all: a Nylas booking and a Sharetribe transaction are created in two systems
 * that know nothing about each other. When Nylas later says "booking abc was cancelled", we need to
 * know which transaction to refund — and Nylas's own metadata is *not* queryable after the fact, so
 * there is no way to ask it later. The mapping has to be ours.
 *
 * Deliberately one table and no migration framework. A single mapping does not justify the
 * machinery, and an idempotent CREATE TABLE IF NOT EXISTS run at startup is easier to reason about
 * than a migration directory nobody remembers to run.
 *
 * The app runs fine without a database — local development has no Postgres — so every function
 * checks availability rather than assuming a pool exists. Callers surface that as a 503 rather than
 * silently losing a booking, the same way the webhook handler treats a missing signing secret.
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

// Render terminates TLS on its own network and presents a certificate the default trust store does
// not recognise. Verification is disabled only when talking to Render's internal hostname.
const sslConfig = () =>
  DATABASE_URL && /render\.com/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined;

let pool = null;

const isAvailable = () => Boolean(DATABASE_URL);

const getPool = () => {
  if (!isAvailable()) return null;
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL, ssl: sslConfig(), max: 5 });
    // A pool that emits an unhandled 'error' takes the process down. Postgres drops idle clients
    // routinely, so this must be handled rather than left to crash the server.
    pool.on('error', err => console.error('[nylas-db] idle client error:', err.message));
  }
  return pool;
};

const query = async (text, params) => {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL is not configured');
  return p.query(text, params);
};

/** Create the table if it is missing. Safe to run on every boot. */
const initSchema = async () => {
  if (!isAvailable()) {
    console.error('[nylas-db] DATABASE_URL is not set; booking mappings cannot be stored.');
    return false;
  }
  await query(`
    CREATE TABLE IF NOT EXISTS nylas_bookings (
      nylas_booking_id          text PRIMARY KEY,
      sharetribe_transaction_id text NOT NULL,
      nylas_grant_id            text NOT NULL,
      booking_start             timestamptz,
      status                    text NOT NULL,
      created_at                timestamptz NOT NULL DEFAULT now(),
      updated_at                timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Added after the table already existed in a live database - CREATE TABLE IF NOT EXISTS above
  // does nothing for an existing table, so the column needs its own idempotent statement. Needed
  // once a reschedule became something this table has to represent: a booking's displayed period
  // is authoritative here, not on Sharetribe's immutable transaction record, so both ends matter.
  await query(`ALTER TABLE nylas_bookings ADD COLUMN IF NOT EXISTS booking_end timestamptz`);
  // Both directions are needed: booking id from a webhook, transaction id when reconciling from
  // the Sharetribe side. The primary key covers the first, this covers the second.
  await query(
    `CREATE INDEX IF NOT EXISTS nylas_bookings_transaction_idx
       ON nylas_bookings (sharetribe_transaction_id)`
  );
  // One row per paid transaction whose calendar booking is being made. See bookingRecovery.js.
  await query(`
    CREATE TABLE IF NOT EXISTS nylas_booking_attempts (
      sharetribe_transaction_id text PRIMARY KEY,
      status                    text NOT NULL DEFAULT 'pending',
      attempts                  integer NOT NULL DEFAULT 0,
      last_error                text,
      locked_until              timestamptz NOT NULL DEFAULT now(),
      created_at                timestamptz NOT NULL DEFAULT now(),
      updated_at                timestamptz NOT NULL DEFAULT now()
    )
  `);
  // The Nylas calendar event each booking created. Nylas returns it only when the booking is made
  // (`event_id`), never in the booking.created webhook, and it is what a calendar notification (the
  // coach deleting the event) names. A separate table, so it can be written before or after the
  // webhook records the booking itself, in either order.
  await query(`
    CREATE TABLE IF NOT EXISTS nylas_booking_events (
      nylas_booking_id text PRIMARY KEY,
      nylas_event_id   text NOT NULL,
      nylas_grant_id   text NOT NULL,
      updated_at       timestamptz NOT NULL DEFAULT now()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS nylas_booking_events_event_idx
       ON nylas_booking_events (nylas_grant_id, nylas_event_id)`
  );
  // A calendar deletion waits here before it cancels anything (see calendarEventSync.js): in the
  // database, not in a timer, so a restart or deploy during the wait loses nothing.
  await query(`
    CREATE TABLE IF NOT EXISTS nylas_event_cancellations (
      nylas_booking_id text PRIMARY KEY,
      nylas_event_id   text NOT NULL,
      nylas_grant_id   text NOT NULL,
      calendar_id      text,
      status           text NOT NULL DEFAULT 'pending',
      due_at           timestamptz NOT NULL,
      locked_until     timestamptz NOT NULL DEFAULT now(),
      attempts         integer NOT NULL DEFAULT 0,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    )
  `);
  return true;
};

/**
 * Try to become the only worker handling this transaction's booking.
 *
 * A single INSERT ... ON CONFLICT DO UPDATE ... WHERE statement, so Postgres decides the winner
 * atomically: it returns a row only if this call inserted the row or took over an expired lock on
 * a still-pending one. Anything else (a live lock held by another worker, or a transaction already
 * booked/declined) returns no row. That is what stops the browser's call and the sweeper from both
 * creating a booking, or one of them declining while the other is mid-attempt.
 *
 * The lock expires by itself, so a worker that dies mid-attempt does not strand the transaction.
 *
 * @returns {Promise<object|null>} the attempt row if the lock was won, otherwise null
 */
const claimBookingAttempt = async (sharetribeTransactionId, lockSeconds = 90) => {
  const { rows } = await query(
    `INSERT INTO nylas_booking_attempts (sharetribe_transaction_id, status, locked_until)
     VALUES ($1, 'pending', now() + $2::int * interval '1 second')
     ON CONFLICT (sharetribe_transaction_id) DO UPDATE
       SET locked_until = now() + $2::int * interval '1 second',
           updated_at   = now()
       WHERE nylas_booking_attempts.status = 'pending'
         AND nylas_booking_attempts.locked_until < now()
     RETURNING *`,
    [sharetribeTransactionId, Math.round(lockSeconds)]
  );
  return rows[0] || null;
};

const getBookingAttempt = async sharetribeTransactionId => {
  const { rows } = await query(
    `SELECT * FROM nylas_booking_attempts WHERE sharetribe_transaction_id = $1`,
    [sharetribeTransactionId]
  );
  return rows[0] || null;
};

/** Count one more try at creating the booking, and remember why the last one failed. */
const recordAttemptFailure = async (sharetribeTransactionId, lastError) => {
  const { rows } = await query(
    `UPDATE nylas_booking_attempts
        SET attempts = attempts + 1, last_error = $2, updated_at = now()
      WHERE sharetribe_transaction_id = $1
      RETURNING *`,
    [sharetribeTransactionId, String(lastError || '').slice(0, 500)]
  );
  return rows[0] || null;
};

/**
 * Finish with a terminal status ('booked' or 'declined'), or release a still-pending attempt for
 * the sweeper to pick up again after `retryInSeconds`.
 */
const finishBookingAttempt = async (sharetribeTransactionId, status, retryInSeconds = 0) => {
  const { rows } = await query(
    `UPDATE nylas_booking_attempts
        SET status = $2,
            locked_until = now() + $3::int * interval '1 second',
            updated_at = now()
      WHERE sharetribe_transaction_id = $1
      RETURNING *`,
    [sharetribeTransactionId, status, Math.round(retryInSeconds)]
  );
  return rows[0] || null;
};

/**
 * Record or update a booking mapping.
 *
 * Upserts on the Nylas booking id, because webhooks can be delivered more than once and a repeated
 * booking.created must not fail on a duplicate key.
 */
const recordBooking = async ({
  nylasBookingId,
  sharetribeTransactionId,
  nylasGrantId,
  bookingStart,
  bookingEnd,
  status,
}) => {
  const { rows } = await query(
    `INSERT INTO nylas_bookings
       (nylas_booking_id, sharetribe_transaction_id, nylas_grant_id, booking_start, booking_end, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (nylas_booking_id) DO UPDATE
       SET sharetribe_transaction_id = EXCLUDED.sharetribe_transaction_id,
           nylas_grant_id            = EXCLUDED.nylas_grant_id,
           booking_start             = EXCLUDED.booking_start,
           booking_end               = EXCLUDED.booking_end,
           status                    = EXCLUDED.status,
           updated_at                = now()
     RETURNING *`,
    [
      nylasBookingId,
      sharetribeTransactionId,
      nylasGrantId,
      bookingStart || null,
      bookingEnd || null,
      status,
    ]
  );
  return rows[0];
};

/** The lookup the webhook handler needs: Nylas booking id → Sharetribe transaction. */
const findByBookingId = async nylasBookingId => {
  const { rows } = await query(`SELECT * FROM nylas_bookings WHERE nylas_booking_id = $1`, [
    nylasBookingId,
  ]);
  return rows[0] || null;
};

/** The reverse, for reconciling or debugging from the Sharetribe side. */
const findByTransactionId = async sharetribeTransactionId => {
  const { rows } = await query(
    `SELECT * FROM nylas_bookings WHERE sharetribe_transaction_id = $1 ORDER BY created_at DESC`,
    [sharetribeTransactionId]
  );
  return rows;
};

/** Remember which calendar event a booking created. Safe to repeat. */
const recordBookingEvent = async ({ nylasBookingId, nylasEventId, nylasGrantId }) => {
  const { rows } = await query(
    `INSERT INTO nylas_booking_events (nylas_booking_id, nylas_event_id, nylas_grant_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (nylas_booking_id) DO UPDATE
       SET nylas_event_id = EXCLUDED.nylas_event_id,
           nylas_grant_id = EXCLUDED.nylas_grant_id,
           updated_at     = now()
     RETURNING *`,
    [nylasBookingId, nylasEventId, nylasGrantId]
  );
  return rows[0];
};

/**
 * The booking a calendar event belongs to, matched on the grant and event ids we stored when the
 * booking was made. Null for any event that is not a Revie booking, which is almost all of them.
 */
const findBookingByEvent = async (nylasGrantId, nylasEventId) => {
  const { rows } = await query(
    `SELECT b.* FROM nylas_booking_events e
       JOIN nylas_bookings b ON b.nylas_booking_id = e.nylas_booking_id
      WHERE e.nylas_grant_id = $1 AND e.nylas_event_id = $2`,
    [nylasGrantId, nylasEventId]
  );
  return rows[0] || null;
};

/** Active, upcoming bookings with no stored event id (made before this existed, or its call failed). */
const findBookingsMissingEvent = async (limit = 10) => {
  const { rows } = await query(
    `SELECT b.* FROM nylas_bookings b
       LEFT JOIN nylas_booking_events e ON e.nylas_booking_id = b.nylas_booking_id
      WHERE e.nylas_booking_id IS NULL
        AND b.status IN ('created', 'rescheduled')
        AND (b.booking_start IS NULL OR b.booking_start > now())
      ORDER BY b.created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
};

/**
 * Sessions still to happen on a grant: booked (or rescheduled) and starting in the future. Used when
 * a coach connects a different calendar, to say which sessions stay on the old one.
 */
const findUpcomingByGrantId = async nylasGrantId => {
  const { rows } = await query(
    `SELECT sharetribe_transaction_id, booking_start FROM nylas_bookings
      WHERE nylas_grant_id = $1 AND status IN ('created', 'rescheduled') AND booking_start > now()
      ORDER BY booking_start`,
    [nylasGrantId]
  );
  return rows;
};

const setStatus = async (nylasBookingId, status) => {
  const { rows } = await query(
    `UPDATE nylas_bookings SET status = $2, updated_at = now()
      WHERE nylas_booking_id = $1 RETURNING *`,
    [nylasBookingId, status]
  );
  return rows[0] || null;
};

/**
 * Note that a booking's calendar event has been deleted, to be acted on after `delayMinutes`.
 *
 * A second notice for a booking that is already waiting does not move the time. One for a booking
 * whose earlier wait ended (the coach restored the event, then deleted it again) starts a new wait.
 *
 * @returns {Promise<boolean>} true if a wait was started, false if one was already running
 */
const scheduleEventCancellation = async ({
  nylasBookingId,
  nylasEventId,
  nylasGrantId,
  calendarId,
  delayMinutes,
}) => {
  const { rows } = await query(
    `INSERT INTO nylas_event_cancellations
       (nylas_booking_id, nylas_event_id, nylas_grant_id, calendar_id, due_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)
     ON CONFLICT (nylas_booking_id) DO UPDATE
       SET status = 'pending',
           nylas_event_id = EXCLUDED.nylas_event_id,
           nylas_grant_id = EXCLUDED.nylas_grant_id,
           calendar_id = EXCLUDED.calendar_id,
           due_at = EXCLUDED.due_at,
           locked_until = now(),
           attempts = 0,
           updated_at = now()
       WHERE nylas_event_cancellations.status <> 'pending'
     RETURNING nylas_booking_id`,
    [nylasBookingId, nylasEventId, nylasGrantId, calendarId || null, String(delayMinutes)]
  );
  return rows.length > 0;
};

/** The coach put the event back while the wait was running. @returns the waiting row, or null. */
const markEventRestored = async nylasBookingId => {
  const { rows } = await query(
    `UPDATE nylas_event_cancellations SET status = 'restored', updated_at = now()
      WHERE nylas_booking_id = $1 AND status = 'pending' RETURNING *`,
    [nylasBookingId]
  );
  return rows[0] || null;
};

/**
 * Take the waits whose time has come, locking them so two workers never act on the same one. A
 * worker that dies leaves its lock to expire by itself.
 */
const claimDueEventCancellations = async (limit = 10, lockSeconds = 120) => {
  const { rows } = await query(
    `UPDATE nylas_event_cancellations
        SET locked_until = now() + ($2 || ' seconds')::interval,
            attempts = attempts + 1,
            updated_at = now()
      WHERE nylas_booking_id IN (
        SELECT nylas_booking_id FROM nylas_event_cancellations
         WHERE status = 'pending' AND due_at <= now() AND locked_until <= now()
         ORDER BY due_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [limit, String(lockSeconds)]
  );
  return rows;
};

/** End a wait: 'done' (cancelled), 'restored' (event was back) or 'ignored' (nothing left to do). */
const finishEventCancellation = async (nylasBookingId, status) => {
  const { rows } = await query(
    `UPDATE nylas_event_cancellations SET status = $2, updated_at = now()
      WHERE nylas_booking_id = $1 RETURNING *`,
    [nylasBookingId, status]
  );
  return rows[0] || null;
};

/** Try again later (a failure), leaving the wait pending. */
const retryEventCancellation = async (nylasBookingId, retryInSeconds) => {
  await query(
    `UPDATE nylas_event_cancellations
        SET locked_until = now() + ($2 || ' seconds')::interval, updated_at = now()
      WHERE nylas_booking_id = $1 AND status = 'pending'`,
    [nylasBookingId, String(retryInSeconds)]
  );
};

/**
 * Run `fn` only if nobody else holds the named lock, using a Postgres session advisory lock.
 *
 * Used to stop the reconcile loop, the Calendar page's sync and the Nylas callback from syncing the
 * same coach at once (two would each create Nylas configurations for the same listing). The lock is
 * held by one pooled connection for the duration of `fn` and released with it; if the process dies
 * Postgres releases it when the connection drops. With no database (local development) there is
 * nothing to coordinate with, so `fn` simply runs.
 *
 * @returns {Promise<{locked: boolean, value?: any}>} `locked: false` means someone else has it
 */
const withAdvisoryLock = async (key, fn) => {
  const p = getPool();
  if (!p) return { locked: true, value: await fn() };

  const client = await p.connect();
  let discard = false;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS got', [key]);
    if (!rows[0].got) return { locked: false };
    try {
      return { locked: true, value: await fn() };
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      } catch (e) {
        // A connection that could not unlock must not go back in the pool still holding the lock.
        discard = true;
      }
    }
  } finally {
    client.release(discard);
  }
};

/** Close the pool. Used by tests; production keeps it open for the process lifetime. */
const close = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = {
  isAvailable,
  initSchema,
  recordBooking,
  findByBookingId,
  findByTransactionId,
  findUpcomingByGrantId,
  recordBookingEvent,
  findBookingByEvent,
  findBookingsMissingEvent,
  withAdvisoryLock,
  scheduleEventCancellation,
  markEventRestored,
  claimDueEventCancellations,
  finishEventCancellation,
  retryEventCancellation,
  setStatus,
  claimBookingAttempt,
  getBookingAttempt,
  recordAttemptFailure,
  finishBookingAttempt,
  close,
  query,
};
