/**
 * Promo codes and their redemptions, in the same Postgres as the Nylas bookings.
 *
 *   promo_codes        one row per code: percent off, expiry, caps, flags. Created by
 *                      scripts/promo-codes.js (there is no admin screen).
 *   promo_redemptions  one row per booking that used a code, with a status:
 *                        reserved  set aside when the booking is started; counts against the caps
 *                        paid      the booking was accepted (money captured); counts
 *                        released  declined, expired, abandoned or refunded in full; does not count
 *
 * Why reserve rather than count at payment: two clients can both check out with the last use at
 * the same moment. Reserving under a row lock means only one of them gets it. The reservation is
 * released again if the payment never completes, and the reconcile job (reconcile.js) does that.
 */

const db = require('../nylas/db');
const { judgeCode, normaliseCode } = require('./rules');

const initSchema = async () => {
  if (!db.isAvailable()) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      code                    text PRIMARY KEY,
      percent_off             numeric(5,2) NOT NULL CHECK (percent_off > 0 AND percent_off <= 100),
      expires_at              timestamptz,
      max_total_uses          integer CHECK (max_total_uses IS NULL OR max_total_uses > 0),
      uses_so_far             integer NOT NULL DEFAULT 0,
      max_uses_per_customer   integer NOT NULL DEFAULT 1 CHECK (max_uses_per_customer > 0),
      first_session_only      boolean NOT NULL DEFAULT false,
      active                  boolean NOT NULL DEFAULT true,
      created_at              timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id              bigserial PRIMARY KEY,
      code            text NOT NULL REFERENCES promo_codes (code),
      customer_id     text NOT NULL,
      transaction_id  text,
      status          text NOT NULL CHECK (status IN ('reserved', 'paid', 'released')),
      percent_off     numeric(5,2) NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      checked_at      timestamptz
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS promo_redemptions_code_idx ON promo_redemptions (code, status)`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS promo_redemptions_customer_idx ON promo_redemptions (customer_id, status)`
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_transaction_idx
       ON promo_redemptions (transaction_id) WHERE transaction_id IS NOT NULL`
  );
  return true;
};

const findCode = async code => {
  const { rows } = await db.query(`SELECT * FROM promo_codes WHERE code = $1`, [
    normaliseCode(code),
  ]);
  return rows[0] || null;
};

/** Live use counts for one code and one client, through any queryable (pool or client). */
const countLive = async (queryable, code, customerId) => {
  const { rows } = await queryable.query(
    `SELECT
       count(*) FILTER (WHERE r.code = $1)::int AS total,
       count(*) FILTER (WHERE r.code = $1 AND r.customer_id = $2 AND r.status = 'paid')::int AS customer_paid,
       count(*) FILTER (WHERE r.code = $1 AND r.customer_id = $2 AND r.status = 'reserved')::int AS customer_reserved,
       count(*) FILTER (WHERE r.customer_id = $2 AND c.first_session_only)::int AS customer_first_session
     FROM promo_redemptions r
     JOIN promo_codes c ON c.code = r.code
     WHERE r.status IN ('reserved', 'paid') AND (r.code = $1 OR r.customer_id = $2)`,
    [code, customerId]
  );
  const row = rows[0] || {};
  return {
    total: row.total || 0,
    customerPaid: row.customer_paid || 0,
    customerReserved: row.customer_reserved || 0,
    customerFirstSession: row.customer_first_session || 0,
  };
};

/** Judge a code without reserving anything (the checkout's price preview). */
const check = async ({ code, customerId, hasEarlierPaidBooking, commissionPercent, now }) => {
  const promo = await findCode(code);
  if (!promo) return { ok: false, reason: 'invalid' };
  const counts = await countLive(db, promo.code, customerId);
  return judgeCode({ promo, now, counts, hasEarlierPaidBooking, commissionPercent });
};

/**
 * Judge a code and, if it is good, reserve a use for this client, all under one row lock so two
 * clients cannot both take the last use.
 *
 * @returns {Promise<{ok: true, percentOff: number, redemptionId: string} | {ok: false, reason: string}>}
 */
const reserve = async ({ code, customerId, hasEarlierPaidBooking, commissionPercent, now }) => {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE`, [
      normaliseCode(code),
    ]);
    const promo = rows[0] || null;
    const counts = promo ? await countLive(client, promo.code, customerId) : null;
    const verdict = judgeCode({ promo, now, counts, hasEarlierPaidBooking, commissionPercent });
    if (!verdict.ok) {
      await client.query('ROLLBACK');
      return verdict;
    }
    const inserted = await client.query(
      `INSERT INTO promo_redemptions (code, customer_id, status, percent_off)
       VALUES ($1, $2, 'reserved', $3) RETURNING id`,
      [promo.code, customerId, verdict.percentOff]
    );
    await client.query('COMMIT');
    return { ok: true, percentOff: verdict.percentOff, redemptionId: String(inserted.rows[0].id) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => null);
    throw e;
  } finally {
    client.release();
  }
};

const attachTransaction = (redemptionId, transactionId) =>
  db.query(`UPDATE promo_redemptions SET transaction_id = $2, updated_at = now() WHERE id = $1`, [
    redemptionId,
    transactionId,
  ]);

/** reserved -> paid, and the code's counter goes up in the same transaction. Idempotent. */
const markPaid = async redemptionId => {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE promo_redemptions SET status = 'paid', updated_at = now()
       WHERE id = $1 AND status = 'reserved' RETURNING code`,
      [redemptionId]
    );
    if (rows[0]) {
      await client.query(`UPDATE promo_codes SET uses_so_far = uses_so_far + 1 WHERE code = $1`, [
        rows[0].code,
      ]);
    }
    await client.query('COMMIT');
    return Boolean(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => null);
    throw e;
  } finally {
    client.release();
  }
};

/** reserved or paid -> released. A paid use also comes off the code's counter. Idempotent. */
const release = async redemptionId => {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE promo_redemptions r SET status = 'released', updated_at = now()
       FROM promo_redemptions old
       WHERE r.id = $1 AND old.id = r.id AND r.status <> 'released'
       RETURNING r.code, old.status AS was`,
      [redemptionId]
    );
    if (rows[0] && rows[0].was === 'paid') {
      await client.query(
        `UPDATE promo_codes SET uses_so_far = GREATEST(uses_so_far - 1, 0) WHERE code = $1`,
        [rows[0].code]
      );
    }
    await client.query('COMMIT');
    return Boolean(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => null);
    throw e;
  } finally {
    client.release();
  }
};

const touchChecked = redemptionId =>
  db.query(`UPDATE promo_redemptions SET checked_at = now() WHERE id = $1`, [redemptionId]);

/**
 * Redemptions the reconcile job should look at: every reserved one, and paid ones not looked at in
 * the last few minutes (so a later full refund is noticed), newest bookings only.
 */
const findOpenRedemptions = async ({ paidRecheckMs, paidLimit = 20, paidWithinDays = 90 }) => {
  const { rows } = await db.query(
    `(SELECT * FROM promo_redemptions WHERE status = 'reserved' ORDER BY created_at LIMIT 100)
     UNION ALL
     (SELECT * FROM promo_redemptions
        WHERE status = 'paid'
          AND created_at > now() - ($2 || ' days')::interval
          AND (checked_at IS NULL OR checked_at < now() - ($1 || ' milliseconds')::interval)
        ORDER BY checked_at NULLS FIRST LIMIT $3)`,
    [String(paidRecheckMs), String(paidWithinDays), paidLimit]
  );
  return rows;
};

// ---- used by scripts/promo-codes.js ----

const createCode = async ({
  code,
  percentOff,
  expiresAt,
  maxTotalUses,
  maxUsesPerCustomer,
  firstSessionOnly,
}) => {
  const { rows } = await db.query(
    `INSERT INTO promo_codes
       (code, percent_off, expires_at, max_total_uses, max_uses_per_customer, first_session_only)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      normaliseCode(code),
      percentOff,
      expiresAt || null,
      maxTotalUses || null,
      maxUsesPerCustomer || 1,
      Boolean(firstSessionOnly),
    ]
  );
  return rows[0];
};

const setActive = async (code, active) => {
  const { rows } = await db.query(
    `UPDATE promo_codes SET active = $2 WHERE code = $1 RETURNING *`,
    [normaliseCode(code), active]
  );
  return rows[0] || null;
};

/** Every code with its live counts, counted from the redemptions (not trusting the counter). */
const listCodes = async () => {
  const { rows } = await db.query(
    `SELECT c.*,
       count(r.*) FILTER (WHERE r.status = 'paid')::int AS paid_count,
       count(r.*) FILTER (WHERE r.status = 'reserved')::int AS reserved_count,
       count(r.*) FILTER (WHERE r.status = 'released')::int AS released_count
     FROM promo_codes c LEFT JOIN promo_redemptions r ON r.code = c.code
     GROUP BY c.code ORDER BY c.created_at`
  );
  return rows;
};

const listRedemptions = async code => {
  const { rows } = await db.query(
    `SELECT id, status, customer_id, transaction_id, percent_off, created_at, updated_at
     FROM promo_redemptions WHERE code = $1 ORDER BY id`,
    [normaliseCode(code)]
  );
  return rows;
};

module.exports = {
  initSchema,
  findCode,
  check,
  reserve,
  attachTransaction,
  markPaid,
  release,
  touchChecked,
  findOpenRedemptions,
  createCode,
  setActive,
  listCodes,
  listRedemptions,
};
