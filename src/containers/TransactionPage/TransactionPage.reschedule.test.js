// The reschedule flow as a client meets it: the real order page (TransactionPage, as the customer of
// an accepted calendar booking) with the real "Your session" card and the real slot picker. Only the
// server calls are replaced. This exists because the component's own tests render the card on its
// own, which cannot show that the card on the order page is the one with the confirm step.
import React, { act } from 'react';
import '@testing-library/jest-dom';

import * as api from '../../util/api';
import {
  createUser,
  createCurrentUser,
  createListing,
  fakeIntl,
  createTransaction,
  createBooking,
  createMessage,
} from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import { TX_TRANSITION_ACTOR_CUSTOMER, getProcess } from '../../transactions/transaction';

import { TransactionPageComponent } from './TransactionPage';

const { screen, userEvent } = testingLibrary;
const noop = () => null;
const HOUR = 3600000;

const process = getProcess('default-booking');
const transitions = process.transitions;

const provider = createUser('provider');
const customer = createUser('customer');

// A confirmed calendar booking, five days out, as the customer sees it on /order/:id.
const transaction = createTransaction({
  id: 'tx-order',
  customer,
  provider,
  processName: 'default-booking',
  listing: createListing('listing-session', {
    publicData: {
      listingType: 'signature-session',
      transactionProcessAlias: 'default-booking/release-6',
      unitType: 'fixed',
      calendarBookingEnabled: true,
    },
  }),
  booking: createBooking('booking-id', {
    start: new Date(Date.now() + 5 * 24 * HOUR),
    end: new Date(Date.now() + 5 * 24 * HOUR + HOUR),
  }),
  lastTransition: transitions.OPERATOR_ACCEPT,
  lastTransitionedAt: new Date(),
  transitions: [
    {
      createdAt: new Date(Date.now() - HOUR),
      by: 'operator',
      transition: transitions.REQUEST_PAYMENT,
    },
    {
      createdAt: new Date(Date.now() - HOUR + 1000),
      by: TX_TRANSITION_ACTOR_CUSTOMER,
      transition: transitions.CONFIRM_PAYMENT,
    },
    {
      createdAt: new Date(Date.now() - HOUR + 2000),
      by: 'operator',
      transition: transitions.OPERATOR_ACCEPT,
    },
  ],
  lineItems: [],
});

const props = {
  currentUser: createCurrentUser('customer'),
  transaction,
  transactionRole: TX_TRANSITION_ACTOR_CUSTOMER,
  totalMessagePages: 1,
  oldestMessagePageFetched: 1,
  fetchTransactionError: null,
  history: { push: noop },
  location: { search: null },
  intl: fakeIntl,
  messages: [createMessage('msg1', {}, { sender: provider })],
  params: { id: transaction.id.uuid },
  scrollingDisabled: false,
  sendMessageInProgress: false,
  fetchLineItemsInProgress: false,
  fetchMessagesInProgress: false,
  onManageDisableScrolling: noop,
  onSendMessage: noop,
  onSendReview: noop,
  onShowMoreMessages: noop,
  onTransition: noop,
  onFetchTimeSlots: noop,
  callSetInitialValues: noop,
  onInitializeCardPaymentData: noop,
  onFetchTransactionLineItems: noop,
  nextTransitions: null,
  monthlyTimeSlots: {},
  timeSlotsForDate: {},
  showListingImage: true,
};

// Two free times, a week out, a session long.
const slotStart = Date.now() + 7 * 24 * HOUR;
const slots = [
  { start: slotStart, end: slotStart + HOUR },
  { start: slotStart + 2 * HOUR, end: slotStart + 3 * HOUR },
];

afterEach(() => jest.restoreAllMocks());

describe('the reschedule flow on the real order page', () => {
  const openOrderPage = async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue({
      source: 'database',
      status: 'created',
      bookingStart: new Date(Date.now() + 5 * 24 * HOUR).toISOString(),
      bookingEnd: new Date(Date.now() + 5 * 24 * HOUR + HOUR).toISOString(),
      freeCancellationNow: true,
      rescheduleAllowed: true,
      cancellationPending: false,
    });
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots, connected: true });
    const reschedule = jest.spyOn(api, 'nylasRescheduleBooking').mockResolvedValue({ ok: true });
    await act(async () => {
      render(<TransactionPageComponent {...props} />);
    });
    return reschedule;
  };

  // The time buttons read "HH:MM" and nothing else on the page does.
  const timeButtons = () =>
    screen.getAllByRole('button').filter(button => /^\d{2}:\d{2}$/.test(button.textContent.trim()));

  it('offers Reschedule on the order page, and a time click opens the confirm panel and sends nothing', async () => {
    const reschedule = await openOrderPage();

    await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
    await userEvent.click(timeButtons()[0]);

    expect(await screen.findByText('ManageCalendarBooking.confirmMoveHeading')).toBeInTheDocument();
    expect(screen.getByText('ManageCalendarBooking.confirmMoveButton')).toBeInTheDocument();
    expect(screen.getByText('ManageCalendarBooking.pickDifferentTime')).toBeInTheDocument();
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('sends exactly one request, and only when the confirm button is pressed', async () => {
    const reschedule = await openOrderPage();

    await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
    await userEvent.click(timeButtons()[1]);
    expect(reschedule).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByText('ManageCalendarBooking.confirmMoveButton'));
    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(reschedule).toHaveBeenCalledWith({
      transactionId: transaction.id.uuid,
      start: new Date(slots[1].start).toISOString(),
      end: new Date(slots[1].end).toISOString(),
    });
  });

  it("'Pick a different time' returns to the real picker with nothing sent", async () => {
    const reschedule = await openOrderPage();

    await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
    await userEvent.click(timeButtons()[0]);
    await userEvent.click(await screen.findByText('ManageCalendarBooking.pickDifferentTime'));

    expect(timeButtons().length).toBeGreaterThan(0);
    expect(screen.queryByText('ManageCalendarBooking.confirmMoveHeading')).not.toBeInTheDocument();
    expect(reschedule).not.toHaveBeenCalled();
  });
});
