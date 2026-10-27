/**
 * Dev-only helper for testing booking recovery by hand. NOT used by the app.
 *
 *   op run --env-file=.env -- node scripts/dev-listing-test-helper.js <command> --listing <id> [--yes]
 *
 * Commands
 *   status          show (read-only) the listing's Nylas configuration state and process alias
 *   break           swap the listing's Nylas configuration id for a deliberately invalid one, so
 *                   the next booking fails. The original id is saved first and never overwritten.
 *   restore         put the saved original id back and check that it stuck
 *   use-release-2   set the listing's transactionProcessAlias to default-booking/release-2
 *   use-release-1   set it back to default-booking/release-1
 *
 * Every command except `status` changes the listing and needs --yes. It reads the Integration API
 * credentials from the environment (via `op run`) and never prints them. Whatever environment
 * those credentials belong to is the one it changes, so run it against Dev only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const integrationSdk = require('sharetribe-flex-integration-sdk');

const BOGUS_CONFIGURATION_ID = '00000000-0000-0000-0000-000000000000';

const args = process.argv.slice(2);
const command = args[0];
const flag = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const listingId = flag('--listing');
const confirmed = args.includes('--yes');

const fail = message => {
  console.error(message);
  process.exit(1);
};

if (!['status', 'break', 'restore', 'use-release-2', 'use-release-1'].includes(command)) {
  fail(
    'Usage: node scripts/dev-listing-test-helper.js <status|break|restore|use-release-2|use-release-1> --listing <id> [--yes]'
  );
}
if (!listingId) fail('--listing <id> is required');
if (command !== 'status' && !confirmed)
  fail(`"${command}" changes the listing. Add --yes to confirm.`);
if (
  !process.env.SHARETRIBE_INTEGRATION_CLIENT_ID ||
  !process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET
) {
  fail(
    'Integration API credentials are not in the environment. Run this through `op run --env-file=.env --`.'
  );
}

const sdk = integrationSdk.createInstance({
  clientId: process.env.SHARETRIBE_INTEGRATION_CLIENT_ID,
  clientSecret: process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET,
});

// Outside the repo, so it can never be committed by accident.
const savedFile = path.join(os.tmpdir(), `revie-original-nylas-config-${listingId}.json`);

const read = async () =>
  (await sdk.listings.show({ id: listingId })).data.data.attributes.publicData || {};
const write = async publicData => {
  await sdk.listings.update({ id: listingId, publicData });
  return read();
};
const describe = publicData =>
  console.log(
    JSON.stringify(
      {
        nylasConfigurationId:
          publicData.nylasConfigurationId === BOGUS_CONFIGURATION_ID
            ? 'INVALID (deliberately broken)'
            : publicData.nylasConfigurationId
            ? 'set (real)'
            : 'missing',
        transactionProcessAlias: publicData.transactionProcessAlias,
        originalSavedForRestore: fs.existsSync(savedFile),
      },
      null,
      2
    )
  );

(async () => {
  const current = await read();

  if (command === 'status') {
    describe(current);
  } else if (command === 'break') {
    if (current.nylasConfigurationId === BOGUS_CONFIGURATION_ID && !fs.existsSync(savedFile)) {
      fail('Already broken and no saved original exists. Refusing to continue.');
    }
    // Saved once and never overwritten, so a second "break" cannot lose the real id.
    if (!fs.existsSync(savedFile)) {
      fs.writeFileSync(
        savedFile,
        JSON.stringify({ nylasConfigurationId: current.nylasConfigurationId })
      );
    }
    describe(await write({ nylasConfigurationId: BOGUS_CONFIGURATION_ID }));
    console.log('\nThe listing is now BROKEN on purpose. Run `restore` when you have finished.');
  } else if (command === 'restore') {
    if (!fs.existsSync(savedFile)) fail('Nothing saved to restore.');
    const original = JSON.parse(fs.readFileSync(savedFile, 'utf8'));
    const after = await write({ nylasConfigurationId: original.nylasConfigurationId });
    if (after.nylasConfigurationId !== original.nylasConfigurationId) {
      fail('The restore did not stick. The saved original has been kept; try again.');
    }
    fs.unlinkSync(savedFile);
    describe(after);
    console.log('\nRestored.');
  } else {
    describe(
      await write({ transactionProcessAlias: `default-booking/release-${command.slice(-1)}` })
    );
  }
})().catch(e => fail(`Failed: ${e.status || ''} ${e.message}`));
