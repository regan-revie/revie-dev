/**
 * Create and manage Revie promo codes. Run on the Render Shell (it has DATABASE_URL), or locally
 * through `op run --env-file=.env --` against a database you can reach.
 *
 *   node scripts/promo-codes.js create NEWYEAR15 --percent 15 --first-session-only \
 *        --expires "2027-02-01 00:00" --tz America/Los_Angeles --max-uses 50 --per-customer 1
 *   node scripts/promo-codes.js list
 *   node scripts/promo-codes.js show NEWYEAR15
 *   node scripts/promo-codes.js deactivate NEWYEAR15     (stops new uses; existing bookings are untouched)
 *   node scripts/promo-codes.js activate NEWYEAR15
 *
 * A code takes a percentage off what the client pays; the coach is still paid on the full price, so
 * it comes out of Revie's commission. The script refuses more than 15%. Whichever database
 * DATABASE_URL points at is the one this changes: Dev only until cutover. The output shows codes,
 * counts and ids, never names, emails or secrets.
 */

const db = require('../server/api/nylas/db');
const store = require('../server/api/promo/store');
const { parseCreateArgs, describeCode } = require('../server/api/promo/cli');

const fail = message => {
  console.error(message); // eslint-disable-line no-console
  process.exit(1);
};

const [command, ...args] = process.argv.slice(2);

(async () => {
  if (!db.isAvailable()) fail('DATABASE_URL is not set, so there is no database to talk to.');
  await store.initSchema();

  if (command === 'create') {
    let input;
    try {
      input = parseCreateArgs(args);
    } catch (e) {
      fail(e.message);
    }
    try {
      const row = await store.createCode(input);
      console.log(`Created: ${describeCode({ ...row, paid_count: 0, reserved_count: 0 })}`); // eslint-disable-line no-console
    } catch (e) {
      if (e.code === '23505') fail(`${input.code} already exists. Use "list" to see it.`);
      throw e;
    }
  } else if (command === 'list') {
    const rows = await store.listCodes();
    if (rows.length === 0) console.log('No promo codes yet.'); // eslint-disable-line no-console
    rows.forEach(row => console.log(describeCode(row))); // eslint-disable-line no-console
  } else if (command === 'show') {
    const rows = (await store.listCodes()).filter(
      r => r.code === String(args[0] || '').toUpperCase()
    );
    if (rows.length === 0) fail(`No code ${args[0]}.`);
    console.log(describeCode(rows[0])); // eslint-disable-line no-console
    (await store.listRedemptions(args[0])).forEach(r => console.log(JSON.stringify(r))); // eslint-disable-line no-console
  } else if (command === 'deactivate' || command === 'activate') {
    const row = await store.setActive(args[0], command === 'activate');
    if (!row) fail(`No code ${args[0]}.`);
    console.log(`${row.code} is now ${row.active ? 'ACTIVE' : 'INACTIVE'}.`); // eslint-disable-line no-console
  } else {
    fail('Usage: node scripts/promo-codes.js <create|list|show|deactivate|activate> ...');
  }
  await db.close();
})().catch(e => fail(`promo-codes failed: ${e.message}`));
