/**
 * The loop pass that keeps listings' coach traits in step with the profile.
 *
 * Runs on the same 60-second tick as the Nylas reconcile loop (server/jobs/index.js), but for every
 * coach with a published session, calendar or not: search visibility has nothing to do with whether
 * a calendar is connected. This is what covers "a coach just published a session" and any profile
 * edit made somewhere the sync endpoint was not called (the Sharetribe Console, a failed request).
 *
 * Idempotent: a listing already carrying its coach's traits costs nothing beyond the query.
 */

const log = require('../../log');
const integration = require('../nylas/integration');
const { syncListingsFromProfile } = require('./sync');

const PER_PAGE = 100;
const MAX_PAGES = 10;
const RETRY_FAILED_AFTER_MS = 10 * 60 * 1000;

const failedAt = new Map();

const indexIncludedUsers = included =>
  (included || [])
    .filter(r => r.type === 'user')
    .reduce((byId, user) => ({ ...byId, [user.id.uuid]: user }), {});

const runTraitSync = async ({ now = Date.now() } = {}) => {
  const sdk = integration.getIntegrationSdk();
  if (!sdk) return { skipped: true };

  const byCoach = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
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
      const author = users[authorId];
      if (!author) return;
      const entry = byCoach.get(authorId) || { author, listings: [] };
      entry.listings.push(listing);
      byCoach.set(authorId, entry);
    });
    if (page >= (response.data.meta?.totalPages || 1)) break;
  }

  const summary = { coaches: byCoach.size, listingsUpdated: 0, failed: 0 };
  for (const [userId, { author, listings }] of byCoach) {
    const due = listings.filter(
      l => !(now - (failedAt.get(l.id.uuid) || 0) < RETRY_FAILED_AFTER_MS)
    );
    if (due.length === 0) continue; // eslint-disable-line no-continue

    // eslint-disable-next-line no-await-in-loop
    const { changes, errors } = await syncListingsFromProfile({
      userPublicData: author.attributes?.profile?.publicData,
      listings: due,
      updateListing: args => sdk.listings.update(args),
    });
    summary.listingsUpdated += changes.length - errors.length;
    errors.forEach(({ listingId, error }) => {
      summary.failed += 1;
      failedAt.set(listingId, now);
      log.error(error, 'coach-traits-sync-failed', { userId, listingId });
    });
    changes.forEach(({ listingId }) => {
      if (!errors.some(e => e.listingId === listingId)) failedAt.delete(listingId);
    });
  }
  return summary;
};

module.exports = { runTraitSync };
