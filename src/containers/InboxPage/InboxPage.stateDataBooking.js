import {
  TX_TRANSITION_ACTOR_CUSTOMER as CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER as PROVIDER,
  CONDITIONAL_RESOLVER_WILDCARD,
  ConditionalResolver,
} from '../../transactions/transaction';
import { isLateCancelled, LATE_CANCELLED } from '../../transactions/lateCancellation';

// Get UI data mapped to specific transaction state & role
export const getStateDataForBookingProcess = (txInfo, processInfo) => {
  const { transactionRole, transaction } = txInfo;
  const { processName, processState, states } = processInfo;
  const _ = CONDITIONAL_RESOLVER_WILDCARD;

  // Revie: a late-cancelled session is a finished, cancelled session: not "Booked", and not a review
  // waiting to be left. On release-4 it has its own state; on release-3 it is still
  // `accepted`/`delivered` and only the transaction metadata says so.
  if (
    [states.LATE_CANCELLED, states.LATE_CANCELLED_COMPLETED].includes(processState) ||
    (isLateCancelled(transaction) && [states.ACCEPTED, states.DELIVERED].includes(processState))
  ) {
    return { processName, processState: LATE_CANCELLED, isFinal: true };
  }

  return (
    new ConditionalResolver([processState, transactionRole])
      .cond([states.INQUIRY, _], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.PENDING_PAYMENT, CUSTOMER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.CANCELED, _], () => {
        return { processName, processState, isFinal: true };
      })
      // Revie: the coach no longer accepts calendar bookings (our server confirms them), so a
      // paid-but-unconfirmed booking is not something they need to act on.
      // Revie: a confirmed booking is good news, not a to-do; it is not tagged as a warning.
      .cond([states.ACCEPTED, _], () => {
        return { processName, processState };
      })
      .cond([states.DECLINED, _], () => {
        return { processName, processState, isFinal: true };
      })
      .cond([states.EXPIRED, _], () => {
        return { processName, processState, isFinal: true };
      })
      // After the session the client is asked to review (orange tag); the coach just waits for the
      // client's review, which is plain muted text, not something they have to do.
      .cond([states.DELIVERED, CUSTOMER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.DELIVERED, PROVIDER], () => {
        return { processName, processState, isWaiting: true };
      })
      .cond([states.REVIEWED_BY_PROVIDER, CUSTOMER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.REVIEWED_BY_PROVIDER, PROVIDER], () => {
        return { processName, processState, isWaiting: true };
      })
      .cond([states.REVIEWED_BY_CUSTOMER, PROVIDER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.REVIEWED_BY_CUSTOMER, CUSTOMER], () => {
        return { processName, processState, isWaiting: true };
      })
      .cond([states.REVIEWED, _], () => {
        return { processName, processState, isFinal: true };
      })
      .default(() => {
        // Default values for other states
        return { processName, processState };
      })
      .resolve()
  );
};
