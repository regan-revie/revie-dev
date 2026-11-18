/**
 * Applying coach traits to listings (profile -> listings) and, for the cutover, the reverse.
 * The decisions live in traits.js; this file only reads and writes through an SDK passed in, so the
 * loop, the endpoint and the backfill script all share it and tests can use a fake.
 */

const {
  listingTraitsFromProfile,
  listingTraitChanges,
  profileTraitsFromListings,
} = require('./traits');

/**
 * Bring one coach's listings in step with their profile.
 *
 * @param {object} params
 * @param {object} params.userPublicData the coach's `profile.publicData`
 * @param {object[]} params.listings Sharetribe listing resources (need `id` and `attributes.publicData`)
 * @param {Function} params.updateListing `({id, publicData}) => Promise`; publicData merges by key
 * @param {boolean} [params.dryRun] compute the changes but write nothing
 * @returns {Promise<{changes: {listingId: string, changes: object}[], unmapped: object[], errors: {listingId: string, error: Error}[]}>}
 */
const syncListingsFromProfile = async ({ userPublicData, listings, updateListing, dryRun }) => {
  const { traits, unmapped } = listingTraitsFromProfile(userPublicData);
  const changes = [];
  const errors = [];

  for (const listing of listings) {
    const listingId = listing.id.uuid || listing.id;
    const diff = listingTraitChanges(listing.attributes?.publicData, traits);
    if (Object.keys(diff).length === 0) continue; // eslint-disable-line no-continue
    changes.push({ listingId, changes: diff });
    if (!dryRun) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await updateListing({ id: listing.id, publicData: diff });
      } catch (error) {
        errors.push({ listingId, error });
      }
    }
  }
  return { changes, unmapped, errors };
};

/**
 * Fill a coach's empty profile traits from their listings (cutover, for coaches whose listings
 * already carry the answers). Never overwrites a profile answer.
 */
const fillProfileFromListings = async ({
  userId,
  userPublicData,
  listings,
  updateProfile,
  dryRun,
}) => {
  const { traits, conflicts, unmapped } = profileTraitsFromListings(
    userPublicData,
    listings.map(l => l.attributes?.publicData)
  );
  let error = null;
  if (!dryRun && Object.keys(traits).length > 0) {
    try {
      await updateProfile({ id: userId, publicData: traits });
    } catch (e) {
      error = e;
    }
  }
  return { traits, conflicts, unmapped, error };
};

module.exports = { syncListingsFromProfile, fillProfileFromListings };
