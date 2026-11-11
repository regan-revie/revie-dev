import { mergeConfig } from '../../util/configHelpers';
import { createCurrentUser, createListing, createUser, fakeIntl } from '../../util/testData';
import { getDefaultConfiguration, getHostedConfiguration } from '../../util/testHelpers';

import { getDerivedRenderData } from './ListingPage.shared';

const hosted = getHostedConfiguration();
const config = mergeConfig(hosted, getDefaultConfiguration());
const firstBookingType = alias =>
  config.listing.listingTypes.find(t => t.transactionType.alias.startsWith(alias));

const run = ({ unitType, alias, stripeConnected, ownListing = true, listingType }) => {
  const coach = createUser('coach1');
  const currentUser = createCurrentUser('coach1', { stripeConnected });
  const listing = createListing(
    'l1',
    {
      publicData: { listingType, transactionProcessAlias: alias, unitType },
    },
    { author: ownListing ? coach : createUser('someone-else') }
  );
  return getDerivedRenderData({
    rawParams: { id: 'l1', slug: 'l1' },
    getListing: () => listing,
    getOwnListing: () => listing,
    showOwnListingsOnly: false,
    currentUser,
    config,
    intl: fakeIntl,
    location: { pathname: '/l/l1', search: '', hash: '' },
    longWordMinLength: 20,
    longWordClassName: 'long',
    payoutDetailsWarningClassName: 'warn',
  });
};

const bookingType = firstBookingType('default-booking').listingType;

describe('the stock "add your payout details" banner on the listing page', () => {
  it('is not shown on a fixed-length session: the setup card in the sidebar replaces it', () => {
    const data = run({
      unitType: 'fixed',
      alias: 'default-booking/release-4',
      listingType: bookingType,
      stripeConnected: false,
    });
    expect(data.noPayoutDetailsSetWithOwnListing).toBe(false);
    expect(data.payoutDetailsWarning).toBeNull();
  });

  it('is still shown everywhere else: another kind of booking, and a purchase', () => {
    const nightly = run({
      unitType: 'night',
      alias: 'default-booking/release-1',
      listingType: bookingType,
      stripeConnected: false,
    });
    expect(nightly.noPayoutDetailsSetWithOwnListing).toBe(true);

    const purchase = run({
      unitType: 'item',
      alias: 'default-purchase/release-1',
      listingType: config.listing.listingTypes.find(t =>
        t.transactionType.alias.startsWith('default-purchase')
      ).listingType,
      stripeConnected: false,
    });
    expect(purchase.noPayoutDetailsSetWithOwnListing).toBe(true);
  });

  it('is never shown to someone who does not own the listing', () => {
    const data = run({
      unitType: 'night',
      alias: 'default-booking/release-1',
      listingType: bookingType,
      stripeConnected: false,
      ownListing: false,
    });
    expect(data.noPayoutDetailsSetWithOwnListing).toBe(false);
  });
});
