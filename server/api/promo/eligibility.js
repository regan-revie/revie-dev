/**
 * "Is this the client's first session?" for first-session-only codes.
 *
 * The answer comes from Sharetribe, the one place that knows every booking the client has ever made
 * (including those from before promo codes existed), and it is read with the CLIENT'S OWN session,
 * so it can only ever look at their own orders and cannot be pointed at anyone else.
 *
 * A booking counts as an earlier paid booking when the client's card was charged for it and the
 * money was not all given back:
 *   - it reached `confirm-payment` (the payment went through), and
 *   - it has none of cancel (full refund), operator-decline / decline (refund, never confirmed) or
 *     expire (refund, never confirmed).
 * A session the client cancelled late (they keep paying) counts. One refunded in full does not: they
 * never had a session. A booking that never got past payment (abandoned, expired payment) does not.
 */

const PAID = 'transition/confirm-payment';
const REFUNDED_IN_FULL = [
  'transition/cancel',
  'transition/operator-decline',
  'transition/decline',
  'transition/expire',
];

const MAX_PAGES = 10;

/** Whether one transaction's transition history makes it an earlier paid booking. */
const isKeptPaidBooking = transitions => {
  const names = (transitions || []).map(t => t.transition);
  return names.includes(PAID) && !names.some(n => REFUNDED_IN_FULL.includes(n));
};

/**
 * @param {object} sdk the logged-in client's Marketplace SDK
 * @param {object} [opts]
 * @param {string} [opts.excludeTransactionId] a transaction to ignore (the one being created)
 * @returns {Promise<boolean>}
 */
const hasEarlierPaidBooking = async (sdk, { excludeTransactionId } = {}) => {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await sdk.transactions.query({ only: 'order', perPage: 100, page });
    const found = (response.data.data || []).some(
      tx => tx.id.uuid !== excludeTransactionId && isKeptPaidBooking(tx.attributes.transitions)
    );
    if (found) return true;
    const totalPages = response.data.meta ? response.data.meta.totalPages : 1;
    if (page >= totalPages) return false;
  }
  // More orders than we are willing to page through: err towards "has booked before".
  return true;
};

module.exports = { hasEarlierPaidBooking, isKeptPaidBooking };
