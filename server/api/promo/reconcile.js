/**
 * Keeps promo redemptions in step with what happened to their bookings, so a use is counted only
 * for a booking that was really paid, and given back when it was not or when the client was
 * refunded in full.
 *
 *   reserved + booking accepted                         -> paid
 *   reserved + payment expired / declined / expired     -> released
 *   reserved + no booking was ever created (30 min old) -> released
 *   paid     + cancelled with a full refund             -> released
 *   paid     + late-cancelled                           -> stays paid (the client was charged)
 *
 * A loop over Sharetribe's state rather than reacting to each transition, like the other jobs here:
 * it cannot miss a change, and a missed tick (a deploy) only delays it. Paid rows are looked at
 * again every few minutes for the first 90 days, which is how a later full refund is noticed.
 */

const log = require('../../log');
const db = require('../nylas/db');
const integration = require('../nylas/integration');
const store = require('./store');

const PAID_RECHECK_MS = 5 * 60 * 1000;
const DANGLING_AFTER_MS = 30 * 60 * 1000;

const ACCEPTED = ['transition/operator-accept', 'transition/accept'];
const NEVER_CONFIRMED = [
  'transition/expire-payment',
  'transition/operator-decline',
  'transition/decline',
  'transition/expire',
];

/**
 * What should happen to a redemption, given its booking's transition history. Pure.
 * @returns {'pay' | 'release' | 'keep'}
 */
const decide = ({ status, transitions }) => {
  const names = (transitions || []).map(t => t.transition);
  if (status === 'reserved') {
    if (names.some(n => ACCEPTED.includes(n))) return 'pay';
    if (names.some(n => NEVER_CONFIRMED.includes(n))) return 'release';
    return 'keep';
  }
  if (status === 'paid') {
    return names.includes('transition/cancel') ? 'release' : 'keep';
  }
  return 'keep';
};

const runPromoReconcile = async ({ now = Date.now() } = {}) => {
  const sdk = integration.getIntegrationSdk();
  if (!sdk || !db.isAvailable()) return { skipped: true };

  const rows = await store.findOpenRedemptions({ paidRecheckMs: PAID_RECHECK_MS });
  const summary = { checked: rows.length, paid: 0, released: 0, failed: 0 };

  for (const row of rows) {
    try {
      if (!row.transaction_id) {
        // A reservation whose booking was never created (the request died between the two).
        if (
          row.status === 'reserved' &&
          now - new Date(row.created_at).getTime() > DANGLING_AFTER_MS
        ) {
          // eslint-disable-next-line no-await-in-loop
          await store.release(row.id);
          summary.released += 1;
        }
        // eslint-disable-next-line no-continue
        continue;
      }

      let transitions;
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await sdk.transactions.show({ id: row.transaction_id });
        transitions = response.data.data.attributes.transitions;
      } catch (e) {
        if (e.status === 404 && row.status === 'reserved') {
          // eslint-disable-next-line no-await-in-loop
          await store.release(row.id);
          summary.released += 1;
          // eslint-disable-next-line no-continue
          continue;
        }
        throw e;
      }

      const action = decide({ status: row.status, transitions });
      if (action === 'pay') {
        // eslint-disable-next-line no-await-in-loop
        if (await store.markPaid(row.id)) summary.paid += 1;
      } else if (action === 'release') {
        // eslint-disable-next-line no-await-in-loop
        if (await store.release(row.id)) summary.released += 1;
      } else if (row.status === 'paid') {
        // eslint-disable-next-line no-await-in-loop
        await store.touchChecked(row.id);
      }
    } catch (e) {
      summary.failed += 1;
      log.error(e, 'promo-reconcile-failed', { redemptionId: String(row.id) });
    }
  }
  return summary;
};

module.exports = { runPromoReconcile, decide };
