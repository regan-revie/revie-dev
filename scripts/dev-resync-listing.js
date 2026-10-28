/**
 * Dev-only: re-sync one calendar listing's Nylas configurations and process alias, the same way a
 * coach enabling booking does (server/api/nylas/listingSync.js), for listings enabled before those
 * changes existed. NOT used by the app.
 *
 *   op run --env-file=.env -- node scripts/dev-resync-listing.js status --listing <id>
 *   BOOKING_PROCESS_ALIAS=default-booking/release-2 \
 *     op run --env-file=.env -- node scripts/dev-resync-listing.js sync --listing <id> \
 *       --site https://revie-dev.onrender.com --yes
 *
 *   status   read-only: what the listing and its Nylas configurations look like now
 *   sync     update each configuration (title, description, Meet, hidden Nylas links, 30-minute
 *            slots, one per session length) and write publicData + the process alias. Needs --yes.
 *
 * --site is the public URL the links in the calendar invite should point at. It is a flag, not read
 * from .env, because a local .env points at localhost and those links would then be wrong for
 * everyone else. Whichever environment the Integration API credentials belong to is the one this
 * changes: run it against Dev only. Prints no ids or secrets.
 */

const integrationSdk = require('sharetribe-flex-integration-sdk');
const { nylasRequest } = require('../server/api/nylas/client');
const { listCalendars, defaultCalendarFor } = require('../server/api/nylas/scheduler');
const {
  resolveBookingProcessAlias,
  grantProvider,
  syncListingConfigurations,
} = require('../server/api/nylas/listingSync');
const { configurationIdsOf } = require('../server/api/nylas/bookingConfig');

const args = process.argv.slice(2);
const command = args[0];
const flag = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const listingId = flag('--listing');
const siteUrl = flag('--site');

const fail = message => {
  console.error(message);
  process.exit(1);
};

if (!['status', 'sync'].includes(command) || !listingId) {
  fail(
    'Usage: node scripts/dev-resync-listing.js <status|sync> --listing <id> [--site <url>] [--yes]'
  );
}
if (command === 'sync' && !args.includes('--yes')) fail('"sync" changes the listing. Add --yes.');
if (command === 'sync' && !/^https:\/\//.test(siteUrl || '')) {
  fail('--site https://<the deployed site> is required for sync.');
}
if (
  !process.env.SHARETRIBE_INTEGRATION_CLIENT_ID ||
  !process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET ||
  !process.env.NYLAS_API_KEY
) {
  fail('Credentials are not in the environment. Run this through `op run --env-file=.env --`.');
}

const sdk = integrationSdk.createInstance({
  clientId: process.env.SHARETRIBE_INTEGRATION_CLIENT_ID,
  clientSecret: process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET,
});

const load = async () => {
  const response = await sdk.listings.show({ id: listingId, include: ['author'] });
  const listing = response.data.data;
  const author = (response.data.included || []).find(i => i.type === 'user');
  return { listing, profile: author.attributes.profile };
};

/** Non-sensitive facts about one configuration, to compare before and after. */
const summarise = async (grantId, id) => {
  const c = await nylasRequest(`/v3/grants/${grantId}/scheduling/configurations/${id}`);
  return {
    title: c.event_booking?.title,
    description: (c.event_booking?.description || '').slice(0, 60) + '…',
    conferencing: c.event_booking?.conferencing?.provider || 'none',
    durationMinutes: c.availability?.duration_minutes,
    intervalMinutes: c.availability?.interval_minutes,
    roundTo: c.availability?.round_to,
    hideCancellation: c.scheduler?.hide_cancellation_options,
    hideRescheduling: c.scheduler?.hide_rescheduling_options,
    cancellationUrl: c.scheduler?.cancellation_url,
  };
};

const show = async (label, listing, grantId) => {
  const publicData = listing.attributes.publicData || {};
  console.log(`\n== ${label} ==`);
  console.log(
    JSON.stringify(
      {
        listingTitle: listing.attributes.title,
        transactionProcessAlias: publicData.transactionProcessAlias,
        calendarBookingEnabled: Boolean(publicData.calendarBookingEnabled),
        hasCalendarIdForEventUpdates: Boolean(publicData.nylasCalendarId),
        configuredLengthsMinutes: Object.keys(configurationIdsOf(publicData)).map(Number),
      },
      null,
      2
    )
  );
  const ids = configurationIdsOf(publicData);
  for (const [length, id] of Object.entries(ids)) {
    // eslint-disable-next-line no-await-in-loop
    console.log(
      `configuration for ${length} min:`,
      JSON.stringify(await summarise(grantId, id), null, 2)
    );
  }
};

(async () => {
  const { listing, profile } = await load();
  const grantId = (profile.privateData || {}).nylasGrantId;
  if (!grantId) fail("The listing's author has no connected calendar.");

  await show('BEFORE', listing, grantId);
  if (command === 'status') return;

  const processAlias = resolveBookingProcessAlias(
    flag('--alias') ? { BOOKING_PROCESS_ALIAS: flag('--alias') } : process.env
  );
  if (processAlias.error) fail(processAlias.error);

  const publicData = listing.attributes.publicData || {};
  // Keep selling against the calendar already in use; only fall back to the default if unknown.
  let calendarId = publicData.nylasCalendarId;
  if (!calendarId) {
    const first = Object.values(configurationIdsOf(publicData))[0];
    if (first) {
      const c = await nylasRequest(`/v3/grants/${grantId}/scheduling/configurations/${first}`);
      calendarId = c.participants?.[0]?.booking?.calendar_id;
    }
  }
  if (!calendarId) calendarId = defaultCalendarFor(await listCalendars(grantId))?.id;
  if (!calendarId) fail('No writable calendar found.');

  const result = await syncListingConfigurations({
    listing,
    grantId,
    provider: await grantProvider(grantId),
    coachName: profile.displayName,
    coachEmail: (profile.privateData || {}).nylasGrantEmail || calendarId,
    calendarId,
    eventTypeKey: publicData.nylasEventTypeKey || 'signature-session',
    minBookingNoticeMinutes: publicData.nylasMinBookingNoticeMinutes,
    siteUrl,
    processAlias: processAlias.alias,
  });

  await sdk.listings.update({ id: listingId, publicData: result.publicData });

  const after = await load();
  await show('AFTER', after.listing, grantId);
})().catch(e => {
  // The message can contain ids from the request path; keep them out of the output.
  const redact = s =>
    String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  const detail = e.nylasError ? ` ${redact(JSON.stringify(e.nylasError))}` : '';
  fail(`Failed: ${e.status || ''} ${redact(e.message)}${detail}`);
});
