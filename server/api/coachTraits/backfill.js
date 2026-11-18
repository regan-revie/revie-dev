/**
 * One-off backfills of coach traits, run from scripts/coach-traits-backfill.js.
 *
 *   forward  profile -> listings: every published listing gets its coach's traits (the same function
 *            the loop and the sync endpoint use, so this is only "do it for everyone now").
 *   reverse  listings -> profile: for cutover, where coaches' listings already carry the answers
 *            (they were required per session on Live) but their profiles have none. Fills only
 *            traits the profile has no answer for; never overwrites one.
 *
 * Both default to nothing: the caller must say dryRun (compute and report, write nothing) or apply.
 * The report names users and listings by id and shows option keys, never names or emails.
 */

const { syncListingsFromProfile, fillProfileFromListings } = require('./sync');

const PER_PAGE = 100;

const indexIncludedUsers = included =>
  (included || [])
    .filter(r => r.type === 'user')
    .reduce((byId, user) => ({ ...byId, [user.id.uuid]: user }), {});

/** Every published listing, grouped by author: Map(userId -> {author, listings}). */
const publishedListingsByCoach = async sdk => {
  const byCoach = new Map();
  for (let page = 1; ; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await sdk.listings.query({
      states: 'published',
      include: ['author'],
      perPage: PER_PAGE,
      page,
    });
    const users = indexIncludedUsers(response.data.included);
    response.data.data.forEach(listing => {
      const authorId = listing.relationships?.author?.data?.id?.uuid;
      if (!users[authorId]) return;
      const entry = byCoach.get(authorId) || { author: users[authorId], listings: [] };
      entry.listings.push(listing);
      byCoach.set(authorId, entry);
    });
    if (page >= (response.data.meta?.totalPages || 1)) break;
  }
  return byCoach;
};

/**
 * @param {object} params
 * @param {object} params.sdk Integration SDK
 * @param {'forward'|'reverse'} params.direction
 * @param {boolean} params.dryRun
 * @returns {Promise<{rows: object[], totals: object}>} `rows` is one entry per coach with something
 *   to report
 */
const runBackfill = async ({ sdk, direction, dryRun }) => {
  const byCoach = await publishedListingsByCoach(sdk);
  const rows = [];
  const totals = { coaches: byCoach.size, coachesChanged: 0, listingsChanged: 0, errors: 0 };

  for (const [userId, { author, listings }] of byCoach) {
    const userPublicData = author.attributes?.profile?.publicData;

    if (direction === 'forward') {
      // eslint-disable-next-line no-await-in-loop
      const { changes, unmapped, errors } = await syncListingsFromProfile({
        userPublicData,
        listings,
        updateListing: args => sdk.listings.update(args),
        dryRun,
      });
      if (changes.length > 0 || unmapped.length > 0 || errors.length > 0) {
        rows.push({
          userId,
          changes,
          unmapped,
          errors: errors.map(e => ({ listingId: e.listingId, message: e.error.message })),
        });
        if (changes.length > 0) totals.coachesChanged += 1;
        totals.listingsChanged += changes.length;
        totals.errors += errors.length;
      }
    } else {
      // eslint-disable-next-line no-await-in-loop
      const { traits, conflicts, unmapped, error } = await fillProfileFromListings({
        userId,
        userPublicData,
        listings,
        updateProfile: args => sdk.users.updateProfile(args),
        dryRun,
      });
      if (Object.keys(traits).length > 0 || conflicts.length > 0 || unmapped.length > 0 || error) {
        rows.push({
          userId,
          fills: traits,
          conflicts,
          unmapped,
          error: error ? error.message : undefined,
        });
        if (Object.keys(traits).length > 0) totals.coachesChanged += 1;
        if (error) totals.errors += 1;
      }
    }
  }
  return { rows, totals };
};

module.exports = { runBackfill, publishedListingsByCoach };
