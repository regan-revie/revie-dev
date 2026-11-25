import React, { useEffect } from 'react';
import Decimal from 'decimal.js';
import { useIntl } from 'react-intl';

import { types as sdkTypes } from '../../util/sdkLoader';
import { useConfiguration } from '../../context/configurationContext';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import {
  createCurrentUser,
  createListing,
  createTransaction,
  createUser,
} from '../../util/testData';
import { withPhoto } from '../../components/CoachPhoto/CoachPhoto.fixture';

import CheckoutPageWithPayment from './CheckoutPageWithPayment';

const { Money } = sdkTypes;
const noop = () => null;

/**
 * Styleguide examples for the redesigned checkout (docs/design/checkout/), with a made-up coach,
 * session and price, so the page can be checked at desktop and phone widths without a signed-in
 * account, a booking or a card. Open one as /styleguide/c/CheckoutPage/<Name>?bare=1 for the page
 * without the styleguide around it. Sample content only; nothing here is real data.
 */

const START = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
START.setUTCHours(10, 0, 0, 0);
const END = new Date(START.getTime() + 60 * 60 * 1000);

const author = {
  ...createUser('example-coach', {
    profile: {
      displayName: 'Maya R.',
      abbreviatedName: 'MR',
      publicData: { pronouns: 'she-her' },
    },
  }),
  profileImage: withPhoto(),
};

const authorNoPhoto = { ...author, profileImage: undefined };

const listingFor = a =>
  createListing(
    'example-session',
    {
      title: 'Get clear on your next career move, then make it.',
      publicData: { transactionProcessAlias: 'default-booking/release-1', unitType: 'fixed' },
    },
    { author: a }
  );

const listing = listingFor(author);

const sessionLine = {
  code: 'line-item/fixed',
  includeFor: ['customer', 'provider'],
  quantity: new Decimal(1),
  unitPrice: new Money(11000, 'USD'),
  lineTotal: new Money(11000, 'USD'),
  reversal: false,
};
const providerCommission = {
  code: 'line-item/provider-commission',
  includeFor: ['provider'],
  unitPrice: new Money(11000, 'USD'),
  percentage: new Decimal(-20),
  lineTotal: new Money(-2200, 'USD'),
  reversal: false,
};
const promoLine = {
  code: 'line-item/promo-discount',
  includeFor: ['customer'],
  quantity: new Decimal(1),
  unitPrice: new Money(-1650, 'USD'),
  lineTotal: new Money(-1650, 'USD'),
  reversal: false,
};

// With ?bare=1 in the page URL the styleguide's own frame is hidden, so the page can be
// screenshotted on its own.
const useBareStyleguide = () =>
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get('bare')) {
      return;
    }
    const nav = document.querySelector('[class*="StyleguidePage_navBar"]');
    const main = document.querySelector('[class*="StyleguidePage_main"]');
    const root = document.querySelector('#styleguide');
    const heading = document.querySelector('[class*="contentHeading"]');
    if (nav) nav.style.display = 'none';
    if (heading) heading.style.display = 'none';
    if (main) main.style.cssText = 'width:100%;max-width:none;margin:0;padding:0;flex:1 1 100%';
    if (root) {
      root.style.display = 'block';
      root.style.padding = '0';
    }
  }, []);

const Page = ({ promo, hours, noPhoto, ...extra }) => {
  useBareStyleguide();
  const intl = useIntl();
  const config = useConfiguration();
  const routeConfiguration = useRouteConfiguration();
  const pageListing = noPhoto ? listingFor(authorNoPhoto) : listing;
  // A session `hours` from now, on the hour; the default is the nine-days-out one above.
  const start = hours
    ? new Date(Math.ceil((Date.now() + hours * 3600000) / 3600000) * 3600000)
    : START;
  const end = hours ? new Date(start.getTime() + 3600000) : END;
  const lineItems = promo
    ? [sessionLine, promoLine, providerCommission]
    : [sessionLine, providerCommission];
  const total = promo ? new Money(9350, 'USD') : new Money(11000, 'USD');
  return (
    <CheckoutPageWithPayment
      dispatch={noop}
      history={{ push: noop }}
      intl={intl}
      currentUser={createCurrentUser('example-client')}
      fetchStripeCustomer={noop}
      stripeCustomerFetched={true}
      fetchSpeculatedTransaction={noop}
      setPageData={noop}
      sessionStorageKey="CheckoutPage.example"
      speculateTransactionInProgress={false}
      scrollingDisabled={false}
      onConfirmPayment={noop}
      onConfirmCardPayment={noop}
      onInitiateOrder={noop}
      onRetrievePaymentIntent={noop}
      onSavePaymentMethod={noop}
      config={config}
      routeConfiguration={routeConfiguration}
      pageData={{
        orderData: {
          bookingDates: { bookingStart: start, bookingEnd: end },
          priceVariantName: '60 minutes',
          ...(promo ? { promoCode: 'NEWYEAR15', promoPercent: 15 } : {}),
        },
        listing: pageListing,
      }}
      processName="default-booking"
      listingTitle={pageListing.attributes.title}
      title="Complete your booking"
      speculatedTransaction={createTransaction({ id: 'example-tx', lineItems, total })}
      {...extra}
    />
  );
};

const Plain = () => <Page />;
const NoPhoto = () => <Page noPhoto />;
const Inside48 = () => <Page hours={30} />;
const WithPromo = () => <Page promo />;
const Declined = () => (
  <Page confirmCardPaymentError={{ type: 'card_error', code: 'card_declined' }} />
);
const NoConnection = () => (
  <Page initiateOrderError={{ type: 'error', name: 'TypeError', message: 'Failed to fetch' }} />
);

export const Checkout = { component: Plain, props: {}, group: 'checkout' };
// The coach has no photo: her initials in the lavender capsule.
export const CheckoutNoPhoto = { component: NoPhoto, props: {}, group: 'checkout' };
// The session is 30 hours away: the orange "less than 48 hours" box.
export const CheckoutInside48 = { component: Inside48, props: {}, group: 'checkout' };
export const CheckoutWithPromo = { component: WithPromo, props: {}, group: 'checkout' };
export const CheckoutCardDeclined = { component: Declined, props: {}, group: 'checkout' };
export const CheckoutNoConnection = { component: NoConnection, props: {}, group: 'checkout' };
