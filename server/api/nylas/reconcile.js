/**
 * The reconcile loop: keeps every coach's session listings bookable without anyone doing anything.
 *
 * Every run it lists the marketplace's published listings (with their authors), and for each coach
 * with a connected calendar runs ensureCoachListings. Because ensureListingBookable is idempotent
 * by signature, a run over listings that are already in step costs one Sharetribe query per 100
 * listings and nothing else. It is what makes publishing a session, editing its price variants,
 * connecting a calendar and saving hours all end the same way, whichever happened first.
 *
 * Why a loop over state rather than Sharetribe's events: Dev keeps events for 7 days (Live 90), so
 * a cursor that falls behind loses changes; comparing state cannot miss anything. At a few hundred
 * listings this is fine; past that, switch the query to events with a stored cursor.
 *
 * A listing that keeps failing is retried and reported at most every 10 minutes, so one broken
 * listing does not fill Sentry once a minute.
 */

const log = require('../../log');
const db = require('./db');
const integration = require('./integration');
const { ensureCoachListings, updaterFor } = require('./ensureCoach');
const { resolveBookingProcessAlias } = require('./listingSync');

const PER_PAGE = 100;
const MAX_PAGES = 10;
const RETRY_FAILED_AFTER_MS = 10 * 60 * 1000;

const failedAt = new Map();
let warnedAboutAlias = false;

/** Authors of the listings on a page, from the `include`d users. */
const indexIncludedUsers = included =>
  (included || [])
    .filter(r => r.type === 'user')
    .reduce((byId, user) => ({ ...byId, [user.id.uuid]: user }), {});

const runReconcile = async ({ now = Date.now() } = {}) => {
  const sdk = integration.getIntegrationSdk();
  if (!sdk || !db.isAvailable()) return { skipped: true };

  // Without it a new listing cannot be put on the right process, and the sync would refuse every
  // listing every minute. Say so once, not once a minute.
  const alias = resolveBookingProcessAlias();
  if (alias.error) {
    if (!warnedAboutAlias) {
      console.error(`[nylas] Reconcile is paused: ${alias.error}`); // eslint-disable-line no-console
      warnedAboutAlias = true;
    }
    return { skipped: true, reason: alias.error };
  }
  warnedAboutAlias = false;

  const siteUrl = process.env.REACT_APP_MARKETPLACE_ROOT_URL;
  const summary = { listings: 0, coaches: 0, statuses: {}, locked: 0 };
  const updateListing = updaterFor(args => sdk.listings.update(args));

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
      const privateData = author?.attributes?.profile?.privateData;
      // Not a coach with a calendar, so nothing to do and nothing worth a call.
      if (!privateData || !privateData.nylasGrantId) return;
      const entry = byCoach.get(authorId) || { author, listings: [] };
      entry.listings.push(listing);
      byCoach.set(authorId, entry);
    });
    if (page >= (response.data.meta?.totalPages || 1)) break;
  }

  for (const [userId, { author, listings }] of byCoach) {
    // Skip listings that failed recently; they are tried again once the pause is over.
    const due = listings.filter(
      l => !(now - (failedAt.get(l.id.uuid) || 0) < RETRY_FAILED_AFTER_MS)
    );
    if (due.length === 0) continue; // eslint-disable-line no-continue
    summary.coaches += 1;

    // eslint-disable-next-line no-await-in-loop
    const { locked, results } = await ensureCoachListings({
      userId,
      profile: author.attributes.profile,
      listings: due,
      updateListing,
      siteUrl,
    });
    if (!locked) {
      summary.locked += 1;
      continue; // eslint-disable-line no-continue
    }

    results.forEach(result => {
      summary.listings += 1;
      summary.statuses[result.status] = (summary.statuses[result.status] || 0) + 1;
      if (result.status === 'error') {
        failedAt.set(result.listingId, now);
        log.error(result.error, 'nylas-ensure-bookable-failed', {
          userId,
          listingId: result.listingId,
        });
      } else {
        failedAt.delete(result.listingId);
      }
    });
  }

  return summary;
};

module.exports = { runReconcile };
