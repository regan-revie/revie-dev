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

const setStatus = async (nylasBookingId, status) => {
  const { rows } = await query(
    `UPDATE nylas_bookings SET status = $2, updated_at = now()
      WHERE nylas_booking_id = $1 RETURNING *`,
    [nylasBookingId, status]
  );
  return rows[0] || null;
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
  setStatus,
  claimBookingAttempt,
  getBookingAttempt,
  recordAttemptFailure,
  finishBookingAttempt,
  close,
  query,
};
