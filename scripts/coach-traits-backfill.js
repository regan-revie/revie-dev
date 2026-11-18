/**
 * Backfill coach traits between profiles and listings. Run on the Render Shell (it has the
 * Integration API credentials), or locally through `op run --env-file=.env --`.
 *
 *   node scripts/coach-traits-backfill.js forward --dry-run   profile -> listings, report only
 *   node scripts/coach-traits-backfill.js forward --apply     profile -> listings, write
 *   node scripts/coach-traits-backfill.js reverse --dry-run   listings -> EMPTY profile fields, report only
 *   node scripts/coach-traits-backfill.js reverse --apply     listings -> EMPTY profile fields, write
 *
 * One of --dry-run / --apply is required; there is no default, so it can never write by accident.
 * `reverse` is for cutover: it fills only the profile traits that have no answer yet, so run it
 * first, then `forward`. Neither ever clears a value. Whichever environment the Integration API
 * credentials belong to is the one this changes; Dev only until cutover. The report shows user and
 * listing ids and option keys, no names, emails or secrets.
 */

const integration = require('../server/api/nylas/integration');
const { runBackfill } = require('../server/api/coachTraits/backfill');

const args = process.argv.slice(2);
const direction = args[0];
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');

const fail = message => {
  console.error(message); // eslint-disable-line no-console
  process.exit(1);
};

if (!['forward', 'reverse'].includes(direction) || dryRun === apply) {
  fail('Usage: node scripts/coach-traits-backfill.js <forward|reverse> <--dry-run|--apply>');
}

const sdk = integration.getIntegrationSdk();
if (!sdk)
  fail('Integration API credentials are not set (SHARETRIBE_INTEGRATION_CLIENT_ID/_SECRET).');

runBackfill({ sdk, direction, dryRun })
  .then(({ rows, totals }) => {
    console.log(`${direction} ${dryRun ? 'DRY RUN (nothing written)' : 'APPLIED'}`); // eslint-disable-line no-console
    rows.forEach(row => console.log(JSON.stringify(row))); // eslint-disable-line no-console
    console.log(JSON.stringify(totals)); // eslint-disable-line no-console
    process.exit(totals.errors > 0 ? 1 : 0);
  })
  .catch(e => fail(`Backfill failed: ${e.message}`));
