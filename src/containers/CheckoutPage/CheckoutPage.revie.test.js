import React from 'react';
import '@testing-library/jest-dom';
import Decimal from 'decimal.js';
import { createIntl } from 'react-intl';

import enMessages from '../../translations/en.json';
import { types as sdkTypes } from '../../util/sdkLoader';
import {
  createCurrentUser,
  createImage,
  createListing,
  createTransaction,
  createUser,
} from '../../util/testData';
import {
  renderWithProviders as render,
  testingLibrary,
  getDefaultConfiguration,
} from '../../util/testHelpers';
import { getErrorMessages } from './ErrorMessages';
import { getPaymentErrorContent } from './StripePaymentForm/StripePaymentForm';
import ErrorNote from './RevieCheckout/ErrorNote';

import CheckoutPageWithPayment from './CheckoutPageWithPayment';

jest.mock('../../util/api', () => ({
  ...jest.requireActual('../../util/api'),
  promoCheck: jest.fn(),
}));

const { Money } = sdkTypes;
const { screen, within, userEvent } = testingLibrary;
const noop = () => null;

// The real wording, so the tests read what the client reads.
const messages = enMessages;

// The page formats money with the intl it is given, so the tests give it the real wording.
const intl = createIntl({ locale: 'en', messages: enMessages });

const START = new Date('2026-12-03T10:00:00.000Z');
const END = new Date('2026-12-03T11:00:00.000Z');

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
const customerFee = {
  code: 'line-item/customer-commission',
  includeFor: ['customer'],
  unitPrice: new Money(500, 'USD'),
  percentage: new Decimal(5),
  lineTotal: new Money(500, 'USD'),
  reversal: false,
};

const author = createUser('author', {
  profile: {
    displayName: 'Maya R.',
    abbreviatedName: 'MR',
    publicData: { pronouns: 'she-her' },
  },
});

const bookingListing = createListing(
  'listing1',
  {
    title: 'Get clear on your next career move, then make it.',
    publicData: { transactionProcessAlias: 'default-booking/release-1', unitType: 'fixed' },
  },
  { author, images: [createImage('first-image')] }
);

const propsFor = ({ lineItems, total, orderData, ...extra } = {}) => ({
  dispatch: noop,
  history: { push: noop, action: 'PUSH' },
  intl,
  currentUser: createCurrentUser('currentUser'),
  params: { id: 'listing1', slug: 'listing1' },
  fetchStripeCustomer: noop,
  stripeCustomerFetched: true,
  fetchSpeculatedTransaction: jest.fn(),
  setPageData: jest.fn(),
  sessionStorageKey: 'CheckoutPage.revie.test',
  speculateTransactionInProgress: false,
  scrollingDisabled: false,
  onConfirmPayment: noop,
  onConfirmCardPayment: noop,
  onInitiateOrder: noop,
  onRetrievePaymentIntent: noop,
  onSavePaymentMethod: noop,
  config: getDefaultConfiguration(),
  routeConfiguration: [
    { path: '/', name: 'LandingPage', component: () => <div /> },
    { path: '/l/:slug/:id', name: 'ListingPage', component: () => <div /> },
    { path: '/u/:id', name: 'ProfilePage', component: () => <div /> },
    { path: '/terms-of-service', name: 'TermsOfServicePage', component: () => <div /> },
  ],
  pageData: {
    orderData: {
      bookingDates: { bookingStart: START, bookingEnd: END },
      priceVariantName: '60 minutes',
      ...orderData,
    },
    listing: bookingListing,
  },
  processName: 'default-booking',
  listingTitle: bookingListing.attributes.title,
  title: 'Complete your booking',
  speculatedTransaction: createTransaction({
    id: 'tx1',
    lineItems: lineItems || [sessionLine, providerCommission],
    total: total || new Money(11000, 'USD'),
  }),
  ...extra,
});

beforeEach(() => {
  window.matchMedia = jest.fn(() => ({
    matches: true,
    addEventListener: noop,
    removeEventListener: noop,
  }));
  window.Stripe = jest.fn(() => ({
    elements: () => ({
      create: () => ({
        mount: noop,
        unmount: noop,
        update: noop,
        addEventListener: noop,
        removeEventListener: noop,
      }),
    }),
  }));
  jest.clearAllMocks();
});

describe('the checkout page: the form', () => {
  it('asks "Anything Maya should know?" with Optional, and a text box with a hidden label', () => {
    render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Complete your booking.');
    expect(
      screen.getByRole('heading', { name: /Anything Maya should know\?\s*Optional/ })
    ).toBeInTheDocument();
    // The label is for screen readers; the heading above the box is the one people see.
    expect(screen.getByLabelText('A note for Maya, optional')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'A note for Maya, optional' }).tagName).toBe(
      'TEXTAREA'
    );
  });

  it("says the coach will see the note, in the coach's pronouns (They'll with none)", () => {
    const { unmount } = render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    expect(
      screen.getByText(
        "She'll see it before your session. You can keep chatting in your inbox after you book."
      )
    ).toBeInTheDocument();
    unmount();

    const noPronouns = createListing(
      'listing1',
      { publicData: { transactionProcessAlias: 'default-booking/release-1', unitType: 'fixed' } },
      { author: createUser('author2'), images: [createImage('first-image')] }
    );
    const props = propsFor();
    render(
      <CheckoutPageWithPayment
        {...props}
        pageData={{ ...props.pageData, listing: noPronouns }}
        listingTitle="Session"
      />,
      { messages }
    );
    expect(screen.getByText(/^They'll see it before your session\./)).toBeInTheDocument();
  });

  it('has the card, the name on it, and no billing address fields', () => {
    render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    expect(screen.getByRole('heading', { name: 'Payment' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Card' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name on card' })).toBeInTheDocument();
    expect(
      screen.getByText('Payments go through Stripe. Revie never sees your card number.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Street address')).toBeNull();
    expect(screen.queryByText('Postal code')).toBeNull();
    expect(screen.queryByText('Billing details')).toBeNull();
  });

  it('has the Book button with the total, and the terms opening in a new tab', () => {
    render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    expect(screen.getByRole('button', { name: 'Book a session · $110.00' })).toBeInTheDocument();
    const terms = screen.getByRole('link', { name: 'terms' });
    expect(terms).toHaveAttribute('href', '/terms-of-service');
    expect(terms).toHaveAttribute('target', '_blank');
    expect(
      screen.getByText(/You pay now; cancel up to 48 hours before for a full refund\./)
    ).toBeInTheDocument();
  });

  it('has a slim bar with "Secure checkout" and a one-line footer, and no site navigation', () => {
    render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    expect(screen.getByText('Secure checkout')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'hello@heyrevie.com' })).toHaveAttribute(
      'href',
      'mailto:hello@heyrevie.com'
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('link', { name: /Back to the session/ })).toBeInTheDocument();
  });
});

describe('the checkout page: the summary', () => {
  it("shows the session's real details: title, coach, when, how long, price and total", () => {
    render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    const summary = screen.getByTestId('checkout-summary');
    // Bold after the last comma.
    expect(within(summary).getByTestId('summary-title')).toHaveTextContent(
      'Get clear on your next career move, then make it.'
    );
    expect(within(summary).getByText('then make it.').tagName).toBe('B');
    expect(within(summary).getByRole('link', { name: 'Maya R.' })).toBeInTheDocument();
    expect(within(summary).getByTestId('summary-when')).toHaveTextContent(/^Thu 3 Dec · .+ to .+/);
    expect(within(summary).getByText('60-minute video call on Google Meet')).toBeInTheDocument();
    expect(within(summary).getByText('60-minute session')).toBeInTheDocument();
    expect(within(summary).getByTestId('summary-session-price')).toHaveTextContent('$110.00');
    expect(within(summary).getByTestId('summary-total')).toHaveTextContent('$110.00');
    expect(within(summary).getByText(/In your timezone \(/)).toBeInTheDocument();
  });

  it('says free to cancel until 48 hours before, and that the coach cancelling refunds in full', () => {
    render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    const summary = screen.getByTestId('checkout-summary');
    expect(summary).toHaveTextContent(
      /Free to cancel until Tue 1 Dec, .+\. After that, the full price is charged\./
    );
    expect(summary).toHaveTextContent("If Maya cancels, you're refunded in full.");
  });

  it('"Find a new time" goes back to the session page keeping the length and the day', () => {
    render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    const link = screen.getByRole('link', { name: 'Find a new time' });
    const href = link.getAttribute('href');
    expect(href).toMatch(/^\/l\/.+\/listing1\?/);
    expect(href).toContain('bookableOption=60-minutes');
    expect(href).toMatch(/day=2026-12-0[34]/);
    expect(href).toContain('orderOpen=true');
  });

  it('says "No booking fees" only when the client really pays no fee', () => {
    const { unmount } = render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    expect(screen.getByText('No booking fees')).toBeInTheDocument();
    unmount();

    render(
      <CheckoutPageWithPayment
        {...propsFor({
          lineItems: [sessionLine, customerFee, providerCommission],
          total: new Money(11500, 'USD'),
        })}
      />,
      { messages }
    );
    expect(screen.queryByText('No booking fees')).toBeNull();
    expect(screen.getByTestId('summary-total')).toHaveTextContent('$115.00');
  });

  it('shows no order, request or listing wording', () => {
    render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    expect(document.body.textContent).not.toMatch(/\b(orders?|requests?|listings?)\b/i);
  });
});

describe('the summary and promo codes', () => {
  it('the promo field opens in the summary, and applying a code shows its line and the new total', () => {
    const { rerender } = render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    const summary = () => screen.getByTestId('checkout-summary');

    expect(within(summary()).getByRole('button', { name: 'Have a code?' })).toBeInTheDocument();
    expect(within(summary()).getByTestId('summary-total')).toHaveTextContent('$110.00');

    // The server answered with the code applied: its line is customer-only and the total drops.
    const withCode = propsFor({
      lineItems: [sessionLine, promoLine, providerCommission],
      total: new Money(9350, 'USD'),
      orderData: { promoCode: 'NEWYEAR15', promoPercent: 15 },
    });
    rerender(<CheckoutPageWithPayment {...withCode} />);
    expect(within(summary()).getByTestId('promoApplied')).toHaveTextContent(
      'Promo discount (NEWYEAR15)'
    );
    expect(within(summary()).getByTestId('promoDiscount')).toHaveTextContent('−$16.50');
    expect(within(summary()).getByTestId('summary-total')).toHaveTextContent('$93.50');
    // The Book button carries the new total too.
    expect(screen.getByRole('button', { name: 'Book a session · $93.50' })).toBeInTheDocument();
  });

  it('removing the code takes the line off and asks for the full price again', async () => {
    const props = propsFor({
      lineItems: [sessionLine, promoLine, providerCommission],
      total: new Money(9350, 'USD'),
      orderData: { promoCode: 'NEWYEAR15', promoPercent: 15 },
    });
    render(<CheckoutPageWithPayment {...props} />, { messages });
    await userEvent.click(
      within(screen.getByTestId('checkout-summary')).getByRole('button', { name: 'Remove' })
    );
    expect(props.fetchSpeculatedTransaction).toHaveBeenCalledTimes(1);
    expect(props.fetchSpeculatedTransaction.mock.calls[0][0].promoCode).toBeUndefined();
    expect(props.setPageData.mock.calls[0][0].orderData.promoCode).toBeUndefined();
  });

  it('once the booking has started the code is only shown: no Remove, no field', () => {
    const started = createTransaction({
      id: 'tx9',
      lineItems: [sessionLine, promoLine, providerCommission],
      total: new Money(9350, 'USD'),
    });
    const props = propsFor({ orderData: { promoCode: 'NEWYEAR15', promoPercent: 15 } });
    render(
      <CheckoutPageWithPayment {...props} pageData={{ ...props.pageData, transaction: started }} />,
      { messages }
    );
    expect(screen.getByTestId('promoApplied')).toHaveTextContent('Promo discount (NEWYEAR15)');
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Have a code?' })).toBeNull();
  });
});

describe('errors', () => {
  const renderIn = node => render(<div>{node}</div>, { messages });

  it('an error is error red, bold, with an icon (so it does not rely on colour alone)', () => {
    renderIn(<ErrorNote boxed>Something</ErrorNote>);
    const note = screen.getByRole('alert');
    expect(note).toHaveTextContent('Something');
    expect(note.querySelector('svg')).not.toBeNull();
  });

  it('a declined card says so, and that nothing was charged', () => {
    renderIn(getPaymentErrorContent({ type: 'card_error', code: 'card_declined' }, null));
    expect(
      screen.getByText("Your card was declined. You haven't been charged. Try another card.")
    ).toBeInTheDocument();
  });

  it("another card problem (an expired card) keeps Stripe's words and adds that nothing was charged", () => {
    renderIn(
      getPaymentErrorContent(
        { type: 'card_error', code: 'expired_card', message: 'Your card has expired.' },
        null
      )
    );
    expect(document.body).toHaveTextContent("Your card has expired. You haven't been charged.");
  });

  it('no connection to our servers says nothing was charged', () => {
    const networkFailure = { type: 'error', name: 'TypeError', message: 'Failed to fetch' };
    const result = getErrorMessages(false, networkFailure, false, null, null, null);
    renderIn(result.initiateOrderErrorMessage);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't reach our servers. You haven't been charged. Check your connection and try again."
    );
  });

  it('a payment that went through but could not be finished says the opposite: it was paid', () => {
    renderIn(getPaymentErrorContent(null, { type: 'error' }));
    expect(document.body).toHaveTextContent('Your payment went through');
    expect(document.body).not.toHaveTextContent("You haven't been charged");
  });

  it('shows a payment error above the Book button', () => {
    render(
      <CheckoutPageWithPayment
        {...propsFor({
          confirmCardPaymentError: { type: 'card_error', code: 'card_declined' },
        })}
      />,
      { messages }
    );
    expect(screen.getByRole('alert')).toHaveTextContent("You haven't been charged.");
  });
});

describe('wording', () => {
  // Every message that can show on the booking page: the page's own, the payment form's and the
  // promo code's. Not the template's inquiry, purchase or negotiation messages (CheckoutPage.default-*,
  // CheckoutPageWithInquiryProcess.*), which this page never shows.
  const onThePage = Object.keys(enMessages).filter(
    key =>
      (key.startsWith('CheckoutPage.') && !key.startsWith('CheckoutPage.default-')) ||
      key.startsWith('StripePaymentForm.') ||
      key.startsWith('SavedCardDetails.') ||
      key.startsWith('CheckoutPage.promo.')
  );
  // Messages kept for the template's other processes (shipping, pickup, stock, quantity).
  const notForSessions = [
    'CheckoutPage.notEnoughStockMessage',
    'CheckoutPage.incompatibleCurrency',
    'StripePaymentForm.pickupDetailsTitle',
    'StripePaymentForm.pickupLocationUnknown',
    'StripePaymentForm.locationDetailsTitle',
    'StripePaymentForm.locationUnknown',
    'StripePaymentForm.messageHeading',
    'StripePaymentForm.messageLabel',
    'StripePaymentForm.messagePlaceholder',
    'StripePaymentForm.submitConfirmPaymentFinePrint',
    'StripePaymentForm.saveAfterOnetimePayment',
    'StripePaymentForm.saveforLaterUseLegalInfo',
    'StripePaymentForm.replaceAfterOnetimePayment',
    'StripePaymentForm.payWithHeading',
    'StripePaymentForm.paymentCardDetails',
    'StripePaymentForm.billingDetails',
    'StripePaymentForm.billingDetailsNamePlaceholder',
    'CheckoutPage.bookingTimeNotAvailableMessage',
    'CheckoutPage.listingTitle',
    'CheckoutPage.providerInfo',
  ];

  it('never says order, request or listing on the booking page', () => {
    const offenders = onThePage
      .filter(key => !notForSessions.includes(key))
      .filter(key => /\b(orders?|requests?|listings?)\b/i.test(enMessages[key]))
      .map(key => `${key}: ${enMessages[key]}`);
    expect(offenders).toEqual([]);
  });
});
