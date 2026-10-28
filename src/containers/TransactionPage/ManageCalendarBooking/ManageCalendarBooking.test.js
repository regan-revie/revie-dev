import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';
import * as api from '../../../util/api';
import ManageCalendarBooking from './ManageCalendarBooking';

const { screen, waitFor, userEvent } = testingLibrary;

// In the test environment every message renders as its own key.
const hoursFromNow = h => new Date(Date.now() + h * 3600000).toISOString();

const active = (hoursAway, overrides = {}) => ({
  source: 'database',
  status: 'created',
  bookingStart: hoursFromNow(hoursAway),
  bookingEnd: hoursFromNow(hoursAway + 1),
  freeCancellationNow: hoursAway >= 48,
  ...overrides,
});

const renderPanel = () =>
  render(<ManageCalendarBooking transactionId="tx-1" listingId="listing-1" />);

afterEach(() => jest.restoreAllMocks());

describe('ManageCalendarBooking', () => {
  it('offers reschedule and cancel for a session that is coming up', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
    renderPanel();
    expect(await screen.findByText('ManageCalendarBooking.rescheduleButton')).toBeInTheDocument();
    expect(screen.getByText('ManageCalendarBooking.cancelButton')).toBeInTheDocument();
  });

  it('asks before cancelling, and promises a full refund more than 48 hours out', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
    const cancel = jest.spyOn(api, 'nylasCancelBooking').mockResolvedValue({ ok: true });
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));

    expect(screen.getByText('ManageCalendarBooking.confirmCancelTextFree')).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('says the session is still charged when it is inside 48 hours', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(12));
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    expect(screen.getByText('ManageCalendarBooking.confirmCancelTextCharged')).toBeInTheDocument();
  });

  it('settles on a clear cancelled state with the refund outcome, and no buttons', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
    jest.spyOn(api, 'nylasCancelBooking').mockResolvedValue({ ok: true });
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    await userEvent.click(screen.getByText('ManageCalendarBooking.confirmCancelButton'));

    expect(await screen.findByText('ManageCalendarBooking.cancelledFree')).toBeInTheDocument();
    expect(screen.queryByText('ManageCalendarBooking.rescheduleButton')).not.toBeInTheDocument();
    expect(screen.queryByText('ManageCalendarBooking.cancelButton')).not.toBeInTheDocument();
  });

  it('says it was charged when cancelled inside 48 hours', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(12));
    jest.spyOn(api, 'nylasCancelBooking').mockResolvedValue({ ok: true });
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    await userEvent.click(screen.getByText('ManageCalendarBooking.confirmCancelButton'));
    expect(await screen.findByText('ManageCalendarBooking.cancelledCharged')).toBeInTheDocument();
  });

  it('shows the cancelled state, not the buttons, when the page is opened after cancelling', async () => {
    jest
      .spyOn(api, 'nylasBookingStatus')
      .mockResolvedValue(active(72, { status: 'cancelled', freeCancellation: true }));
    renderPanel();
    expect(await screen.findByText('ManageCalendarBooking.cancelledFree')).toBeInTheDocument();
    expect(screen.queryByText('ManageCalendarBooking.cancelButton')).not.toBeInTheDocument();
  });

  it('shows nothing for a session that has already happened', async () => {
    const spy = jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(-30));
    const { container } = renderPanel();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('keeps the confirmation open and reports an error if the cancel fails', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
    jest.spyOn(api, 'nylasCancelBooking').mockRejectedValue(new Error('503'));
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    await userEvent.click(screen.getByText('ManageCalendarBooking.confirmCancelButton'));
    expect(await screen.findByText('ManageCalendarBooking.genericError')).toBeInTheDocument();
    expect(screen.queryByText('ManageCalendarBooking.cancelledFree')).not.toBeInTheDocument();
  });
});
