/**
 * Late cancellations: a client cancelled a calendar session less than 48 hours before it started.
 *
 * Sharetribe does not know. Policy is to charge, so the server deliberately makes no transition and
 * the transaction stays `accepted` (and later auto-completes, paying the coach). What it does is
 * write `lateCancelledAt` and `cancelledBy` into the transaction's metadata
 * (server/api/nylas/bookingSync.js), which both parties receive from the Marketplace API. The UI
 * reads them here and shows a cancelled session instead of a booked or completed one.
 */

/** Pseudo-states used only to pick translation keys and UI behaviour; never sent to Sharetribe. */
export const LATE_CANCELLED = 'late-cancelled';
export const LATE_CANCELLED_BY_COACH = 'late-cancelled-by-coach';

/** Stands in for the cancellation in the activity feed, which lists transitions. */
export const LATE_CANCELLATION_FEED_ITEM = 'revie/late-cancelled';

/** { at: Date, by: 'client' | 'coach' } when this transaction was late-cancelled, else null. */
export const getLateCancellation = transaction => {
  const metadata = transaction?.attributes?.metadata;
  if (!metadata?.lateCancelledAt) return null;
  const at = new Date(metadata.lateCancelledAt);
  if (Number.isNaN(at.getTime())) return null;
  return { at, by: metadata.cancelledBy === 'client' ? 'client' : 'coach' };
};

export const isLateCancelled = transaction => !!getLateCancellation(transaction);

/** The pseudo-state a late-cancelled transaction is shown as. */
export const lateCancelledState = transaction =>
  getLateCancellation(transaction)?.by === 'coach' ? LATE_CANCELLED_BY_COACH : LATE_CANCELLED;
