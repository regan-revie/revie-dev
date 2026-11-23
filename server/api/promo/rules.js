/**
 * Revie-funded promo codes: the rules, kept pure (no I/O) so they can be tested exhaustively.
 *
 * A code takes a percentage off what the CLIENT pays. The coach is always paid on the full price,
 * so the discount comes out of Revie's commission and nowhere else (see server/api-util/lineItems.js,
 * where it is a customer-only line item). That is why a code can never be worth more than the
 * commission, and why Revie holds it lower still: Stripe's fee also comes out of what Revie keeps.
 */

/** The most a code may take off, whatever the database says. Refused at checkout and by the script. */
const MAX_PERCENT_OFF = 15;

/** Failed guesses a client may make in WINDOW before being asked to wait. Applied per user. */
const MAX_FAILED_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/** Why a code was refused. The checkout page has its own wording for each (en.json, CheckoutPage.promo*). */
const REASONS = [
  'invalid',
  'expired',
  'used-up',
  'first-session-only',
  'already-used',
  'in-progress',
  'too-many-attempts',
  'unavailable',
  'not-supported',
];

/**
 * A code as typed: surrounding spaces ignored, case ignored. Empty means "no code".
 * @returns {string} upper case, or '' for nothing
 */
const normaliseCode = raw =>
  (typeof raw === 'string' ? raw.trim().replace(/\s+/g, '') : '').toUpperCase();

/** Codes are letters, digits, dash and underscore, 3 to 32 long. Anything else cannot exist. */
const isWellFormedCode = code => /^[A-Z0-9_-]{3,32}$/.test(code);

/** Percent off as a number (Postgres hands back numerics as strings). */
const percentOf = promo => Number(promo?.percent_off);

/**
 * Whether a percentage is allowed at all: above zero, within Revie's ceiling, and not above the
 * commission it is paid out of.
 */
const isAllowedPercent = (percent, commissionPercent) =>
  Number.isFinite(percent) &&
  percent > 0 &&
  percent <= MAX_PERCENT_OFF &&
  (commissionPercent == null || percent <= commissionPercent);

/**
 * Judge a code for one client.
 *
 * @param {object} p
 * @param {object|null} p.promo the promo_codes row, or null
 * @param {number} p.now epoch milliseconds
 * @param {{total: number, customerPaid: number, customerReserved: number, customerFirstSession: number}} p.counts
 *   live use counts. `total` = reserved + paid across everyone; `customerPaid` and
 *   `customerReserved` are this client's own; `customerFirstSession` is this client's live uses of
 *   any first-session-only code.
 * @param {boolean} p.hasEarlierPaidBooking the client has booked and kept a session before
 * @param {number} [p.commissionPercent] the provider commission, for the ceiling
 * @returns {{ok: true, percentOff: number} | {ok: false, reason: string}}
 */
const judgeCode = ({ promo, now, counts, hasEarlierPaidBooking, commissionPercent }) => {
  if (!promo || !promo.active) return { ok: false, reason: 'invalid' };

  const percentOff = percentOf(promo);
  // A row that breaks the ceiling (typed straight into the database, say) is treated as not existing.
  if (!isAllowedPercent(percentOff, commissionPercent)) return { ok: false, reason: 'invalid' };

  if (promo.expires_at && new Date(promo.expires_at).getTime() <= now) {
    return { ok: false, reason: 'expired' };
  }

  if (promo.max_total_uses != null && counts.total >= promo.max_total_uses) {
    return { ok: false, reason: 'used-up' };
  }

  const perCustomer = promo.max_uses_per_customer == null ? 1 : promo.max_uses_per_customer;
  if (counts.customerPaid + counts.customerReserved >= perCustomer) {
    // Only an unfinished booking is in the way: it frees itself within 15 minutes.
    return { ok: false, reason: counts.customerPaid > 0 ? 'already-used' : 'in-progress' };
  }

  if (promo.first_session_only && (hasEarlierPaidBooking || counts.customerFirstSession > 0)) {
    return { ok: false, reason: 'first-session-only' };
  }

  return { ok: true, percentOff };
};

/** The error the API throws for a refused code. `handleError` passes status/statusText/data on. */
const promoError = (reason, status = 400) => {
  const code = `promo-${reason}`;
  const error = new Error(code);
  error.status = status;
  error.statusText = code;
  error.data = { errors: [{ status, code, title: code }] };
  return error;
};

module.exports = {
  MAX_PERCENT_OFF,
  MAX_FAILED_ATTEMPTS,
  ATTEMPT_WINDOW_MS,
  REASONS,
  normaliseCode,
  isWellFormedCode,
  percentOf,
  isAllowedPercent,
  judgeCode,
  promoError,
};
