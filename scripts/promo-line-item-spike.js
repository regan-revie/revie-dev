/**
 * Proves, WITHOUT creating a booking or moving any money, that Sharetribe accepts the promo
 * discount line items: a customer-only negative line next to the unchanged provider commission,
 * with a payout smaller than the payin.
 *
 * It asks Sharetribe for a SPECULATIVE initiate ("what would this transaction look like?"), which
 * is exactly what the checkout page does to show the price before the client pays. Nothing is
 * stored and no card is touched.
 *
 *   op run --env-file=.env -- node scripts/promo-line-item-spike.js <listing-id> [percent]
 *
 * It needs a real client login (the Marketplace API only prices a booking for a logged-in user).
 * Use a TEST client on the Dev marketplace. The email and password are asked for in your terminal;
 * the password is typed hidden, used once to log in, and never printed or stored. The listing must
 * be one of the Dev coach's calendar sessions. The script prints the line items and totals, or
 * Sharetribe's refusal, and nothing secret.
 */

const readline = require('readline');
const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems } = require('../server/api-util/lineItems');
const { constructValidLineItems } = require('../server/api-util/lineItemHelpers');
const { MAX_PERCENT_OFF } = require('../server/api/promo/rules');

const listingId = process.argv[2];
const percentOff = Number(process.argv[3] || 15);
const CLIENT_ID = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
const CLIENT_SECRET = process.env.SHARETRIBE_SDK_CLIENT_SECRET;
const BASE_URL = process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL;

const fail = message => {
  console.error(message); // eslint-disable-line no-console
  process.exit(1);
};

if (!listingId) fail('Usage: node scripts/promo-line-item-spike.js <listing-id> [percent]');
if (!CLIENT_ID || !CLIENT_SECRET || CLIENT_SECRET.startsWith('op://')) {
  fail(
    'Run it through: op run --env-file=.env -- node scripts/promo-line-item-spike.js <listing-id>'
  );
}
if (percentOff > MAX_PERCENT_OFF) fail(`Use ${MAX_PERCENT_OFF} or less.`);

const ask = (question, { hidden = false } = {}) =>
  new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Do not echo the password as it is typed.
      rl._writeToOutput = text => {
        if (text.includes(question)) process.stdout.write(text);
      };
    }
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });

const money = m => (m ? `${(m.amount / 100).toFixed(2)} ${m.currency}` : 'n/a');

(async () => {
  const baseUrlMaybe = BASE_URL ? { baseUrl: BASE_URL } : {};
  const tokenStore = sharetribeSdk.tokenStore.memoryStore();
  const sdk = sharetribeSdk.createInstance({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    tokenStore,
    ...baseUrlMaybe,
  });

  const username = await ask('Test client email: ');
  const password = await ask('Password (hidden): ', { hidden: true });
  await sdk.login({ username, password });

  const trustedToken = (await sdk.exchangeToken()).data;
  const trustedStore = sharetribeSdk.tokenStore.memoryStore();
  trustedStore.setToken(trustedToken);
  const trustedSdk = sharetribeSdk.createInstance({
    clientId: CLIENT_ID,
    tokenStore: trustedStore,
    ...baseUrlMaybe,
  });

  const listing = (await sdk.listings.show({ id: listingId })).data.data;
  const { priceVariants, transactionProcessAlias } = listing.attributes.publicData;
  const variant = (priceVariants || [])[0];
  const minutes =
    variant && Number.isFinite(variant.bookingLengthInMinutes)
      ? variant.bookingLengthInMinutes
      : 60;
  const bookingStart = new Date(Date.now() + 4 * 24 * 3600 * 1000);
  bookingStart.setUTCMinutes(0, 0, 0);
  const bookingEnd = new Date(bookingStart.getTime() + minutes * 60 * 1000);

  const orderData = {
    bookingStart: bookingStart.toISOString(),
    bookingEnd: bookingEnd.toISOString(),
    ...(variant ? { priceVariantName: variant.name } : {}),
  };
  const lineItems = transactionLineItems(listing, orderData, { percentage: 20 }, undefined, {
    code: 'SPIKE',
    percentOff,
  });
  console.log('Line items we send:'); // eslint-disable-line no-console
  constructValidLineItems(lineItems).forEach(li =>
    console.log(
      // eslint-disable-line no-console
      `  ${li.code}  ${money(li.lineTotal)}  for ${li.includeFor.join('+')}`
    )
  );

  const response = await trustedSdk.transactions.initiateSpeculative(
    {
      processAlias: transactionProcessAlias,
      transition: 'transition/request-payment',
      params: {
        listingId: listing.id,
        bookingStart,
        bookingEnd,
        cardToken: 'spike_speculative_card_token',
        lineItems,
        metadata: { promo: { code: 'SPIKE', percentOff } },
      },
    },
    { expand: true }
  );
  const tx = response.data.data.attributes;
  console.log('SHARETRIBE ACCEPTED IT. Nothing was created.'); // eslint-disable-line no-console
  console.log(`  payinTotal  (client pays):  ${money(tx.payinTotal)}`); // eslint-disable-line no-console
  console.log(`  payoutTotal (coach is paid): ${money(tx.payoutTotal)}`); // eslint-disable-line no-console
  console.log(
    // eslint-disable-line no-console
    `  Revie keeps (payin - payout): ${money({
      amount: tx.payinTotal.amount - tx.payoutTotal.amount,
      currency: tx.payinTotal.currency,
    })}`
  );
  console.log('  lines Sharetribe returned:'); // eslint-disable-line no-console
  tx.lineItems.forEach(
    li => console.log(`    ${li.code}  ${money(li.lineTotal)}  for ${li.includeFor.join('+')}`) // eslint-disable-line no-console
  );
})().catch(e => {
  const detail = e.data && e.data.errors ? JSON.stringify(e.data.errors) : '';
  fail(`SHARETRIBE REFUSED or the spike failed: ${e.message} ${detail}`);
});
