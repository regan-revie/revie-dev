/**
 * Turn a typed code into a discount for one booking, or a refusal with a reason.
 *
 * Used twice per checkout: for the price preview (speculative, reserves nothing) and for the real
 * booking (reserves a use). Everything that decides whether the code is good happens here, on the
 * server; the browser only ever sends the text the client typed.
 */

const db = require('../nylas/db');
const store = require('./store');
const attempts = require('./attemptLimit');
const { hasEarlierPaidBooking } = require('./eligibility');
const { normaliseCode, isWellFormedCode, promoError } = require('./rules');

/**
 * @param {object} p
 * @param {object} p.sdk the logged-in client's Marketplace SDK
 * @param {string} p.customerId the client's user id (from `currentUser.show`, never from the request)
 * @param {string} p.rawCode what was typed
 * @param {number} [p.commissionPercent] the provider commission
 * @param {boolean} p.reserve true for the real booking, false for a price preview
 * @param {number} [p.now]
 * @returns {Promise<null | {code: string, percentOff: number, redemptionId?: string}>} null when no code was given
 * @throws an error carrying `promo-<reason>` (see rules.promoError) when the code is refused
 */
const resolvePromo = async ({
  sdk,
  customerId,
  rawCode,
  commissionPercent,
  reserve,
  now = Date.now(),
}) => {
  if (rawCode == null || rawCode === '') return null;
  // One code per booking: anything other than a single piece of text is not a code.
  if (typeof rawCode !== 'string') throw promoError('invalid');

  const code = normaliseCode(rawCode);
  if (!code) return null;

  if (attempts.isLimited(customerId, now)) throw promoError('too-many-attempts', 429);
  if (!isWellFormedCode(code)) {
    attempts.recordFailure(customerId, now);
    throw promoError('invalid');
  }
  if (!db.isAvailable()) throw promoError('unavailable', 503);

  let verdict;
  try {
    const promo = await store.findCode(code);
    // The Sharetribe look-up is only made when it matters, and never for a code that does not exist.
    const earlier =
      promo && promo.first_session_only
        ? await hasEarlierPaidBooking(sdk).catch(() => true)
        : false;
    const args = { code, customerId, hasEarlierPaidBooking: earlier, commissionPercent, now };
    verdict = promo
      ? await (reserve ? store.reserve(args) : store.check(args))
      : { ok: false, reason: 'invalid' };
  } catch (e) {
    console.error(`[promo] could not check a code: ${e.message}`); // eslint-disable-line no-console
    throw promoError('unavailable', 503);
  }

  if (!verdict.ok) {
    // Only a code that does not exist (or is switched off) counts as a guess.
    if (verdict.reason === 'invalid') attempts.recordFailure(customerId, now);
    throw promoError(verdict.reason);
  }
  return { code, percentOff: verdict.percentOff, redemptionId: verdict.redemptionId };
};

module.exports = { resolvePromo };
