import React from 'react';
import '@testing-library/jest-dom';
import Decimal from 'decimal.js';

import { types as sdkTypes } from '../../util/sdkLoader';
import { fakeIntl, createBooking } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import { getProcess, TX_TRANSITION_ACTOR_CUSTOMER } from '../../transactions/transaction';

import { OrderBreakdownComponent } from './OrderBreakdown';

const { UUID, Money } = sdkTypes;
const { screen, within } = testingLibrary;

const marketplaceName = 'MarketplaceX';

const exampleTransaction = params => {
  const transitions = getProcess('default-purchase')?.transitions;
  const created = new Date(Date.UTC(2017, 1, 1));
  return {
    id: new UUID('example-transaction'),
    type: 'transaction',
    attributes: {
      processName: 'default-purchase',
      processVersion: 1,
      createdAt: created,
      lastTransitionedAt: created,
      lastTransition: transitions.REQUEST_PAYMENT,
      transitions: [
        {
          createdAt: created,
          by: TX_TRANSITION_ACTOR_CUSTOMER,
          transition: transitions.REQUEST_PAYMENT,
        },
      ],

      // payinTotal, payoutTotal, and lineItems required in params
      ...params,
    },
  };
};

describe('OrderBreakdown', () => {
  it('shows base price, shipping fee and total to customer (product)', () => {
    render(
      <OrderBreakdownComponent
        userRole="customer"
        currency="USD"
        marketplaceName={marketplaceName}
        transaction={exampleTransaction({
          payinTotal: new Money(3000, 'USD'),
          payoutTotal: new Money(3000, 'USD'),
          lineItems: [
            {
              code: 'line-item/item',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(2),
              lineTotal: new Money(2000, 'USD'),
              unitPrice: new Money(1000, 'USD'),
              reversal: false,
            },
            {
              code: 'line-item/shipping-fee',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(1),
              unitPrice: new Money(1000, 'USD'),
              lineTotal: new Money(1000, 'USD'),
              reversal: false,
            },
          ],
        })}
        intl={fakeIntl}
      />
    );

    // Base price
    const unitPriceXQuantity = screen.getByText('OrderBreakdown.baseUnitQuantity');
    expect(unitPriceXQuantity).toBeInTheDocument();
    const lineItemBasePrice = within(unitPriceXQuantity.parentNode.parentNode);
    expect(lineItemBasePrice.getByText('20')).toBeInTheDocument();

    // Shipping fee
    const shippingFee = screen.getByText('OrderBreakdown.shippingFee');
    expect(shippingFee).toBeInTheDocument();
    const lineItemShippingFee = within(shippingFee.parentNode.parentNode);
    expect(lineItemShippingFee.getByText('10')).toBeInTheDocument();

    // Total
    const total = screen.getByText('OrderBreakdown.total');
    expect(total).toBeInTheDocument();
    const totalPayIn = within(total.parentNode.parentNode);
    expect(totalPayIn.getByText('30')).toBeInTheDocument();
  });

  it('shows base price, booking dates, customer-commission and total to customer (booking)', () => {
    render(
      <OrderBreakdownComponent
        userRole="customer"
        currency="USD"
        marketplaceName={marketplaceName}
        transaction={exampleTransaction({
          payinTotal: new Money(2200, 'USD'),
          payoutTotal: new Money(2000, 'USD'),
          lineItems: [
            {
              code: 'line-item/night',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(2),
              lineTotal: new Money(2000, 'USD'),
              unitPrice: new Money(1000, 'USD'),
              reversal: false,
            },
            {
              code: 'line-item/customer-commission',
              includeFor: ['customer'],
              lineTotal: new Money(200, 'USD'),
              unitPrice: new Money(200, 'USD'),
              reversal: false,
            },
          ],
        })}
        booking={createBooking('example-booking', {
          start: new Date(Date.UTC(2017, 3, 14)),
          end: new Date(Date.UTC(2017, 3, 16)),
        })}
        intl={fakeIntl}
        timeZone="Etc/UTC"
      />
    );

    // Booking: start
    const bookingStart = screen.getByText('OrderBreakdown.bookingStart');
    expect(bookingStart).toBeInTheDocument();
    const bookingStartInfo = within(bookingStart.parentNode.parentNode);
    expect(bookingStartInfo.getByText('Friday')).toBeInTheDocument();
    expect(bookingStartInfo.getByText('Apr 14')).toBeInTheDocument();

    // Booking: end
    const bookingEnd = screen.getByText('OrderBreakdown.bookingEnd');
    expect(bookingEnd).toBeInTheDocument();
    const bookingEndInfo = within(bookingEnd.parentNode.parentNode);
    expect(bookingEndInfo.getByText('Sunday')).toBeInTheDocument();
    expect(bookingEndInfo.getByText('Apr 16')).toBeInTheDocument();

    // Base price
    const unitPriceXQuantity = screen.getByText('OrderBreakdown.baseUnitNight');
    expect(unitPriceXQuantity).toBeInTheDocument();
    const lineItemBasePrice = within(unitPriceXQuantity.parentNode.parentNode);
    expect(lineItemBasePrice.getByText('20')).toBeInTheDocument();

    // Commission
    const commission = screen.getByText('OrderBreakdown.commission');
    expect(commission).toBeInTheDocument();
    const lineItemCommission = within(commission.parentNode.parentNode);
    expect(lineItemCommission.getByText('2')).toBeInTheDocument();

    // Total
    const total = screen.getByText('OrderBreakdown.total');
    expect(total).toBeInTheDocument();
    const totalPayIn = within(total.parentNode.parentNode);
    expect(totalPayIn.getByText('22')).toBeInTheDocument();
  });

  it('shows base price, provider-commission and total to provider (booking)', () => {
    render(
      <OrderBreakdownComponent
        userRole="provider"
        currency="USD"
        marketplaceName={marketplaceName}
        transaction={exampleTransaction({
          payinTotal: new Money(2000, 'USD'),
          payoutTotal: new Money(1800, 'USD'),
          lineItems: [
            {
              code: 'line-item/night',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(2),
              lineTotal: new Money(2000, 'USD'),
              unitPrice: new Money(1000, 'USD'),
              reversal: false,
            },
            {
              code: 'line-item/provider-commission',
              includeFor: ['provider'],
              lineTotal: new Money(-200, 'USD'),
              unitPrice: new Money(-200, 'USD'),
              reversal: false,
            },
          ],
        })}
        booking={createBooking('example-booking', {
          start: new Date(Date.UTC(2017, 3, 14)),
          end: new Date(Date.UTC(2017, 3, 16)),
        })}
        intl={fakeIntl}
        timeZone="Etc/UTC"
      />
    );

    // Booking: start
    const bookingStart = screen.getByText('OrderBreakdown.bookingStart');
    expect(bookingStart).toBeInTheDocument();
    const bookingStartInfo = within(bookingStart.parentNode.parentNode);
    expect(bookingStartInfo.getByText('Friday')).toBeInTheDocument();
    expect(bookingStartInfo.getByText('Apr 14')).toBeInTheDocument();

    // Booking: end
    const bookingEnd = screen.getByText('OrderBreakdown.bookingEnd');
    expect(bookingEnd).toBeInTheDocument();
    const bookingEndInfo = within(bookingEnd.parentNode.parentNode);
    expect(bookingEndInfo.getByText('Sunday')).toBeInTheDocument();
    expect(bookingEndInfo.getByText('Apr 16')).toBeInTheDocument();

    // Base price
    const unitPriceXQuantity = screen.getByText('OrderBreakdown.baseUnitNight');
    expect(unitPriceXQuantity).toBeInTheDocument();
    const lineItemBasePrice = within(unitPriceXQuantity.parentNode.parentNode);
    expect(lineItemBasePrice.getByText('20')).toBeInTheDocument();

    // Commission
    const commission = screen.getByText('OrderBreakdown.commission');
    expect(commission).toBeInTheDocument();
    const lineItemCommission = within(commission.parentNode.parentNode);
    expect(lineItemCommission.getByText('-2')).toBeInTheDocument();

    // Total
    const providerTotal = screen.getByText('OrderBreakdown.providerTotalDefault');
    expect(providerTotal).toBeInTheDocument();
    const totalPayIn = within(providerTotal.parentNode.parentNode);
    expect(totalPayIn.getByText('18')).toBeInTheDocument();
  });
});

describe('OrderBreakdown with a promo code', () => {
  const messages = {
    'OrderBreakdown.promoDiscount': 'Promo discount',
    'OrderBreakdown.promoDiscountWithCode': 'Promo discount ({code})',
    'OrderBreakdown.total': 'Total price',
    'OrderBreakdown.providerTotalDefault': 'Total price',
  };
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
      code: 'line-item/promo-discount',
      includeFor: ['customer'],
      unitPrice: new Money(10000, 'USD'),
      percentage: new Decimal(-15),
      lineTotal: new Money(-1500, 'USD'),
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
  const tx = (extra = {}) =>
    exampleTransaction({
      payinTotal: new Money(8500, 'USD'),
      payoutTotal: new Money(8000, 'USD'),
      lineItems,
      ...extra,
    });
  const renderFor = (userRole, transaction) =>
    render(
      <OrderBreakdownComponent
        userRole={userRole}
        currency="USD"
        marketplaceName={marketplaceName}
        transaction={transaction}
        intl={fakeIntl}
      />,
      { messages }
    );

  it('shows the client the code, the discount as its own line, and what they pay', () => {
    renderFor('customer', tx({ metadata: { promo: { code: 'NEWYEAR15', percentOff: 15 } } }));
    expect(screen.getByText('Promo discount (NEWYEAR15)')).toBeInTheDocument();
    expect(screen.getByText('-15')).toBeInTheDocument();
    // The total is what was charged (85), not the full price (100). The test intl prints bare numbers.
    expect(screen.getByText('85')).toBeInTheDocument();
    // Only one discount line: it is not also listed as an unrecognised item.
    expect(screen.getAllByText(/Promo discount/)).toHaveLength(1);
  });

  it('still shows the discount when the booking does not name the code', () => {
    renderFor('customer', tx());
    expect(screen.getByText('Promo discount')).toBeInTheDocument();
    expect(screen.getByText('-15')).toBeInTheDocument();
  });

  it('never shows the coach the discount: they see the full price and are paid on it', () => {
    renderFor('provider', tx({ metadata: { promo: { code: 'NEWYEAR15', percentOff: 15 } } }));
    expect(screen.queryByText(/Promo discount/)).toBeNull();
    expect(screen.queryByText('-15')).toBeNull();
    // Their line items: the full price and the usual commission, and a payout of 80.
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
    expect(screen.getByText('-20')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
  });
});
