/**
 * POST /api/nylas/create-booking
 *
 * Called once by the browser right after a client's payment is confirmed (see
 * src/containers/CheckoutPage/CheckoutPageWithPayment.js). Nothing else tells Nylas a booking
 * happened - Sharetribe's checkout only knows about price and payment - so without this call a
 * client could pay and the transaction would sit at `preauthorized` with nothing on the coach's
 * calendar.
 *
 * This endpoint only proves who is calling. The work - retrying, waiting for a late webhook, and
 * declining the transaction (releasing the card authorisation) if the booking cannot be made - is
 * bookingRecovery.ensureBooking(), the same routine the sweeper runs for a client whose browser
 * never made this call. See that file for the full sequence.
 *
 * The browser does not wait for the result: the order page polls the transaction instead.
 */

const { createCookieTokenStore, getSdk, handleError } = require('../../api-util/sdk');
const { isConfigured } = require('./config');
const { loadCalendarBookingTransaction } = require('./manageBookingShared');
const { ensureBooking } = require('./bookingRecovery');

module.exports = async (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Calendar integration is not configured' });
    return;
  }

  const { transactionId } = req.body || {};
  if (!transactionId) {
    res.status(400).json({ error: 'transactionId is required' });
    return;
  }

  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);

  try {
    // transactions.show refuses (403) a transaction the caller is not a party to; on top of that
    // only the customer who paid may trigger this.
    const [{ tx }, userResponse] = await Promise.all([
      loadCalendarBookingTransaction(sdk, transactionId),
      sdk.currentUser.show(),
    ]);

    const customerId = tx.relationships?.customer?.data?.id?.uuid;
    if (!customerId || customerId !== userResponse.data.data.id.uuid) {
      res.status(403).json({ error: 'Only the customer can create the booking' });
      return;
    }

    const result = await ensureBooking({ transactionId, source: 'browser' });

    if (result.outcome === 'unavailable') {
      res.status(503).json({ error: 'Booking recovery is not available', ...result });
      return;
    }
    // 200 even for 'declined': the endpoint did what it should. The order page shows the outcome.
    res.status(200).json(result);
  } catch (e) {
    if (e.status) {
      handleError(res, e);
      return;
    }
    console.error(`[nylas] Booking creation failed for transaction ${transactionId}: ${e.message}`);
    res.status(502).json({ error: 'Could not create calendar booking' });
  }
};
