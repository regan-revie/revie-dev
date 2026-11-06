/**
 * Late cancellations: a client cancelled a calendar session less than 48 hours before it started,
 * so they are charged and the coach is still paid.
 *
 * On process release-4 and later the server runs `transition/late-cancel`, so the transaction is
 * really in the `late-cancelled` state and no special handling is needed. Transactions that
 * started on release-3 have no such transition; for those the server only writes `lateCancelledAt`
 * and `cancelledBy` into the transaction metadata (server/api/nylas/bookingSync.js) and the
 * transaction stays `accepted`, then auto-completes. This module recognises that case so the UI can
 * show it as the late-cancelled session it is.
 */

/** The state a late-cancelled session is shown as (a real state on release-4, derived on release-3). */
export const LATE_CANCELLED = 'late-cancelled';

/** Stands in for the cancellation in the activity feed of a release-3 transaction. */
export const LATE_CANCELLATION_FEED_ITEM = 'revie/late-cancelled';

/** { at: Date, by: 'client' | 'provider' } from the transaction metadata, or null. */
export const getLateCancellation = transaction => {
  const metadata = transaction?.attributes?.metadata;
  if (!metadata?.lateCancelledAt) return null;
  const at = new Date(metadata.lateCancelledAt);
  if (Number.isNaN(at.getTime())) return null;
  return { at, by: metadata.cancelledBy === 'provider' ? 'provider' : 'client' };
};

export const isLateCancelled = transaction => !!getLateCancellation(transaction);
