/**
 * Run ensureListingBookable for each of one coach's listings, one coach at a time.
 *
 * The per-coach advisory lock is what lets the reconcile loop, the Calendar page's sync and the
 * Nylas callback all call this without coordinating: whoever arrives second finds the coach locked
 * and returns immediately, and the loop picks up anything that was missed on its next tick.
 *
 * One listing failing never stops the others, and nothing here throws.
 */

const db = require('./db');
const { ensureListingBookable } = require('./ensureBookable');

/**
 * Wraps a listing-update function so an update with no availability plan (an adopted listing, which
 * only gets its signature written) does not send one at all, rather than sending `undefined`.
 */
const updaterFor = update => ({ id, publicData, availabilityPlan }) =>
  update({ id, publicData, ...(availabilityPlan ? { availabilityPlan } : {}) });

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {object} params.profile `{displayName, privateData}`
 * @param {object[]} params.listings the coach's listings (any state mix; only callers decide which)
 * @param {Function} params.updateListing `({id, publicData, availabilityPlan}) => Promise`
 * @param {string} params.siteUrl
 * @returns {Promise<{locked: boolean, results: {listingId: string, status: string, error?: Error}[]}>}
 */
const ensureCoachListings = async ({ userId, profile, listings, updateListing, siteUrl }) => {
  const outcome = await db.withAdvisoryLock(`nylas-ensure-coach:${userId}`, async () => {
    const results = [];
    for (const listing of listings) {
      const listingId = listing.id.uuid || listing.id;
      try {
        // eslint-disable-next-line no-await-in-loop
        const { status } = await ensureListingBookable({
          listing,
          profile,
          updateListing,
          siteUrl,
        });
        results.push({ listingId, status });
      } catch (e) {
        results.push({ listingId, status: 'error', error: e });
      }
    }
    return results;
  });

  return outcome.locked ? { locked: true, results: outcome.value } : { locked: false, results: [] };
};

/**
 * The same, for the logged-in coach: reads their own published listings with their own SDK and
 * writes them back with it. Used by the Calendar page's sync and by the Nylas callback.
 *
 * @param {object} params
 * @param {object} params.sdk Marketplace SDK acting as the coach
 * @param {string} params.userId
 * @param {object} params.profile `{displayName, privateData}` - pass the *new* private data when the
 *   caller has just changed it (the callback has just stored a grant)
 * @param {string} params.siteUrl
 */
const ensureOwnListings = async ({ sdk, userId, profile, siteUrl }) => {
  const response = await sdk.ownListings.query({ states: 'published', perPage: 100 });
  return ensureCoachListings({
    userId,
    profile,
    listings: response.data.data,
    updateListing: updaterFor(args => sdk.ownListings.update(args)),
    siteUrl,
  });
};

module.exports = { ensureCoachListings, ensureOwnListings, updaterFor };
