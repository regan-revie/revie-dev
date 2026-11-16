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
const slotStart = Math.ceil((Date.now() + 7 * 24 * HOUR) / HOUR) * HOUR;
const slots = [
  { start: slotStart, end: slotStart + HOUR },
  { start: slotStart + 2 * HOUR, end: slotStart + 3 * HOUR },
];

// The app's page has a #portal-root (public/index.html) that the Modal renders into.
beforeEach(() => {
  document.body.insertAdjacentHTML('beforeend', '<div id="portal-root"></div>');
});
afterEach(() => {
  document.getElementById('portal-root')?.remove();
});

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

  // The dialog ignores clicks on Confirm for its first half second (a double-click on a time), so the
  // clock is moved on for the click that is meant.
  const confirmMove = async () => {
    const button = await screen.findByText('ManageCalendarBooking.confirmMoveButton');
    const realNow = Date.now;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 1000);
    try {
      await userEvent.click(button);
    } finally {
      spy.mockRestore();
    }
  };

  it('offers Reschedule on the order page, and a time click opens the confirm dialog and sends nothing', async () => {
    const reschedule = await openOrderPage();

    await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
    await userEvent.click(timeButtons()[0]);

    expect(await screen.findByText('ManageCalendarBooking.confirmMoveHeading')).toBeInTheDocument();
    expect(screen.getByText('ManageCalendarBooking.confirmMoveButton')).toBeInTheDocument();
    expect(screen.getByText('ManageCalendarBooking.confirmMoveCancel')).toBeInTheDocument();
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('sends exactly one request, and only when the confirm button is pressed', async () => {
    const reschedule = await openOrderPage();

    await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
    await userEvent.click(timeButtons()[1]);
    expect(reschedule).not.toHaveBeenCalled();

    // Straight after the time click it is ignored; half a second later it counts.
    await userEvent.click(await screen.findByText('ManageCalendarBooking.confirmMoveButton'));
    expect(reschedule).not.toHaveBeenCalled();
    await confirmMove();
    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(reschedule).toHaveBeenCalledWith({
      transactionId: transaction.id.uuid,
      start: new Date(slots[1].start).toISOString(),
      end: new Date(slots[1].end).toISOString(),
    });
  });

  it('Cancel closes the dialog and leaves the real picker as it was, with nothing sent', async () => {
    const reschedule = await openOrderPage();

    await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
    await userEvent.click(timeButtons()[0]);
    await userEvent.click(await screen.findByText('ManageCalendarBooking.confirmMoveCancel'));

    expect(timeButtons().length).toBe(2);
    expect(screen.queryByText('ManageCalendarBooking.confirmMoveHeading')).not.toBeInTheDocument();
    expect(reschedule).not.toHaveBeenCalled();
  });
});
