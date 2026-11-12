/**
 * Moves of a calendar session, for the Activity list.
 *
 * A reschedule is not a Sharetribe transition (Sharetribe's booking is not touched by it), so there
 * is nothing in the transaction's own history to list. The server writes each move to the
 * transaction's metadata instead (server/api/nylas/bookingSync.js, `recordReschedule`) and this
 * module reads them back, the same way lateCancellation.js does for late cancellations.
 */

/** Stands in for the move in the activity feed. */
export const RESCHEDULE_FEED_ITEM = 'revie/rescheduled';

const asDate = value => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/**
 * Every recorded move, oldest first, as { at, toStart, toEnd } with real Dates. Entries that cannot
 * be read are left out rather than shown half-empty.
 */
export const getReschedules = transaction => {
  const raw = transaction?.attributes?.metadata?.reschedules;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(entry => ({
      at: asDate(entry?.at),
      toStart: asDate(entry?.toStart),
      toEnd: asDate(entry?.toEnd),
    }))
    .filter(entry => entry.at && entry.toStart)
    .sort((a, b) => a.at - b.at);
};
