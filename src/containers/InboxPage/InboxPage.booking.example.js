import React from 'react';
import Decimal from 'decimal.js';

import { types as sdkTypes } from '../../util/sdkLoader';
import { injectIntl } from '../../util/reactIntl';
import { createUser, createListing, createTransaction, createBooking } from '../../util/testData';
import { LINE_ITEM_FIXED } from '../../util/types';
import { getProcess } from '../../transactions/transaction';
import { NotificationBadge } from '../../components';

import { getStateData } from './InboxPage.stateData';
import { InboxItem } from './InboxPage';

// Calendar-booking rows in the inbox, in each state a client or coach can see, so the status
// wording and the notification styles can be checked without an account or a real booking.
const { Money } = sdkTypes;
const transitions = getProcess('default-booking')?.transitions;

const lineItems = [
  {
    code: LINE_ITEM_FIXED,
    includeFor: ['customer', 'provider'],
    quantity: new Decimal(1),
    unitPrice: new Money(9000, 'GBP'),
    lineTotal: new Money(9000, 'GBP'),
    reversal: false,
  },
];

const tx = lastTransition =>
  createTransaction({
    id: 'booking-1',
    processName: 'default-booking',
    lastTransition,
    lastTransitionedAt: new Date(Date.now() - 3 * 86400000),
    booking: createBooking('b1', {
      start: new Date(Date.now() - 4 * 86400000),
      end: new Date(Date.now() - 4 * 86400000 + 3600000),
    }),
    customer: createUser('Grace Hopper', {
      banned: false,
      deleted: false,
      profile: { displayName: 'Grace H', abbreviatedName: 'GH' },
    }),
    provider: createUser('Ada Lovelace', {
      banned: false,
      deleted: false,
      profile: { displayName: 'Ada L', abbreviatedName: 'AL' },
    }),
    listing: createListing('Find your focus', {
      publicData: {
        listingType: 'signature-session',
        transactionProcessAlias: 'default-booking/release-3',
        unitType: 'fixed',
      },
    }),
    lineItems,
  });

const Row = injectIntl(({ intl, tx: transaction, transactionRole, ...rest }) => {
  const stateData = getStateData({ transaction, transactionRole });
  return (
    <InboxItem
      intl={intl}
      tx={transaction}
      stateData={stateData}
      transactionRole={transactionRole}
      isBooking
      {...rest}
    />
  );
});

const row = (transactionRole, lastTransition) => ({
  component: Row,
  props: { transactionRole, tx: tx(lastTransition) },
  group: 'page:InboxPage',
});

export const Client_Booked = row('customer', transitions.OPERATOR_ACCEPT);
export const Client_ReviewDue = row('customer', transitions.COMPLETE);
export const Coach_ReviewDue = row('provider', transitions.COMPLETE);
export const Client_ReviewedByCoach = row('customer', transitions.REVIEW_1_BY_PROVIDER);
export const Coach_ReviewedByClient = row('provider', transitions.REVIEW_1_BY_CUSTOMER);
export const Client_Cancelled = row('customer', transitions.CANCEL);

// The count badge as it sits beside the "Inbox" tab.
const BadgePreview = () => (
  <p style={{ padding: 24 }}>
    Inbox <NotificationBadge count={3} />
  </p>
);
export const CountBadge = { component: BadgePreview, props: {}, group: 'page:InboxPage' };
