/**
 * Parsing for scripts/promo-codes.js, kept out of the script so it can be tested.
 */

const moment = require('moment-timezone');
const { MAX_PERCENT_OFF, normaliseCode, isWellFormedCode } = require('./rules');

const flagValue = (args, name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const positiveInt = (value, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a whole number above 0`);
  return n;
};

/**
 * `create CODE --percent 15 [--expires "2027-02-01 00:00" --tz America/Los_Angeles]
 *   [--max-uses 50] [--per-customer 1] [--first-session-only]`
 *
 * A time with no offset needs --tz, so "midnight" is never silently the server's midnight.
 *
 * @returns {{code, percentOff, expiresAt: Date|null, maxTotalUses: number|null,
 *   maxUsesPerCustomer: number, firstSessionOnly: boolean}}
 */
const parseCreateArgs = args => {
  const code = normaliseCode(args[0] && !args[0].startsWith('--') ? args[0] : '');
  if (!isWellFormedCode(code)) {
    throw new Error('The code must be 3 to 32 letters, digits, dashes or underscores.');
  }

  const percentOff = Number(flagValue(args, '--percent'));
  if (!Number.isFinite(percentOff) || percentOff <= 0) {
    throw new Error('--percent is required, for example --percent 15');
  }
  if (percentOff > MAX_PERCENT_OFF) {
    throw new Error(
      `--percent ${percentOff} is above the ${MAX_PERCENT_OFF}% ceiling. The discount comes out of Revie's commission, and Stripe's fee comes out of what is left.`
    );
  }

  const expires = flagValue(args, '--expires');
  const tz = flagValue(args, '--tz');
  let expiresAt = null;
  if (expires) {
    const hasOffset = /(Z|[+-]\d\d:?\d\d)$/.test(expires.trim());
    if (!hasOffset && !tz) {
      throw new Error('--expires needs --tz (for example --tz America/Los_Angeles) or an offset.');
    }
    const parsed = hasOffset
      ? moment.parseZone(expires)
      : moment.tz(expires, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD'], true, tz);
    if (!parsed.isValid()) {
      throw new Error(`Could not read --expires "${expires}" (use YYYY-MM-DD HH:mm).`);
    }
    expiresAt = parsed.toDate();
  }

  const maxUses = flagValue(args, '--max-uses');
  const perCustomer = flagValue(args, '--per-customer');

  return {
    code,
    percentOff,
    expiresAt,
    maxTotalUses: maxUses === undefined ? null : positiveInt(maxUses, '--max-uses'),
    maxUsesPerCustomer: perCustomer === undefined ? 1 : positiveInt(perCustomer, '--per-customer'),
    firstSessionOnly: args.includes('--first-session-only'),
  };
};

/** One code as a readable line for `list` and `show`. */
const describeCode = row => {
  const expires = row.expires_at ? new Date(row.expires_at).toISOString() : 'never';
  const cap = row.max_total_uses == null ? 'no cap' : `cap ${row.max_total_uses}`;
  return [
    `${row.code}  ${Number(row.percent_off)}% off`,
    row.active ? 'ACTIVE' : 'INACTIVE',
    `expires ${expires}`,
    `${cap}, ${row.max_uses_per_customer} per customer`,
    row.first_session_only ? 'first session only' : 'any session',
    `uses: ${row.paid_count ?? '?'} paid, ${row.reserved_count ?? '?'} reserved (counter says ${
      row.uses_so_far
    })`,
  ].join(' | ');
};

module.exports = { parseCreateArgs, describeCode };
