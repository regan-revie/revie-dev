/**
 * What to do when a coach connects a calendar and the Nylas grant is not the one we had stored.
 *
 * Nylas matches an authentication to an existing grant by email address, so reconnecting the *same*
 * Google account keeps the same grant id (https://developer.nylas.com/docs/dev-guide/best-practices/
 * grant-lifecycle/) and nothing here runs. A coach who connects a *different* account gets a new
 * grant, and everything built on the old one is wrong: a Scheduler configuration lives under its
 * grant (`/v3/grants/:grant/scheduling/configurations/:id`) and cannot be moved, and each listing's
 * `nylasCalendarId` belongs to the old account. So the coach's calendar listings are re-synced onto
 * the new grant, which creates fresh configurations, and the listings are pointed at them.
 *
 * What this cannot fix, and why it is always reported: a session already booked lives on the old
 * grant's calendar and old configuration, and the listing now names the new configuration, so
 * cancelling or rescheduling that session from Revie will no longer work. The old ids are kept in
 * `publicData.nylasPreviousConfigurationIds`, and the Sentry event (code `nylas-grant-changed`)
 * lists the sessions affected.
 *
 * Never throws: the coach has connected successfully either way, and the callback must still send
 * them back to the page.
 */

const log = require('../../log');
const db = require('./db');
const { listCalendars, defaultCalendarFor } = require('./scheduler');
const { grantProvider, syncListingConfigurations } = require('./listingSync');
const { permissiveAvailabilityPlan } = require('./enableListing');

const SENTRY_CODE = 'nylas-grant-changed';
const OWN_LISTING_STATES = 'draft,pendingApproval,published,closed';

/** The listing as if it had no configurations yet, so syncing creates them on the new grant. */
const withoutConfigurations = listing => ({
  ...listing,
  attributes: {
    ...listing.attributes,
    publicData: {
      ...(listing.attributes.publicData || {}),
      nylasConfigurationIds: undefined,
      nylasConfigurationId: undefined,
    },
  },
});

/**
 * @param {object} params
 * @param {object} params.sdk Marketplace SDK acting as the coach
 * @param {string} params.userId the coach's user id, for the report
 * @param {string} params.previousGrantId
 * @param {string} params.newGrantId
 * @param {string} [params.newGrantEmail]
 * @param {string} [params.coachName]
 * @param {string} params.siteUrl public site URL for the links in calendar invites
 * @returns {Promise<{repointed: string[], failed: string[], upcomingOnOldGrant: string[]}>}
 */
const handleGrantChange = async ({
  sdk,
  userId,
  previousGrantId,
  newGrantId,
  newGrantEmail,
  coachName,
  siteUrl,
}) => {
  const outcome = { repointed: [], failed: [], upcomingOnOldGrant: [], problem: null };

  try {
    const listingsResponse = await sdk.ownListings.query({
      states: OWN_LISTING_STATES,
      perPage: 100,
    });
    const calendarListings = listingsResponse.data.data.filter(
      l => l.attributes.publicData && l.attributes.publicData.calendarBookingEnabled
    );

    if (calendarListings.length > 0) {
      const calendars = await listCalendars(newGrantId);
      const chosen = defaultCalendarFor(calendars);
      if (!chosen) {
        outcome.problem = 'no-writable-calendar-on-new-grant';
      } else {
        const provider = await grantProvider(newGrantId);

        for (const listing of calendarListings) {
          const listingId = listing.id.uuid;
          const publicData = listing.attributes.publicData;
          try {
            // eslint-disable-next-line no-await-in-loop
            const synced = await syncListingConfigurations({
              listing: withoutConfigurations(listing),
              grantId: newGrantId,
              provider,
              coachName,
              coachEmail: newGrantEmail || chosen.id,
              calendarId: chosen.id,
              eventTypeKey: publicData.nylasEventTypeKey,
              minBookingNoticeMinutes: publicData.nylasMinBookingNoticeMinutes,
              siteUrl,
              // The listing keeps the process it is already on; this is a re-point, not a re-enable.
              processAlias: publicData.transactionProcessAlias,
            });

            // eslint-disable-next-line no-await-in-loop
            await sdk.ownListings.update({
              id: listing.id,
              publicData: {
                ...synced.publicData,
                nylasPreviousConfigurationIds: publicData.nylasConfigurationIds || {
                  ...(publicData.nylasConfigurationId
                    ? { 60: publicData.nylasConfigurationId }
                    : {}),
                },
              },
              availabilityPlan: permissiveAvailabilityPlan(chosen.timezone),
            });
            outcome.repointed.push(listingId);
          } catch (e) {
            outcome.failed.push(listingId);
            console.error(`[nylas] Re-pointing listing ${listingId} failed: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    outcome.problem = `could-not-list-or-sync: ${e.message}`;
  }

  try {
    if (db.isAvailable()) {
      const upcoming = await db.findUpcomingByGrantId(previousGrantId);
      outcome.upcomingOnOldGrant = upcoming.map(r => r.sharetribe_transaction_id);
    }
  } catch (e) {
    console.error(`[nylas] Could not look up sessions on the old grant: ${e.message}`);
  }

  // Sentry is where Regan is alerted. Reported every time, success or not: a coach changing
  // calendars needs a human to look at the sessions still on the old one.
  log.error(new Error('Coach connected a different calendar (new Nylas grant)'), SENTRY_CODE, {
    userId,
    previousGrantId,
    newGrantId,
    repointedListings: outcome.repointed,
    failedListings: outcome.failed,
    problem: outcome.problem,
    upcomingSessionsOnOldGrant: outcome.upcomingOnOldGrant,
  });

  return outcome;
};

module.exports = { handleGrantChange, SENTRY_CODE };
