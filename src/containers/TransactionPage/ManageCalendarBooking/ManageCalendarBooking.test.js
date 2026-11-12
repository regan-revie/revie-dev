import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';
import * as api from '../../../util/api';
import ManageCalendarBooking from './ManageCalendarBooking';

// The real picker is a calendar plus a list of times; what matters here is what the panel does once
// a slot is chosen, so it is replaced by one button that chooses one.
// Slots carry millisecond timestamps, as the availability endpoint returns them.
const mockChosenSlot = {
  start: Date.parse('2026-11-20T19:30:00.000Z'),
  end: Date.parse('2026-11-20T20:30:00.000Z'),
};
jest.mock('../../../components/OrderPanel/NylasBookingForm/NylasSlotPicker', () => {
  const React = require('react');
  return ({ onSelectSlot }) =>
    React.createElement('button', { onClick: () => onSelectSlot(mockChosenSlot) }, 'pick a slot');
});

const { screen, waitFor, userEvent } = testingLibrary;

// In the test environment every message renders as its own key.
const hoursFromNow = h => new Date(Date.now() + h * 3600000).toISOString();

const active = (hoursAway, overrides = {}) => ({
  source: 'database',
  status: 'created',
  bookingStart: hoursFromNow(hoursAway),
  bookingEnd: hoursFromNow(hoursAway + 1),
  freeCancellationNow: hoursAway >= 48,
  rescheduleAllowed: hoursAway >= 48,
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

  it('inside 48 hours the confirmation says they are charged in full, and the button says so too', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(12));
    const cancel = jest.spyOn(api, 'nylasCancelBooking').mockResolvedValue({ ok: true });
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));

    // The step exists (nothing is cancelled by the first click), it names the charge, and the
    // button that goes ahead does not read as a harmless "Yes".
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByText('ManageCalendarBooking.confirmCancelTextCharged')).toBeInTheDocument();
    expect(
      screen.getByText('ManageCalendarBooking.confirmCancelButtonCharged')
    ).toBeInTheDocument();
    expect(screen.queryByText('ManageCalendarBooking.confirmCancelButton')).not.toBeInTheDocument();
    // And keeping the session is one click away.
    expect(screen.getByText('ManageCalendarBooking.keepBookingButton')).toBeInTheDocument();
  });

  it('more than 48 hours out the button is the plain one', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    expect(screen.getByText('ManageCalendarBooking.confirmCancelButton')).toBeInTheDocument();
    expect(
      screen.queryByText('ManageCalendarBooking.confirmCancelButtonCharged')
    ).not.toBeInTheDocument();
  });

  it('says it was charged when cancelled inside 48 hours', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(12));
    jest.spyOn(api, 'nylasCancelBooking').mockResolvedValue({ ok: true });
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    await userEvent.click(screen.getByText('ManageCalendarBooking.confirmCancelButtonCharged'));
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

  describe('rescheduling', () => {
    it('is available 49 hours out', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(49));
      renderPanel();
      const button = (await screen.findByText('ManageCalendarBooking.rescheduleButton')).closest(
        'button'
      );
      expect(button).toBeEnabled();
      expect(screen.queryByText('ManageCalendarBooking.rescheduleLocked')).not.toBeInTheDocument();
    });

    it('is disabled 47 hours out, with the reason and the way out, and cancelling is still offered', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(47));
      const availability = jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [] });
      renderPanel();
      const button = (await screen.findByText('ManageCalendarBooking.rescheduleButton')).closest(
        'button'
      );
      expect(button).toBeDisabled();
      expect(screen.getByText('ManageCalendarBooking.rescheduleLocked')).toBeInTheDocument();
      expect(screen.getByText('ManageCalendarBooking.cancelButton')).toBeInTheDocument();

      await userEvent.click(button);
      expect(availability).not.toHaveBeenCalled();
    });

    it('stays enabled when the page cannot tell (the server still enforces the rule)', async () => {
      jest
        .spyOn(api, 'nylasBookingStatus')
        .mockResolvedValue(active(47, { rescheduleAllowed: null }));
      renderPanel();
      const button = (await screen.findByText('ManageCalendarBooking.rescheduleButton')).closest(
        'button'
      );
      expect(button).toBeEnabled();
    });

    it('confirms the move straight away with the new time, without waiting for the webhook', async () => {
      const status = jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockChosenSlot] });
      const reschedule = jest.spyOn(api, 'nylasRescheduleBooking').mockResolvedValue({ ok: true });
      renderPanel();
      await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
      await userEvent.click(await screen.findByText('pick a slot'));

      expect(reschedule).toHaveBeenCalledWith({
        transactionId: 'tx-1',
        start: '2026-11-20T19:30:00.000Z',
        end: '2026-11-20T20:30:00.000Z',
      });
      const banner = await screen.findByRole('status');
      expect(banner).toHaveTextContent('ManageCalendarBooking.rescheduled');
      // The status endpoint still says the old time; the panel does not go back to it.
      expect(status).toHaveBeenCalledTimes(1);
      expect(screen.getByText('ManageCalendarBooking.rescheduleButton')).toBeInTheDocument();
    });

    it('shows the lock message when the server says the session is now inside the 48 hours', async () => {
      const status = jest.spyOn(api, 'nylasBookingStatus');
      status.mockResolvedValueOnce(active(49));
      status.mockResolvedValue(active(47));
      jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockChosenSlot] });
      jest
        .spyOn(api, 'nylasRescheduleBooking')
        .mockRejectedValue(Object.assign(new Error(), { code: 'reschedule-too-late' }));
      renderPanel();
      await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
      await userEvent.click(await screen.findByText('pick a slot'));

      expect(await screen.findByText('ManageCalendarBooking.rescheduleLocked')).toBeInTheDocument();
    });

    it('asks for a later time when the server says the new time is too soon', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockChosenSlot] });
      jest
        .spyOn(api, 'nylasRescheduleBooking')
        .mockRejectedValue(Object.assign(new Error(), { code: 'reschedule-too-soon' }));
      renderPanel();
      await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
      await userEvent.click(await screen.findByText('pick a slot'));

      expect(
        await screen.findByText('ManageCalendarBooking.rescheduleTooSoon')
      ).toBeInTheDocument();
    });
  });
});
