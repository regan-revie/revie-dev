/**
 * Finds paid-but-unconfirmed calendar bookings and hands each to the same recovery routine the
 * browser's call uses.
 *
 * Why it exists: the browser is what tells the server to create the Nylas booking right after
 * payment. If the tab is closed first, or the request is lost, nothing else would ever notice, and
 * the client's card stays authorised against a session that is not on the coach's calendar. This
 * catches that. Each run only looks at transactions at least `olderThanMinutes` old, so it stays out
 * of the way of bookings the browser is making right now; the Postgres claim inside ensureBooking()
 * means a transaction is never handled by two workers at once, however the timing falls.
 */

const db = require('../api/nylas/db');
const integration = require('../api/nylas/integration');
const { ensureBooking } = require('../api/nylas/bookingRecovery');
const log = require('../log');

/**
 * @returns {Promise<{skipped?: boolean, checked: number, outcomes: object}>}
 */
const runBookingSweep = async ({ olderThanMinutes = 3 } = {}) => {
  if (!db.isAvailable() || !integration.isConfigured())
    return { skipped: true, checked: 0, outcomes: {} };

  const ids = await integration.findPaidUnconfirmedTransactions({ olderThanMinutes });
  const outcomes = {};

  // One at a time: a single recovery can take ~15 seconds when Nylas is failing, and running a
  // burst in parallel would only hammer a service that is already unhappy.
  for (const transactionId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { outcome } = await ensureBooking({ transactionId, source: 'sweeper' });
      outcomes[outcome] = (outcomes[outcome] || 0) + 1;
    } catch (e) {
      log.error(e, 'nylas-booking-sweep-item-failed', { transactionId });
    }
  }

  return { checked: ids.length, outcomes };
};

module.exports = { runBookingSweep };
