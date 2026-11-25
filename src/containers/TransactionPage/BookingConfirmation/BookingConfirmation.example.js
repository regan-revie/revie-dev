import React, { useEffect } from 'react';
import Decimal from 'decimal.js';

import { types as sdkTypes } from '../../../util/sdkLoader';
import {
  createBooking,
  createCurrentUser,
  createListing,
  createMessage,
  createTransaction,
  createUser,
} from '../../../util/testData';
import { withStubbedFetch } from '../../../util/stubFetchForExamples';
import { withPhoto } from '../../../components/CoachPhoto/CoachPhoto.fixture';
import SessionTopbar from '../../ListingPage/SessionPage/SessionTopbar';

import BookingConfirmation from './BookingConfirmation';

const { Money } = sdkTypes;
const noop = () => null;
const HOUR = 3600000;

/**
 * Styleguide examples for the client's booking page (docs/design/booking-confirmation/), with a
 * made-up coach, session and price, so each state can be checked at desktop and phone widths
 * without a booking or a login. Open one as /styleguide/c/BookingConfirmation/<Name>?bare=1 for
 * the page without the styleguide around it. Sample content only; nothing here is real data.
 */

const coach = {
  ...createUser('example-coach', {
    profile: { displayName: 'Maya R.', abbreviatedName: 'MR', publicData: { pronouns: 'she-her' } },
  }),
  profileImage: withPhoto(),
};
const client = createCurrentUser('example-client', {
  profile: { firstName: 'Jess', lastName: 'Lee', displayName: 'Jess L.', abbreviatedName: 'JL' },
});

const listingWith = publicData =>
  createListing(
    'example-session',
    {
      title: 'Get clear on your next career move, then make it.',
      publicData: {
        listingType: 'signature-session',
        transactionProcessAlias: 'default-booking/release-7',
        unitType: 'fixed',
        calendarBookingEnabled: true,
        ...publicData,
      },
    },
    { author: coach }
  );

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

// Sessions start in whole hours, a few days out (or hours out, inside the free window).
const startIn = hours => {
  const start = new Date(Math.ceil((Date.now() + hours * HOUR) / HOUR) * HOUR);
  return { start, end: new Date(start.getTime() + HOUR) };
};

const transactionFor = ({ hours = 120, promo = false, metadata = {}, protectedData = {} } = {}) => {
  const { start, end } = startIn(hours);
  const tx = createTransaction({
    id: 'example-tx',
    processName: 'default-booking',
    booking: createBooking('example-booking', { start, end }),
    lineItems: promo
      ? [sessionLine, promoLine, providerCommission]
      : [sessionLine, providerCommission],
    total: promo ? new Money(9350, 'USD') : new Money(11000, 'USD'),
  });
  return {
    ...tx,
    attributes: {
      ...tx.attributes,
      metadata: { ...(promo ? { promo: { code: 'NEWYEAR15' } } : {}), ...metadata },
      protectedData,
    },
  };
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

const message = (id, content, sender) => createMessage(id, { content }, { sender });

const Page = ({
  hours = 120,
  processState = 'accepted',
  publicData,
  withTopbar = true,
  ...extra
}) => {
  useBareStyleguide();
  const transaction = transactionFor({ hours, ...extra });
  return (
    <div>
      {withTopbar ? <SessionTopbar /> : null}
      <BookingConfirmation
        transaction={transaction}
        listing={listingWith(publicData)}
        provider={coach}
        currentUser={client}
        processState={processState}
        messages={[
          message(
            'm1',
            "Hi Maya! Excited for this. I'll come with the promotion question.",
            client
          ),
          message('m2', "Perfect. Questionnaire's in your inbox. See you Thursday!", coach),
        ]}
        showSendMessageForm
        onMessageSubmit={noop}
        sendMessageInProgress={false}
        onCancelledOnCalendar={noop}
      />
    </div>
  );
};

const stubbed = (Component, hours = 120) => {
  const { start, end } = startIn(hours);
  // Free times for the reschedule picker: three a day for the next three weeks, a session long.
  const slots = [];
  for (let day = 4; day < 25; day += 1) {
    [9, 11, 14].forEach(hour => {
      const s = new Date();
      s.setDate(s.getDate() + day);
      s.setHours(hour, 0, 0, 0);
      slots.push({ start: s.getTime(), end: s.getTime() + HOUR });
    });
  }
  return withStubbedFetch(Component, {
    '/api/nylas/booking-status': {
      source: 'database',
      status: 'created',
      bookingStart: start.toISOString(),
      bookingEnd: end.toISOString(),
      freeCancellationNow: hours >= 48,
      rescheduleAllowed: hours >= 48,
      cancellationPending: false,
      meetLink: 'https://meet.google.com/abc-defg',
      calendarUrl: 'https://example.com/revie-session.ics',
    },
    '/api/nylas/availability': { slots, connected: true },
    '/api/nylas/cancel-booking': { ok: true },
    '/api/nylas/reschedule-booking': { ok: true },
  });
};

const PREP = {
  pre_work:
    'Think about the one decision you keep putting off, and what you are afraid it says about you.',
  prep_link: 'https://form.typeform.com/to/abc123',
};

const group = 'booking page';
export const BookedWithPrep = {
  component: stubbed(props => <Page {...props} publicData={PREP} promo />),
  props: {},
  group,
};
export const BookedNoPrep = { component: stubbed(props => <Page {...props} />), props: {}, group };
export const BookedInsideFreeWindow = {
  component: stubbed(props => <Page {...props} hours={30} publicData={PREP} />, 30),
  props: {},
  group,
};
export const Confirming = {
  component: props => <Page {...props} processState="preauthorized" />,
  props: {},
  group,
};
export const DidntGoThrough = {
  component: props => <Page {...props} processState="declined" />,
  props: {},
  group,
};
export const CancelledRefunded = {
  component: props => (
    <Page {...props} processState="canceled" metadata={{ cancelledBy: 'client' }} />
  ),
  props: {},
  group,
};
export const CancelledLate = {
  component: props => <Page {...props} processState="late-cancelled" hours={20} />,
  props: {},
  group,
};
export const CancelledByCoach = {
  component: props => (
    <Page {...props} processState="canceled" metadata={{ cancelledBy: 'provider' }} />
  ),
  props: {},
  group,
};
