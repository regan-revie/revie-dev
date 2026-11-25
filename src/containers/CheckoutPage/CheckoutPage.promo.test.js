import React from 'react';
import '@testing-library/jest-dom';
import Decimal from 'decimal.js';

import enMessages from '../../translations/en.json';
import { types as sdkTypes } from '../../util/sdkLoader';
import {
  createCurrentUser,
  createImage,
  createListing,
  createTransaction,
  createUser,
  fakeIntl,
} from '../../util/testData';
import {
  renderWithProviders as render,
  testingLibrary,
  getDefaultConfiguration,
} from '../../util/testHelpers';
import configureStore from '../../store';
import { promoRefusalReason } from '../../util/errors';

import CheckoutPageWithPayment from './CheckoutPageWithPayment';
import PromoCodeSection from './PromoCodeSection/PromoCodeSection';
import { initiateOrder, speculateTransaction } from './CheckoutPage.duck';

jest.mock('../../util/api', () => ({
  ...jest.requireActual('../../util/api'),
  promoCheck: jest.fn(),
  initiatePrivileged: jest.fn(),
  transitionPrivileged: jest.fn(),
}));
const api = require('../../util/api');

const { Money, UUID } = sdkTypes;
const { screen, userEvent, waitFor } = testingLibrary;
const noop = () => null;

// The real wording, so the tests read what the client reads.
const messages = {
  'CheckoutPage.promo.haveCode': enMessages['CheckoutPage.promo.haveCode'],
  'CheckoutPage.promo.apply': enMessages['CheckoutPage.promo.apply'],
  'CheckoutPage.promo.inputLabel': enMessages['CheckoutPage.promo.inputLabel'],
  'CheckoutPage.promo.remove': enMessages['CheckoutPage.promo.remove'],
  'CheckoutPage.promo.applied': enMessages['CheckoutPage.promo.applied'],
  'CheckoutPage.promo.continueWithoutCode': enMessages['CheckoutPage.promo.continueWithoutCode'],
  ...Object.fromEntries(
    Object.keys(enMessages)
      .filter(k => k.startsWith('CheckoutPage.promo.error.'))
      .map(k => [k, enMessages[k]])
  ),
};

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

describe('PromoCodeSection', () => {
  const setup = (props = {}) => {
    const onApply = jest.fn(async () => ({}));
    const onRemove = jest.fn();
    render(<PromoCodeSection onApply={onApply} onRemove={onRemove} {...props} />, { messages });
    return { onApply, onRemove };
  };

  it('starts as a "Have a code?" link and opens a field with an Apply button', async () => {
    setup();
    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Have a code?' }));
    expect(screen.getByRole('textbox', { name: 'Promo code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('sends what was typed to be checked', async () => {
    const { onApply } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Have a code?' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Promo code' }), 'newyear15');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith('newyear15');
  });

  it.each([
    ['expired', 'That code has expired.'],
    ['first-session-only', 'This code is for your first session only.'],
    ['invalid', "That code isn't valid."],
    ['used-up', 'That code has been fully used.'],
    ['already-used', "You've already used this code."],
  ])('says it kindly when the code is refused: %s', async (reason, text) => {
    const { onApply } = setup();
    onApply.mockResolvedValue({ reason });
    await userEvent.click(screen.getByRole('button', { name: 'Have a code?' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Promo code' }), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('falls back to a generic "try again" for a reason it has no wording for', async () => {
    const { onApply } = setup();
    onApply.mockResolvedValue({ reason: 'something-new' });
    await userEvent.click(screen.getByRole('button', { name: 'Have a code?' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Promo code' }), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't check that code/);
  });

  it('shows an applied code with a Remove button', async () => {
    const { onRemove } = setup({ appliedCode: 'NEWYEAR15', appliedPercent: 15 });
    expect(screen.getByTestId('promoApplied')).toHaveTextContent('Promo discount (NEWYEAR15)');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('shows the discount as money beside the line, and has no Remove once the price is fixed', () => {
    setup({ appliedCode: 'NEWYEAR15', discountText: '−$15.00', onRemove: undefined });
    expect(screen.getByTestId('promoDiscount')).toHaveTextContent('−$15.00');
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('when the server refuses an applied code later, says why and offers to carry on without it', async () => {
    const { onRemove } = setup({ appliedCode: 'NEWYEAR15', refusedReason: 'expired' });
    expect(screen.getByRole('alert')).toHaveTextContent('That code has expired.');
    await userEvent.click(screen.getByRole('button', { name: 'Continue without the code' }));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('the checkout page and promo codes', () => {
  const lineItems = [
    {
      code: 'line-item/fixed',
      includeFor: ['customer', 'provider'],
      quantity: new Decimal(1),
      unitPrice: new Money(10000, 'USD'),
      lineTotal: new Money(10000, 'USD'),
      reversal: false,
    },
    {
      code: 'line-item/provider-commission',
      includeFor: ['provider'],
      unitPrice: new Money(10000, 'USD'),
      percentage: new Decimal(-20),
      lineTotal: new Money(-2000, 'USD'),
      reversal: false,
    },
  ];
  const bookingListing = createListing(
    'listing1',
    { publicData: { transactionProcessAlias: 'default-booking/release-1', unitType: 'fixed' } },
    { author: createUser('author'), images: [createImage('first-image')] }
  );
  const purchaseListing = createListing(
    'listing2',
    { publicData: { transactionProcessAlias: 'default-purchase/release-1', unitType: 'item' } },
    { author: createUser('author'), images: [createImage('first-image')] }
  );

  const propsFor = ({
    listing = bookingListing,
    processName = 'default-booking',
    ...extra
  } = {}) => ({
    dispatch: noop,
    history: { push: noop, action: 'PUSH' },
    intl: fakeIntl,
    currentUser: createCurrentUser('currentUser'),
    params: { id: 'listing1', slug: 'listing1' },
    fetchStripeCustomer: noop,
    stripeCustomerFetched: true,
    fetchSpeculatedTransaction: jest.fn(),
    setPageData: jest.fn(),
    sessionStorageKey: 'CheckoutPage.test',
    speculateTransactionInProgress: false,
    scrollingDisabled: false,
    onConfirmPayment: noop,
    onConfirmCardPayment: noop,
    onInitiateOrder: noop,
    onRetrievePaymentIntent: noop,
    onSavePaymentMethod: noop,
    config: getDefaultConfiguration(),
    routeConfiguration: [{ path: '/', name: 'LandingPage', component: () => <div /> }],
    pageData: { orderData: { bookingDates: undefined }, listing },
    processName,
    listingTitle: listing.attributes.title,
    title: 'Checkout',
    speculatedTransaction: createTransaction({
      id: 'tx1',
      lineItems,
      total: new Money(10000, 'USD'),
    }),
    ...extra,
  });

  it('offers "Have a code?" for a booking, and not for anything else', () => {
    render(<CheckoutPageWithPayment {...propsFor()} />, { messages });
    expect(screen.getByRole('button', { name: 'Have a code?' })).toBeInTheDocument();
  });

  it('does not offer a code for a purchase', () => {
    render(
      <CheckoutPageWithPayment
        {...propsFor({ listing: purchaseListing, processName: 'default-purchase' })}
      />,
      { messages }
    );
    expect(screen.queryByRole('button', { name: 'Have a code?' })).toBeNull();
  });

  it('does not offer one once the booking has started: its price is fixed by then', () => {
    const started = createTransaction({ id: 'tx9', lineItems, total: new Money(10000, 'USD') });
    const props = propsFor();
    render(
      <CheckoutPageWithPayment {...props} pageData={{ ...props.pageData, transaction: started }} />,
      { messages }
    );
    expect(screen.queryByRole('button', { name: 'Have a code?' })).toBeNull();
  });

  it('applying a good code stores it with the page and asks the server for a new price with it', async () => {
    api.promoCheck.mockResolvedValue({ ok: true, code: 'NEWYEAR15', percentOff: 15 });
    const props = propsFor();
    render(<CheckoutPageWithPayment {...props} />, { messages });

    await userEvent.click(screen.getByRole('button', { name: 'Have a code?' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Promo code' }), 'newyear15');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(props.fetchSpeculatedTransaction).toHaveBeenCalledTimes(1));
    expect(api.promoCheck).toHaveBeenCalledWith({ code: 'newyear15' });
    // The new price is asked for with the code in the order parameters (the server applies it).
    expect(props.fetchSpeculatedTransaction.mock.calls[0][0].promoCode).toBe('NEWYEAR15');
    // And kept with the page, so a refresh keeps it.
    expect(props.setPageData.mock.calls[0][0].orderData).toMatchObject({
      promoCode: 'NEWYEAR15',
      promoPercent: 15,
    });
  });

  it('a refused code shows its reason and changes nothing', async () => {
    api.promoCheck.mockResolvedValue({ ok: false, reason: 'first-session-only' });
    const props = propsFor();
    render(<CheckoutPageWithPayment {...props} />, { messages });

    await userEvent.click(screen.getByRole('button', { name: 'Have a code?' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Promo code' }), 'welcome10');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This code is for your first session only.'
    );
    expect(props.fetchSpeculatedTransaction).not.toHaveBeenCalled();
    expect(props.setPageData).not.toHaveBeenCalled();
  });

  it('a failed check (server down) says so rather than applying anything', async () => {
    api.promoCheck.mockRejectedValue(new Error('network'));
    const props = propsFor();
    render(<CheckoutPageWithPayment {...props} />, { messages });

    await userEvent.click(screen.getByRole('button', { name: 'Have a code?' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Promo code' }), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't check that code/);
    expect(props.fetchSpeculatedTransaction).not.toHaveBeenCalled();
  });

  it('removing a code asks for the full price again', async () => {
    const props = propsFor();
    props.pageData = {
      ...props.pageData,
      orderData: { promoCode: 'NEWYEAR15', promoPercent: 15 },
    };
    render(<CheckoutPageWithPayment {...props} />, { messages });

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(props.fetchSpeculatedTransaction).toHaveBeenCalledTimes(1);
    expect(props.fetchSpeculatedTransaction.mock.calls[0][0].promoCode).toBeUndefined();
    expect(props.setPageData.mock.calls[0][0].orderData.promoCode).toBeUndefined();
  });

  it('shows a refusal from the server (the code expired meanwhile) with a way to continue without it', () => {
    const props = propsFor({
      speculatedTransaction: null,
      speculateTransactionError: {
        type: 'error',
        status: 400,
        apiErrors: [{ status: 400, code: 'promo-expired' }],
      },
    });
    props.pageData = { ...props.pageData, orderData: { promoCode: 'NEWYEAR15' } };
    render(<CheckoutPageWithPayment {...props} />, { messages });
    expect(screen.getByTestId('promoRefused')).toHaveTextContent('That code has expired.');
    expect(screen.getByRole('button', { name: 'Continue without the code' })).toBeInTheDocument();
  });
});

describe('the code reaches the server, and only the server', () => {
  const orderParams = {
    listingId: new UUID('listing1'),
    bookingDates: { bookingStart: new Date(), bookingEnd: new Date() },
    promoCode: 'NEWYEAR15',
    protectedData: {},
  };
  const response = {
    data: { data: { id: new UUID('tx1'), type: 'transaction', attributes: {} }, included: [] },
  };
  const store = () => configureStore({ sdk: {} });

  it('a price preview sends it as server-only order data, not as a booking parameter', async () => {
    api.initiatePrivileged.mockResolvedValue(response);
    await store().dispatch(
      speculateTransaction(
        orderParams,
        'default-booking/release-7',
        null,
        'transition/request-payment',
        true
      )
    );
    const body = api.initiatePrivileged.mock.calls[0][0];
    expect(body.isSpeculative).toBe(true);
    expect(body.orderData.promoCode).toBe('NEWYEAR15');
    expect(body.bodyParams.params.promoCode).toBeUndefined();
  });

  it('the real booking does the same', async () => {
    api.initiatePrivileged.mockResolvedValue(response);
    await store().dispatch(
      initiateOrder(
        orderParams,
        'default-booking/release-7',
        null,
        'transition/request-payment',
        true
      )
    );
    const body = api.initiatePrivileged.mock.calls[0][0];
    expect(body.isSpeculative).toBe(false);
    expect(body.orderData.promoCode).toBe('NEWYEAR15');
    expect(body.bodyParams.params.promoCode).toBeUndefined();
  });

  it('with no code, neither carries one', async () => {
    api.initiatePrivileged.mockResolvedValue(response);
    const { promoCode, ...withoutCode } = orderParams;
    await store().dispatch(
      initiateOrder(
        withoutCode,
        'default-booking/release-7',
        null,
        'transition/request-payment',
        true
      )
    );
    expect(api.initiatePrivileged.mock.calls[0][0].orderData.promoCode).toBeUndefined();
  });

  it('a refused code is kept as the order error with its reason, and a new price clears it', async () => {
    api.initiatePrivileged.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        status: 400,
        statusText: 'promo-expired',
        data: { errors: [{ status: 400, code: 'promo-expired' }] },
      })
    );
    const s = store();
    // A refused booking rejects; the error is also kept in the store for the page to read.
    await s
      .dispatch(
        initiateOrder(
          orderParams,
          'default-booking/release-7',
          null,
          'transition/request-payment',
          true
        )
      )
      .catch(() => null);
    expect(promoRefusalReason(s.getState().CheckoutPage.initiateOrderError)).toBe('expired');

    api.initiatePrivileged.mockResolvedValue(response);
    const { promoCode, ...withoutCode } = orderParams;
    await s.dispatch(
      speculateTransaction(
        withoutCode,
        'default-booking/release-7',
        null,
        'transition/request-payment',
        true
      )
    );
    expect(s.getState().CheckoutPage.initiateOrderError).toBeNull();
  });
});

describe('promoRefusalReason', () => {
  it('reads the reason from a refused-code error, and nothing from any other error', () => {
    expect(promoRefusalReason({ apiErrors: [{ code: 'promo-first-session-only' }] })).toBe(
      'first-session-only'
    );
    expect(
      promoRefusalReason({ apiErrors: [{ code: 'transaction-listing-not-found' }] })
    ).toBeNull();
    expect(promoRefusalReason(null)).toBeNull();
    expect(promoRefusalReason({})).toBeNull();
  });
});
