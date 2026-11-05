import { useEffect, useRef } from 'react';

import { nylasCreateBooking } from '../../util/api';

const POLL_EVERY_MS = 4000;
// The server recovers a failed booking within about 15 seconds, and its sweeper catches the rest
// within a few minutes. Past this point something is badly wrong and polling would not help.
const POLL_FOR_MS = 5 * 60 * 1000;
// The browser asks the server to create the booking right after payment. If that call was lost or
// refused, the page asks once more after this long. Safe to repeat: the server holds a database claim
// per transaction, so a second call either finds the booking already made or makes it, never two.
const RETRY_CREATE_AFTER_MS = 10 * 1000;

const PAID_AND_WAITING = 'transition/confirm-payment';

/**
 * A customer who has paid for a calendar booking that the server has not confirmed (or declined)
 * yet. Their order page should show "Confirming your session" and watch for the outcome.
 *
 * @param {object} transaction a denormalised transaction with its listing
 * @param {string} transactionRole 'customer' | 'provider'
 */
export const isConfirmingCalendarBooking = (transaction, transactionRole) =>
  transactionRole === 'customer' &&
  transaction?.attributes?.lastTransition === PAID_AND_WAITING &&
  !!transaction?.listing?.attributes?.publicData?.calendarBookingEnabled;

/**
 * Re-fetches the transaction every few seconds while it is waiting for the server to confirm the
 * calendar booking, and stops by itself as soon as it moves on (accepted, or declined because the
 * booking could not be made) or after a few minutes. See server/api/nylas/bookingRecovery.js.
 *
 * @param {object} params
 * @param {object} params.transaction
 * @param {string} params.transactionRole
 * @param {Function} params.refetch stable function that re-fetches the transaction
 * @param {Function} [params.retryCreateBooking] asks the server to create the booking again; one
 *   call per transaction, ten seconds in, while it is still unconfirmed
 */
export const useConfirmingBookingPoll = ({
  transaction,
  transactionRole,
  refetch,
  retryCreateBooking = nylasCreateBooking,
}) => {
  const waiting = isConfirmingCalendarBooking(transaction, transactionRole);
  const transactionId = transaction?.id?.uuid || transaction?.id;
  const retriedFor = useRef(null);

  // One retry of the booking creation (never of initiating the order, which is not safe to repeat).
  useEffect(() => {
    if (!waiting || !transactionId || retriedFor.current === transactionId) return undefined;

    const timer = setTimeout(() => {
      retriedFor.current = transactionId;
      Promise.resolve(retryCreateBooking({ transactionId }))
        .catch(() => {})
        .then(() => refetch());
    }, RETRY_CREATE_AFTER_MS);

    return () => clearTimeout(timer);
  }, [waiting, transactionId, retryCreateBooking, refetch]);

  useEffect(() => {
    if (!waiting) return undefined;

    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= POLL_FOR_MS) {
        clearInterval(timer);
        return;
      }
      refetch();
    }, POLL_EVERY_MS);

    return () => clearInterval(timer);
  }, [waiting, refetch]);
};
