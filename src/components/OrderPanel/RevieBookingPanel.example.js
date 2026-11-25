import React from 'react';

import { withStubbedFetch } from '../../util/stubFetchForExamples';
import { createUser, createListing } from '../../util/testData';

import NylasBookingForm from './NylasBookingForm/NylasBookingForm';
import RevieBookingPanel, { PANEL_STATES } from './RevieBookingPanel';

/**
 * Styleguide examples for the session's booking side (docs/design/session-page/ Main, PhoneSheet,
 * States). Fixture times and a made-up coach, so every state can be looked at without an account.
 * The panel is a card from 1024px up and a bar plus a sheet below it: resize the window to see
 * both, or open "Phone sheet" at phone width.
 */

const slots = (minutes = 60, firstDay = 3) => {
  const out = [];
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  for (let d = firstDay; d < 40; d += 1) {
    const date = new Date(day.getTime() + d * 86400000);
    // (With firstDay 1 every day is offered, so a time inside the 48 hours is always there.)
    if (firstDay >= 3 && ([0, 6].includes(date.getDay()) || d % 5 === 4)) continue;
    for (let m = 9 * 60; m + minutes <= 17 * 60; m += 60) {
      const start = date.getTime() + m * 60000;
      out.push({ start, end: start + minutes * 60000 });
    }
  }
  return out;
};

const coach = pronouns =>
  createUser('example-coach', {
    profile: { displayName: 'Maya R.', abbreviatedName: 'MR', publicData: { pronouns } },
  });

const priceVariants = [
  { name: '30-minute session', bookingLengthInMinutes: 30, priceInSubunits: 6000 },
  { name: '60-minute session', bookingLengthInMinutes: 60, priceInSubunits: 11000 },
  { name: '90-minute session', bookingLengthInMinutes: 90, priceInSubunits: 15000 },
];
const price = { amount: 6000, currency: 'USD' };

const lengthOf = url => {
  const match = String(url).match(/priceVariantName=([^&]+)/);
  const name = match ? decodeURIComponent(match[1]) : '';
  return parseInt(name, 10) || 60;
};

const props = (state, extra = {}) => ({
  state,
  listing: createListing('example-session', { publicData: { calendarBookingEnabled: true } }),
  author: coach('she-her'),
  isOwnListing: false,
  price,
  priceVariants,
  BookingForm: NylasBookingForm,
  bookingFormProps: {
    listingId: 'example-session',
    isOwnListing: false,
    isPriceVariationsInUse: true,
    priceVariants,
    price,
    marketplaceName: 'Revie',
    onSubmit: values => console.log('submit', values),
    onFetchTransactionLineItems: () => {},
  },
  setupCardProps: {
    calendarConnected: false,
    payoutDetailsSet: false,
    profileFinished: undefined,
  },
  onContactUser: user => console.log('message', user?.id?.uuid),
  isOrderOpen: false,
  onOpenOrder: () => console.log('open sheet'),
  onCloseOrder: () => console.log('close sheet'),
  onManageDisableScrolling: () => {},
  ...extra,
});

const Stubbed = withStubbedFetch(RevieBookingPanel, {
  '/api/nylas/availability': url => ({ slots: slots(lengthOf(url)), connected: true }),
});

// Times from tomorrow on, so one inside the 48 hours can be picked.
const StubbedSoon = withStubbedFetch(RevieBookingPanel, {
  '/api/nylas/availability': url => ({ slots: slots(lengthOf(url), 1), connected: true }),
});

const Narrow = ({ children }) => (
  <div style={{ maxWidth: 400, margin: '24px auto' }}>{children}</div>
);

const Panel = () => (
  <Narrow>
    <Stubbed {...props(PANEL_STATES.FORM)} />
  </Narrow>
);
const PanelSoon = () => (
  <Narrow>
    <StubbedSoon {...props(PANEL_STATES.FORM)} />
  </Narrow>
);
const PhoneSheet = () => <Stubbed {...props(PANEL_STATES.FORM, { isOrderOpen: true })} />;
const ClientCannotBook = () => (
  <Narrow>
    <Stubbed {...props(PANEL_STATES.NOT_TAKING)} />
  </Narrow>
);
const ClientCannotBookTheyThem = () => (
  <Narrow>
    <Stubbed {...props(PANEL_STATES.NOT_TAKING, { author: coach('they-them') })} />
  </Narrow>
);
const CoachSetup = () => (
  <Narrow>
    <Stubbed
      {...props(PANEL_STATES.SETUP, {
        isOwnListing: true,
        setupCardProps: {
          calendarConnected: true,
          payoutDetailsSet: false,
          profileFinished: undefined,
        },
      })}
    />
  </Narrow>
);
const CoachSetupAll = () => (
  <Narrow>
    <Stubbed
      {...props(PANEL_STATES.SETUP, {
        isOwnListing: true,
        setupCardProps: {
          calendarConnected: false,
          payoutDetailsSet: false,
          profileFinished: false,
        },
      })}
    />
  </Narrow>
);
const CoachReconnect = () => (
  <Narrow>
    <Stubbed
      {...props(PANEL_STATES.SETUP, {
        isOwnListing: true,
        setupCardProps: {
          calendarConnected: false,
          calendarReconnectNeeded: true,
          payoutDetailsSet: true,
          profileFinished: undefined,
        },
      })}
    />
  </Narrow>
);

export const BookingPanelAndPhoneBar = { component: Panel, props: {}, group: 'booking' };
// Times from tomorrow: pick one less than 48 hours away to see its fine print.
export const BookingPanelTimesSoon = { component: PanelSoon, props: {}, group: 'booking' };
export const BookingPhoneSheet = { component: PhoneSheet, props: {}, group: 'booking' };
export const CannotBookClient = { component: ClientCannotBook, props: {}, group: 'booking' };
export const CannotBookClientTheyThem = {
  component: ClientCannotBookTheyThem,
  props: {},
  group: 'booking',
};
export const CannotBookCoachOneStep = { component: CoachSetup, props: {}, group: 'booking' };
export const CannotBookCoachThreeSteps = { component: CoachSetupAll, props: {}, group: 'booking' };
export const CannotBookCoachReconnect = { component: CoachReconnect, props: {}, group: 'booking' };
