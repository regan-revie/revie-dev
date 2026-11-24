/**
 * Subscribe Revie's Nylas webhook destination to the two notifications that say a coach's Google
 * connection stopped working: `grant.expired` and `grant.deleted` (server/api/nylas/grantStatus.js).
 * Run on the Render Shell, where the Nylas API key and region are already set, or locally through
 * `op run --env-file=.env --`.
 *
 *   node scripts/nylas-add-grant-triggers.js --dry-run   show what would change, change nothing
 *   node scripts/nylas-add-grant-triggers.js             add the two triggers
 *
 * Only a destination whose URL ends in /api/nylas/webhooks is touched, and only by ADDING triggers:
 * the ones it already has are kept. Safe to run again. Prints destination ids, URLs and trigger names
 * only; the webhook secret is never returned by Nylas's list and is never printed.
 *
 * The same can be done by hand in the Nylas dashboard (Notifications, open the destination, add the
 * two triggers), but the dashboard does not list every trigger, which is why this exists.
 */

const { nylasRequest } = require('../server/api/nylas/client');

const WANTED = ['grant.expired', 'grant.deleted'];
const dryRun = process.argv.includes('--dry-run');

const fail = message => {
  console.error(message); // eslint-disable-line no-console
  process.exit(1);
};

(async () => {
  const destinations = await nylasRequest('/v3/webhooks');
  const ours = (destinations || []).filter(d =>
    /\/api\/nylas\/webhooks\/?$/.test(d.webhook_url || '')
  );
  if (ours.length === 0) {
    fail(
      'No webhook destination ending in /api/nylas/webhooks was found for this Nylas application.'
    );
  }

  for (const destination of ours) {
    const have = destination.trigger_types || [];
    const missing = WANTED.filter(t => !have.includes(t));
    console.log(`${destination.id}  ${destination.webhook_url}  status=${destination.status}`); // eslint-disable-line no-console
    if (missing.length === 0) {
      console.log('  already subscribed to grant.expired and grant.deleted'); // eslint-disable-line no-console
      continue; // eslint-disable-line no-continue
    }
    console.log(`  ${dryRun ? 'would add' : 'adding'}: ${missing.join(', ')}`); // eslint-disable-line no-console
    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop
      await nylasRequest(`/v3/webhooks/${destination.id}`, {
        method: 'PUT',
        body: { trigger_types: [...have, ...missing] },
      });
      console.log('  done'); // eslint-disable-line no-console
    }
  }
})().catch(e => fail(`Failed: ${e.message}`));
