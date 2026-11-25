import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';
import * as api from '../../../util/api';
import en from '../../../translations/en.json';
import { getDefaultTimeZoneOnBrowser } from '../../../util/dates';
import { formatTimeZoneName } from '../../../components/OrderPanel/NylasBookingForm/nylasSlots';
import { shortTimeZoneName } from '../BookingConfirmation/bookingFormat';
import ManageCalendarBooking from './ManageCalendarBooking';

// The real picker is a strip of days plus a grid of times; what matters here is what the card does once
// a slot is chosen, so it is replaced by one button that chooses one. Slots carry millisecond
// timestamps, as the availability endpoint returns them, and are relative to now so that the 48-hour
// line (which depends on how far away the new time is) means the same on any day the tests run.
const HOUR_MS = 3600000;
const slotAt = hoursAway => {
  const start = Math.ceil((Date.now() + hoursAway * HOUR_MS) / HOUR_MS) * HOUR_MS;
  return { start, end: start + HOUR_MS };
};
const mockPick = { slot: null };
jest.mock('../../../components/OrderPanel/NylasBookingForm/NylasSlotSteps', () => {
  const React = require('react');
  return ({ onSelectSlot }) =>
    React.createElement('button', { onClick: () => onSelectSlot(mockPick.slot) }, 'pick a slot');
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

const renderPanel = (props = {}) =>
  render(
    <ManageCalendarBooking
      transactionId="tx-1"
      listingId="listing-1"
      refundText="$93.50"
      {...props}
    />
  );

// Clicking a time only opens the confirm panel; this is the click that actually moves the session. The
// panel ignores clicks for its first half second (a double-click on a time), so the clock is moved on.
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

beforeEach(() => {
  mockPick.slot = slotAt(100);
});

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

  it('says what the refund will be, in the real words, and without an amount when it has none', () => {
    expect(en['ManageCalendarBooking.confirmCancelTextFree']).toBe(
      "You'll get a full refund of {amount}."
    );
    expect(en['ManageCalendarBooking.confirmCancelTextFreeNoAmount']).toBe(
      "You'll get a full refund."
    );
  });

  it('without a refund amount to show, promises a refund without one', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
    renderPanel({ refundText: undefined });
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    expect(
      screen.getByText('ManageCalendarBooking.confirmCancelTextFreeNoAmount')
    ).toBeInTheDocument();
  });

  it('says the session is still charged when it is inside 48 hours', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(12));
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    expect(screen.getByText('ManageCalendarBooking.confirmCancelTextCharged')).toBeInTheDocument();
  });

  it('settles on cancelled with the refund outcome: the card steps aside and tells the page', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
    jest.spyOn(api, 'nylasCancelBooking').mockResolvedValue({ ok: true });
    const onViewChange = jest.fn();
    const onCancelled = jest.fn();
    const { container } = renderPanel({ onViewChange, onCancelled });
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    await userEvent.click(screen.getByText('ManageCalendarBooking.confirmCancelButton'));

    // The page shows the refund section and the heading; the card shows no buttons.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(onViewChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isCancelled: true, cancelFree: true })
    );
    expect(onCancelled).toHaveBeenCalled();
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

  it('reports that it was charged when cancelled inside 48 hours', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(12));
    jest.spyOn(api, 'nylasCancelBooking').mockResolvedValue({ ok: true });
    const onViewChange = jest.fn();
    renderPanel({ onViewChange });
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    await userEvent.click(screen.getByText('ManageCalendarBooking.confirmCancelButtonCharged'));
    await waitFor(() =>
      expect(onViewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ isCancelled: true, cancelFree: false })
      )
    );
  });

  it('shows no buttons, and reports the cancellation, when the page is opened after cancelling', async () => {
    jest
      .spyOn(api, 'nylasBookingStatus')
      .mockResolvedValue(active(72, { status: 'cancelled', freeCancellation: true }));
    const onViewChange = jest.fn();
    const { container } = renderPanel({ onViewChange });
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());
    expect(onViewChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isCancelled: true, cancelFree: true })
    );
    expect(container).toBeEmptyDOMElement();
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
    // Still on the confirm panel, nothing cancelled.
    expect(screen.getByText('ManageCalendarBooking.confirmCancelButton')).toBeInTheDocument();
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
      expect(screen.getByText('ManageCalendarBooking.freeUntil')).toBeInTheDocument();
    });

    it('is not offered 47 hours out: the orange box says why, and cancelling is still offered', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(47));
      const availability = jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [] });
      renderPanel();
      expect(await screen.findByText('ManageCalendarBooking.rescheduleLocked')).toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.rescheduleButton')).not.toBeInTheDocument();
      // The "free until" line goes too: it is no longer free.
      expect(screen.queryByText('ManageCalendarBooking.freeUntil')).not.toBeInTheDocument();
      expect(screen.getByText('ManageCalendarBooking.cancelButton')).toBeInTheDocument();
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
      jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockPick.slot] });
      const reschedule = jest.spyOn(api, 'nylasRescheduleBooking').mockResolvedValue({ ok: true });
      renderPanel();
      await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
      await userEvent.click(await screen.findByText('pick a slot'));
      await confirmMove();

      expect(reschedule).toHaveBeenCalledWith({
        transactionId: 'tx-1',
        start: new Date(mockPick.slot.start).toISOString(),
        end: new Date(mockPick.slot.end).toISOString(),
      });
      const banner = await screen.findByText('ManageCalendarBooking.rescheduledNote');
      expect(banner.closest('[role="status"]')).not.toBeNull();
      // The status endpoint still says the old time; the panel does not go back to it.
      expect(status).toHaveBeenCalledTimes(1);
      expect(screen.getByText('ManageCalendarBooking.rescheduleButton')).toBeInTheDocument();
    });

    it('shows the lock message when the server says the session is now inside the 48 hours', async () => {
      const status = jest.spyOn(api, 'nylasBookingStatus');
      status.mockResolvedValueOnce(active(49));
      status.mockResolvedValue(active(47));
      jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockPick.slot] });
      jest
        .spyOn(api, 'nylasRescheduleBooking')
        .mockRejectedValue(Object.assign(new Error(), { code: 'reschedule-too-late' }));
      renderPanel();
      await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
      await userEvent.click(await screen.findByText('pick a slot'));
      await confirmMove();

      expect(await screen.findByText('ManageCalendarBooking.rescheduleLocked')).toBeInTheDocument();
    });

    it('asks for a later time when the server says the new time is too soon', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockPick.slot] });
      jest
        .spyOn(api, 'nylasRescheduleBooking')
        .mockRejectedValue(Object.assign(new Error(), { code: 'reschedule-too-soon' }));
      renderPanel();
      await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
      await userEvent.click(await screen.findByText('pick a slot'));
      await confirmMove();

      // In the panel, which still offers the confirm button and "Pick a different time".
      expect(
        await screen.findByText('ManageCalendarBooking.rescheduleTooSoon')
      ).toBeInTheDocument();
      expect(screen.getByText('ManageCalendarBooking.confirmMoveButton')).toBeInTheDocument();
      expect(screen.getByText('ManageCalendarBooking.confirmMoveCancel')).toBeInTheDocument();
    });
  });

  describe('the confirm panel', () => {
    const openPicker = async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockPick.slot] });
      const reschedule = jest.spyOn(api, 'nylasRescheduleBooking').mockResolvedValue({ ok: true });
      renderPanel();
      await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
      return reschedule;
    };

    it('opens when a time is clicked, with the old time struck through and the new one, and sends nothing', async () => {
      const reschedule = await openPicker();
      expect(
        screen.queryByText('ManageCalendarBooking.confirmMoveHeading')
      ).not.toBeInTheDocument();
      await userEvent.click(await screen.findByText('pick a slot'));

      expect(
        await screen.findByText('ManageCalendarBooking.confirmMoveHeading')
      ).toBeInTheDocument();
      const panel = screen.getByTestId('confirm-move');
      // The current time struck through, the new one beside an arrow.
      expect(panel.querySelector('s')).not.toBeNull();
      expect(panel).toHaveTextContent(/\d{1,2}:\d{2}.*PT|GMT|BST|ET|CET|UTC|GMT[+-]/);
      expect(screen.getByText('ManageCalendarBooking.confirmMoveButton')).toBeInTheDocument();
      expect(screen.getByText('ManageCalendarBooking.confirmMoveCancel')).toBeInTheDocument();
      // The panel takes the picker's place, but the picker is kept (hidden), so it comes back as it was.
      expect(screen.getByText('pick a slot', { hidden: true })).not.toBeVisible();
      expect(reschedule).not.toHaveBeenCalled();
    });

    it('only the confirm button sends the request, exactly once', async () => {
      const reschedule = await openPicker();
      await userEvent.click(await screen.findByText('pick a slot'));
      expect(reschedule).not.toHaveBeenCalled();

      await confirmMove();
      expect(reschedule).toHaveBeenCalledTimes(1);
      expect(reschedule).toHaveBeenCalledWith({
        transactionId: 'tx-1',
        start: new Date(mockPick.slot.start).toISOString(),
        end: new Date(mockPick.slot.end).toISOString(),
      });
      expect(await screen.findByText('ManageCalendarBooking.rescheduledNote')).toBeInTheDocument();
      // The panel has closed.
      expect(
        screen.queryByText('ManageCalendarBooking.confirmMoveHeading')
      ).not.toBeInTheDocument();
    });

    it('shows "Moving your session…" in the panel while the request is out', async () => {
      const reschedule = await openPicker();
      let finish;
      reschedule.mockImplementation(
        () =>
          new Promise(resolve => {
            finish = () => resolve({ ok: true });
          })
      );
      await userEvent.click(await screen.findByText('pick a slot'));
      await confirmMove();

      expect(screen.getByText('ManageCalendarBooking.reschedulingInProgress')).toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.confirmMoveButton')).not.toBeInTheDocument();
      finish();
      expect(await screen.findByText('ManageCalendarBooking.rescheduledNote')).toBeInTheDocument();
    });

    it('"Pick a different time" closes it and brings the picker back as it was, sending nothing', async () => {
      const reschedule = await openPicker();
      await userEvent.click(await screen.findByText('pick a slot'));
      await userEvent.click(await screen.findByText('ManageCalendarBooking.confirmMoveCancel'));

      expect(
        screen.queryByText('ManageCalendarBooking.confirmMoveHeading')
      ).not.toBeInTheDocument();
      expect(screen.getByText('pick a slot')).toBeVisible();
      expect(reschedule).not.toHaveBeenCalled();
      // And a time can be clicked again.
      await userEvent.click(screen.getByText('pick a slot'));
      expect(
        await screen.findByText('ManageCalendarBooking.confirmMoveHeading')
      ).toBeInTheDocument();
    });

    describe('the 48-hour line', () => {
      const line = 'ManageCalendarBooking.confirmMoveInsideLockWindow';

      it('is there when the new time is less than 48 hours away', async () => {
        mockPick.slot = slotAt(30);
        await openPicker();
        await userEvent.click(await screen.findByText('pick a slot'));
        expect(await screen.findByText(line)).toBeInTheDocument();
      });

      it('is not there when the new time is 48 hours or more away', async () => {
        mockPick.slot = slotAt(100);
        await openPicker();
        await userEvent.click(await screen.findByText('pick a slot'));
        await screen.findByText('ManageCalendarBooking.confirmMoveHeading');
        expect(screen.queryByText(line)).not.toBeInTheDocument();
      });

      it('says what it means, in full', () => {
        expect(en[line]).toBe(
          "This new time is less than 48 hours away. Once it's moved, you won't be able to move it again, and cancelling will be charged in full."
        );
      });
    });

    describe('the click guard', () => {
      it('ignores a click on Confirm in the first half second (a double-click on a time)', async () => {
        const reschedule = await openPicker();
        await userEvent.click(await screen.findByText('pick a slot'));
        // Straight away, as the second click of a double-click would arrive.
        await userEvent.click(await screen.findByText('ManageCalendarBooking.confirmMoveButton'));
        expect(reschedule).not.toHaveBeenCalled();
        expect(screen.getByText('ManageCalendarBooking.confirmMoveHeading')).toBeInTheDocument();
      });

      it('accepts it once half a second has passed', async () => {
        const reschedule = await openPicker();
        await userEvent.click(await screen.findByText('pick a slot'));
        await userEvent.click(await screen.findByText('ManageCalendarBooking.confirmMoveButton'));
        expect(reschedule).not.toHaveBeenCalled();

        await confirmMove(); // the same click, 1 second later
        expect(reschedule).toHaveBeenCalledTimes(1);
      });

      it('starts again from the moment the panel is opened again', async () => {
        const reschedule = await openPicker();
        await userEvent.click(await screen.findByText('pick a slot'));
        await userEvent.click(await screen.findByText('ManageCalendarBooking.confirmMoveCancel'));
        await userEvent.click(screen.getByText('pick a slot'));
        await userEvent.click(await screen.findByText('ManageCalendarBooking.confirmMoveButton'));
        expect(reschedule).not.toHaveBeenCalled();
      });
    });

    it("names the new time's timezone the way people say it, not as a zone id", async () => {
      expect(formatTimeZoneName('America/Los_Angeles', new Date('2026-11-20T19:30:00Z'))).toBe(
        'Pacific Time'
      );
      expect(formatTimeZoneName('America/Los_Angeles', new Date('2026-07-20T19:30:00Z'))).toBe(
        'Pacific Time'
      );
      // "UK time", not "United Kingdom Time", in winter and summer alike.
      expect(formatTimeZoneName('Europe/London', new Date('2026-11-20T19:30:00Z'))).toBe('UK time');
      expect(formatTimeZoneName('Europe/London', new Date('2026-07-20T19:30:00Z'))).toBe('UK time');
    });
  });

  describe('when a reschedule is turned down', () => {
    const pickASlot = async () => {
      await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
      await userEvent.click(await screen.findByText('pick a slot'));
      await confirmMove();
    };
    const failWith = code =>
      jest
        .spyOn(api, 'nylasRescheduleBooking')
        .mockRejectedValue(Object.assign(new Error(), { code }));

    beforeEach(() => {
      jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockPick.slot] });
    });

    it('says the time isn\'t available any more in the panel, and "Pick a different time" returns to freshly loaded times', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      failWith('reschedule-slot-unavailable');
      renderPanel();
      await pickASlot();

      expect(
        await screen.findByText('ManageCalendarBooking.rescheduleSlotUnavailable')
      ).toBeInTheDocument();
      // Still in the panel, which offers no way to repeat the refused time.
      expect(screen.getByText('ManageCalendarBooking.confirmMoveHeading')).toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.confirmMoveButton')).not.toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.genericError')).not.toBeInTheDocument();

      await userEvent.click(screen.getByText('ManageCalendarBooking.confirmMoveCancel'));
      expect(
        screen.queryByText('ManageCalendarBooking.confirmMoveHeading')
      ).not.toBeInTheDocument();
      expect(await screen.findByText('pick a slot')).toBeInTheDocument();
      // The free times were fetched again after the refusal.
      expect(api.nylasAvailability).toHaveBeenCalledTimes(2);
    });

    it('says the 48-hour rule in the panel when the session has just moved inside it', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      failWith('reschedule-too-late');
      renderPanel();
      await pickASlot();

      expect(await screen.findByText('ManageCalendarBooking.rescheduleLocked')).toBeInTheDocument();
      expect(screen.getByText('ManageCalendarBooking.confirmMoveHeading')).toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.confirmMoveButton')).not.toBeInTheDocument();
      // The way out is "Pick a different time", back to the card, where Reschedule is now gone.
      await userEvent.click(screen.getByText('ManageCalendarBooking.confirmMoveCancel'));
      expect(await screen.findByText('ManageCalendarBooking.rescheduleLocked')).toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.rescheduleButton')).not.toBeInTheDocument();
    });

    it('says the session has been cancelled when the server says so', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      failWith('booking-cancelled');
      renderPanel();
      await pickASlot();

      expect(await screen.findByText('ManageCalendarBooking.sessionCancelled')).toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.genericError')).not.toBeInTheDocument();
    });

    it('says the coach is cancelling when the server says so, and reads the session again', async () => {
      const status = jest.spyOn(api, 'nylasBookingStatus');
      status.mockResolvedValueOnce(active(72));
      status.mockResolvedValue(active(72, { cancellationPending: true }));
      failWith('being-cancelled-by-coach');
      renderPanel();
      await pickASlot();

      expect(
        await screen.findByText('ManageCalendarBooking.beingCancelledByCoach')
      ).toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.rescheduleButton')).not.toBeInTheDocument();
    });

    it('keeps the plain message for anything it does not recognise', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      failWith('reschedule-failed');
      renderPanel();
      await pickASlot();
      expect(await screen.findByText('ManageCalendarBooking.genericError')).toBeInTheDocument();
    });
  });

  it('shows that the coach is cancelling, instead of an error, when the server refuses a cancel for that reason', async () => {
    const status = jest.spyOn(api, 'nylasBookingStatus');
    status.mockResolvedValueOnce(active(72));
    status.mockResolvedValue(active(72, { cancellationPending: true }));
    jest
      .spyOn(api, 'nylasCancelBooking')
      .mockRejectedValue(Object.assign(new Error(), { code: 'being-cancelled-by-coach' }));
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.cancelButton'));
    await userEvent.click(screen.getByText('ManageCalendarBooking.confirmCancelButton'));

    expect(
      await screen.findByText('ManageCalendarBooking.beingCancelledByCoach')
    ).toBeInTheDocument();
    expect(screen.queryByText('ManageCalendarBooking.genericError')).not.toBeInTheDocument();
    expect(screen.queryByText('ManageCalendarBooking.cancelButton')).not.toBeInTheDocument();
  });

  describe("while the coach's deletion of the event is in its five-minute wait", () => {
    it('hides Reschedule (and Cancel) and says the coach is cancelling the session', async () => {
      jest
        .spyOn(api, 'nylasBookingStatus')
        .mockResolvedValue(active(72, { cancellationPending: true }));
      renderPanel();

      expect(
        await screen.findByText('ManageCalendarBooking.beingCancelledByCoach')
      ).toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.rescheduleButton')).not.toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.cancelButton')).not.toBeInTheDocument();
    });

    it('brings the buttons back when the coach puts the event back (the wait is over)', async () => {
      jest
        .spyOn(api, 'nylasBookingStatus')
        .mockResolvedValue(active(72, { cancellationPending: false }));
      renderPanel();
      expect(await screen.findByText('ManageCalendarBooking.rescheduleButton')).toBeInTheDocument();
      expect(
        screen.queryByText('ManageCalendarBooking.beingCancelledByCoach')
      ).not.toBeInTheDocument();
    });
  });

  it('sends one reschedule however many times the time is clicked while it is being made', async () => {
    jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockPick.slot] });
    let finish;
    const reschedule = jest.spyOn(api, 'nylasRescheduleBooking').mockImplementation(
      () =>
        new Promise(resolve => {
          finish = () => resolve({ ok: true });
        })
    );
    renderPanel();
    await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
    await userEvent.click(await screen.findByText('pick a slot'));
    const confirm = await screen.findByText('ManageCalendarBooking.confirmMoveButton');
    const realNow = Date.now;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 1000);
    await userEvent.click(confirm);
    await userEvent.click(confirm).catch(() => {});
    spy.mockRestore();

    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(screen.getByText('ManageCalendarBooking.reschedulingInProgress')).toBeInTheDocument();
    finish();
    expect(await screen.findByText('ManageCalendarBooking.rescheduledNote')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'ManageCalendarBooking.rescheduledNote'
    );
  });

  describe('the copy on the card', () => {
    it('names the timezone after the session time, in the short form: "10:00–11:00 AM PT"', async () => {
      const start = hoursFromNow(72);
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72, { bookingStart: start }));
      renderPanel();
      const zone = shortTimeZoneName(getDefaultTimeZoneOnBrowser(), new Date(start).getTime());
      const when = await screen.findByTestId('session-when');
      expect(when).toHaveTextContent(new RegExp(`\\d{1,2}:\\d{2}.*–.*${zone}`));
      expect(when).toHaveTextContent(/[AP]M/);
    });

    it('says how long the video call is', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      renderPanel();
      expect(await screen.findByText('ManageCalendarBooking.videoCall')).toBeInTheDocument();
    });

    it('shows no "moved" note on a fresh visit (the Activity list keeps the record)', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      renderPanel();
      await screen.findByText('ManageCalendarBooking.rescheduleButton');
      expect(screen.queryByText('ManageCalendarBooking.rescheduledNote')).not.toBeInTheDocument();
    });

    it('right after a reschedule shows the success note under the time, and no "Moved to {time}" line', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [mockPick.slot] });
      jest.spyOn(api, 'nylasRescheduleBooking').mockResolvedValue({ ok: true });
      renderPanel();
      await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
      await userEvent.click(await screen.findByText('pick a slot'));
      await confirmMove();

      const note = await screen.findByText('ManageCalendarBooking.rescheduledNote');
      expect(note.closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByText('ManageCalendarBooking.rescheduled')).not.toBeInTheDocument();
      // Under the session time, which is shown once, and it is the new time.
      const time = screen.getByTestId('session-when');
      expect(time.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("the locked message says it can't be moved and cancelling is charged in full, and does not send the client to the coach", () => {
      const text = en['ManageCalendarBooking.rescheduleLocked'];
      expect(text).toBe(
        "This session is less than 48 hours away, so it can't be moved. You can still cancel, but you'll be charged in full."
      );
      expect(text).not.toMatch(/message|coach|\{/i);
    });

    it('the success note says what happened, once (the tick is an icon)', () => {
      expect(en['ManageCalendarBooking.rescheduledNote']).toBe(
        "Moved. We've emailed you both and updated your calendars."
      );
      expect(en['ManageCalendarBooking.rescheduled']).toBeUndefined();
    });
  });

  describe('free to cancel or move until', () => {
    it('says until when (48 hours before the start), with Reschedule and Cancel beside it', async () => {
      jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72));
      renderPanel();
      expect(await screen.findByText('ManageCalendarBooking.freeUntil')).toBeInTheDocument();
      expect(en['ManageCalendarBooking.freeUntil']).toBe(
        'Free to cancel or move until <b>{date}</b>.'
      );
    });
  });

  describe('join and add to calendar', () => {
    const links = {
      meetLink: 'https://meet.google.com/abc-defg',
      calendarUrl: 'https://example.com/api/nylas/calendar/tok/revie-session.ics',
    };

    it('asks for the links on its first load, and shows Join on Google Meet and Add to calendar', async () => {
      const status = jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(active(72, links));
      renderPanel();
      const join = await screen.findByText('ManageCalendarBooking.join');
      expect(status).toHaveBeenCalledWith({ transactionId: 'tx-1', links: true });
      const joinLink = join.closest('a');
      expect(joinLink).toHaveAttribute('href', links.meetLink);
      expect(joinLink).toHaveAttribute('target', '_blank');
      expect(screen.getByText('ManageCalendarBooking.addToCalendar').closest('a')).toHaveAttribute(
        'href',
        links.calendarUrl
      );
      expect(screen.getByText('ManageCalendarBooking.calendarHelp')).toBeInTheDocument();
    });

    it('shows no button for a link it does not have yet (the invite carries it)', async () => {
      jest
        .spyOn(api, 'nylasBookingStatus')
        .mockResolvedValue(active(72, { meetLink: '', calendarUrl: '' }));
      renderPanel();
      await screen.findByText('ManageCalendarBooking.rescheduleButton');
      expect(screen.queryByText('ManageCalendarBooking.join')).not.toBeInTheDocument();
      expect(screen.queryByText('ManageCalendarBooking.addToCalendar')).not.toBeInTheDocument();
    });

    it('keeps the links after a reschedule, when the polling status leaves them out', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      try {
        const status = jest.spyOn(api, 'nylasBookingStatus');
        status.mockResolvedValueOnce(active(72, links));
        const moved = mockPick.slot;
        status.mockResolvedValue(
          active(72, {
            bookingStart: new Date(moved.start).toISOString(),
            bookingEnd: new Date(moved.end).toISOString(),
          })
        );
        jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [moved] });
        jest.spyOn(api, 'nylasRescheduleBooking').mockResolvedValue({ ok: true });
        renderPanel();
        await userEvent.click(await screen.findByText('ManageCalendarBooking.rescheduleButton'));
        await userEvent.click(await screen.findByText('pick a slot'));
        await confirmMove();
        await screen.findByText('ManageCalendarBooking.rescheduledNote');
        jest.advanceTimersByTime(3000);
        await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
        expect(screen.getByText('ManageCalendarBooking.join').closest('a')).toHaveAttribute(
          'href',
          links.meetLink
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
