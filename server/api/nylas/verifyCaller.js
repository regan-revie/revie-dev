/**
 * Is the logged-in caller the customer who paid for this transaction?
 *
 * create-booking lets a browser trigger a calendar booking, so it must be refused for anyone but
 * the paying customer. The check is strict, but it must not mistake "we could not see the customer"
 * for "this is not the customer": that is what refused every real customer for two weeks, because a
 * Marketplace API transaction only carries the customer reference when `include: ['customer']` is
 * asked for. The relationship is now included, and if it is somehow still absent the caller's own
 * orders (fetched with their own session, which Sharetribe scopes to them) settle it.
 *
 * @param {object} params
 * @param {object} params.sdk a request-scoped Marketplace SDK instance
 * @param {string} params.transactionId
 * @param {string|null} params.customerId from the transaction's relationships, if present
 * @param {string} params.callerId the logged-in user's id
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
const verifyCaller = async ({ sdk, transactionId, customerId, callerId }) => {
  if (customerId) {
    return customerId === callerId ? { ok: true } : { ok: false, reason: 'not-the-customer' };
  }

  // The customer relationship was missing. Ask Sharetribe whether this is one of the caller's own
  // orders; it only ever returns orders the caller placed.
  const response = await sdk.transactions.query({
    only: 'order',
    lastTransitions: ['transition/confirm-payment'],
    perPage: 100,
  });
  const owns = (response.data.data || []).some(tx => tx.id.uuid === transactionId);
  return owns ? { ok: true } : { ok: false, reason: 'customer-unknown-and-not-in-callers-orders' };
};

module.exports = { verifyCaller };
