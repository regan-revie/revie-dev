/**
 * Which version of the client's booking page a transaction is, from its process state and, for a
 * cancellation, what the transaction and the "Your session" card know. Pure, so each state is
 * testable without rendering the page.
 *
 *   confirming   paid, waiting for our server to put it on the coach's calendar ("Confirming your session")
 *   declined     the time was taken or the payment was not finished: not charged ("That one didn't go through")
 *   live         booked and still to come
 *   done         the session has been and gone (completed, reviewed)
 *   cancelled    with `cancel`: 'refunded' (the client cancelled early), 'late' (the client cancelled
 *                inside 48 hours and was charged), 'coach' (the coach cancelled: refunded in full),
 *                'unknown' (just cancelled, the outcome not known yet)
 *   null         anything else (an inquiry, a payment not yet confirmed): the template's own page
 */

const CONFIRMING = ['preauthorized'];
const DECLINED = ['declined', 'expired', 'payment-expired'];
const LIVE = ['accepted'];
const DONE = ['delivered', 'reviewed', 'reviewed-by-customer', 'reviewed-by-provider'];
const LATE = ['late-cancelled', 'late-cancelled-completed'];

/**
 * @param {Object} params
 * @param {string} params.processState the state TransactionPage works out (`stateData.processState`)
 * @param {Object} [params.metadata] the transaction's metadata (`cancelledBy` is written by the server)
 * @param {Object} [params.calendarView] what the "Your session" card reports: `{isCancelled, cancelFree}`
 * @returns {{kind: string|null, cancel?: string}}
 */
export const getBookingPageState = ({ processState, metadata, calendarView }) => {
  if (CONFIRMING.includes(processState)) return { kind: 'confirming' };
  if (DECLINED.includes(processState)) return { kind: 'declined' };
  if (LATE.includes(processState)) return { kind: 'cancelled', cancel: 'late' };
  if (processState === 'canceled') {
    return {
      kind: 'cancelled',
      cancel: metadata?.cancelledBy === 'provider' ? 'coach' : 'refunded',
    };
  }
  if (LIVE.includes(processState)) {
    // Cancelled from this page a moment ago: the transaction has not caught up yet, the card has.
    if (calendarView?.isCancelled) {
      const cancel =
        calendarView.cancelFree === true
          ? 'refunded'
          : calendarView.cancelFree === false
          ? 'late'
          : 'unknown';
      return { kind: 'cancelled', cancel };
    }
    return { kind: 'live' };
  }
  if (DONE.includes(processState)) return { kind: 'done' };
  return { kind: null };
};
