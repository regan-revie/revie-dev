/**
 * Sharetribe Integration API client.
 *
 * Distinct from the Marketplace SDK in `server/api-util/sdk.js`, and needed for one specific
 * reason: `getTrustedSdk` works by exchanging the *logged-in user's* cookie token, so it can only
 * act on behalf of somebody with a live browser session. A Nylas webhook has no user attached, so
 * confirming a booking from one requires credentials that authenticate the application itself.
 *
 * These are separate credentials from the Marketplace API ones: an Integration API application must
 * be created in Sharetribe Console, and its client id and secret set as
 * SHARETRIBE_INTEGRATION_CLIENT_ID and SHARETRIBE_INTEGRATION_CLIENT_SECRET.
 *
 * This client can act as the operator on any transaction, so it is deliberately confined to
 * server/api/nylas/ and never reachable from anything a browser can call.
 */

const integrationSdk = require('sharetribe-flex-integration-sdk');

const CLIENT_ID = process.env.SHARETRIBE_INTEGRATION_CLIENT_ID;
const CLIENT_SECRET = process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET;

let instance = null;

const isConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

/**
 * The shared Integration SDK instance, or null when credentials are absent.
 *
 * Returns null rather than throwing so callers can decide: the webhook handler turns it into a 503
 * and processes nothing, which is safer than half-completing a booking.
 */
const getIntegrationSdk = () => {
  if (!isConfigured()) return null;
  if (!instance) {
    instance = integrationSdk.createInstance({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
  }
  return instance;
};

/**
 * Move a transaction with an operator transition.
 *
 * Sharetribe's state machine rejects a transition from a state the transaction has already left,
 * which is what makes redelivered webhooks safe without any de-duplication of our own. That
 * rejection is a normal outcome rather than a fault, so it is reported distinctly from a real
 * failure.
 *
 * @param {string} transactionId
 * @param {string} transition e.g. 'transition/operator-accept'
 * @param {object} [params]
 * @returns {Promise<{ok: boolean, alreadyApplied?: boolean, transaction?: object, error?: Error}>}
 */
const applyTransition = async (transactionId, transition, params = {}) => {
  const sdk = getIntegrationSdk();
  if (!sdk) {
    return { ok: false, error: new Error('Integration API credentials are not configured') };
  }

  try {
    const response = await sdk.transactions.transition({
      id: transactionId,
      transition,
      params,
    });
    return { ok: true, transaction: response.data.data };
  } catch (e) {
    const status = e.status || (e.data && e.data.errors && e.data.errors[0]?.status);
    // 409 is Sharetribe refusing a transition that is not valid from the current state - normally
    // because this webhook has already been processed. Not an error worth alerting on.
    if (status === 409) {
      return { ok: false, alreadyApplied: true };
    }
    return { ok: false, error: e };
  }
};

/**
 * Merge keys into a transaction's `metadata` (the operator-written, party-readable bag that shows in
 * Console and is returned to both parties by the Marketplace API). Existing keys not named here are
 * kept; a key set to null is removed.
 *
 * @param {string} transactionId
 * @param {object} metadata
 * @returns {Promise<{ok: boolean, error?: Error}>}
 */
const updateTransactionMetadata = async (transactionId, metadata) => {
  const sdk = getIntegrationSdk();
  if (!sdk)
    return { ok: false, error: new Error('Integration API credentials are not configured') };
  try {
    await sdk.transactions.updateMetadata({ id: transactionId, metadata });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
};

/**
 * A transaction's `metadata` and `lastTransition`, read as the operator. Metadata is an empty object
 * when there is none.
 */
const getTransactionBasics = async transactionId => {
  const sdk = getIntegrationSdk();
  if (!sdk) throw new Error('Integration API credentials are not configured');
  const response = await sdk.transactions.show({ id: transactionId });
  const attributes = response.data.data.attributes || {};
  return { metadata: attributes.metadata || {}, lastTransition: attributes.lastTransition };
};

/**
 * Load a transaction with its listing, booking and customer, as the operator.
 *
 * The payment-failure recovery runs from the browser's call and from a timer with no user at all,
 * so unlike manageBookingShared.loadCalendarBookingTransaction it cannot use a customer's session.
 * Returns the same {tx, listing, booking} shape, plus the customer and the provider (the coach, whose
 * Nylas grant the calendar event lives under).
 *
 * @param {string} transactionId
 */
const loadTransactionAsOperator = async transactionId => {
  const sdk = getIntegrationSdk();
  if (!sdk) throw new Error('Integration API credentials are not configured');

  const response = await sdk.transactions.show({
    id: transactionId,
    include: ['listing', 'booking', 'customer', 'provider'],
  });
  const tx = response.data.data;
  const included = response.data.included || [];
  const find = ref =>
    ref ? included.find(i => i.id.uuid === ref.id.uuid && i.type === ref.type) || null : null;

  return {
    tx,
    listing: find(tx.relationships?.listing?.data),
    booking: find(tx.relationships?.booking?.data),
    customer: find(tx.relationships?.customer?.data),
    provider: find(tx.relationships?.provider?.data),
  };
};

/**
 * Transactions whose customer has paid (confirm-payment, i.e. `preauthorized`) but that nothing has
 * accepted or declined yet, and that have been sitting there at least `olderThanMinutes`.
 *
 * The age cut-off is what keeps the sweeper off bookings that are being made right now by the
 * browser's own call (and the order page's one retry, ten seconds in).
 *
 * @returns {Promise<string[]>} transaction ids
 */
const findPaidUnconfirmedTransactions = async ({ olderThanMinutes = 2, maxPages = 5 } = {}) => {
  const sdk = getIntegrationSdk();
  if (!sdk) throw new Error('Integration API credentials are not configured');

  const olderThan = Date.now() - olderThanMinutes * 60 * 1000;
  const ids = [];
  for (let page = 1; page <= maxPages; page += 1) {
    // The age cutoff is applied below, in our own code. The API has a `lastTransitionedAtEnd`
    // parameter in its documentation, but it silently ignores it (checked: the same transactions
    // come back for any value, even a made-up parameter), so passing it gave a sweeper that grabbed
    // every paid booking on its next tick, however new.
    // eslint-disable-next-line no-await-in-loop
    const response = await sdk.transactions.query({
      lastTransitions: ['transition/confirm-payment'],
      processName: 'default-booking',
      perPage: 100,
      page,
    });
    response.data.data.forEach(tx => {
      const at = tx.attributes?.lastTransitionedAt;
      // A transaction we cannot date is left for a later run rather than guessed at.
      if (at && new Date(at).getTime() <= olderThan) ids.push(tx.id.uuid);
    });
    if (page >= (response.data.meta?.totalPages || 1)) break;
  }
  return ids;
};

module.exports = {
  isConfigured,
  getIntegrationSdk,
  applyTransition,
  updateTransactionMetadata,
  getTransactionBasics,
  loadTransactionAsOperator,
  findPaidUnconfirmedTransactions,
};
