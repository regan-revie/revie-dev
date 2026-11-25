import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';
import * as api from '../../../util/api';
import en from '../../../translations/en.json';
import { BookingLayoutContext, LAYOUT_SHEET } from '../BookingPanelParts';
import NylasBookingForm from './NylasBookingForm';
import { dayKeyOf } from './nylasSlots';
import fs from 'fs';
import path from 'path';

const { screen, waitFor, userEvent, within } = testingLibrary;

const VIEWER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const slot = (iso, minutes = 60) => {
  const start = Date.parse(iso);
  return { start, end: start + minutes * 60000 };
};

// A time button as the panel writes it ("3:30 pm"), worked out here in the viewer's own zone so the
// suite holds wherever it runs.
const timeText = ms =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: VIEWER_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(ms))
    .replace(/[\s ]+/g, ' ')
    .toLowerCase();

const baseProps = {
  listingId: 'listing-1',
  isOwnListing: false,
  onSubmit: jest.fn(),
  onFetchTransactionLineItems: jest.fn(),
  marketplaceName: 'Revie',
  price: { amount: 5000, currency: 'USD' },
  priceVariants: [{ name: 'test', bookingLengthInMinutes: 60, priceInSubunits: 5000 }],
};

const BOOK = /NylasBookingForm.bookButton/i;
const bookButton = () => screen.getByRole('button', { name: BOOK });

afterEach(() => jest.restoreAllMocks());

describe('NylasBookingForm: what the client sees when there is nothing to pick', () => {
  it('tells the client when the coach has not connected a calendar', async () => {
    // A normal state, not an error - an empty calendar with no explanation looks broken.
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [], connected: false });
    render(<NylasBookingForm {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText(/hasn't connected their calendar/i)).toBeInTheDocument()
    );
  });

  it('explains an empty calendar differently from a missing one', async () => {
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [], connected: true });
    render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(screen.getByText(/No times are available/i)).toBeInTheDocument());
  });

  it('surfaces a failure rather than showing an empty calendar', async () => {
    jest.spyOn(api, 'nylasAvailability').mockRejectedValue(new Error('boom'));
    render(<NylasBookingForm {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText(/couldn't load available times/i)).toBeInTheDocument()
    );
  });

  it('hides slots that do not match the chosen variant duration', async () => {
    // Booking a 60-minute slot against a 30-minute variant would charge for one and book the other.
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [slot('2026-09-11T22:30:00Z', 60)],
      connected: true,
    });
    render(
      <NylasBookingForm
        {...baseProps}
        priceVariants={[{ name: 'short', bookingLengthInMinutes: 30, priceInSubunits: 2500 }]}
      />
    );
    await waitFor(() => expect(screen.getByText(/No times are available/i)).toBeInTheDocument());
    expect(
      screen.queryByText(timeText(Date.parse('2026-09-11T22:30:00Z')))
    ).not.toBeInTheDocument();
  });
});

describe('NylasBookingForm: the three steps keep the booking behaviour', () => {
  const start = Date.parse('2026-09-11T22:30:00Z');

  it('renders times in the viewer timezone, not the coach timezone, and says which', async () => {
    // The client should never do timezone arithmetic. Stated rather than assumed: a client booking
    // while travelling wants their home zone, not wherever the laptop currently is.
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [{ start, end: start + 3600000 }],
      connected: true,
    });
    render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
    expect(screen.getByText('BookingPanel.timeZoneLine')).toBeInTheDocument();

    // ...and it can be changed.
    await userEvent.click(screen.getByRole('button', { name: 'BookingPanel.changeTimeZone' }));
    expect(screen.getByRole('combobox')).toHaveValue(VIEWER_ZONE);
  });

  it('asks the server for the times every time it opens, and starts with none picked (where checkout sends a client whose time was just taken)', async () => {
    const availability = jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [{ start, end: start + 3600000 }],
      connected: true,
    });
    const first = render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
    await userEvent.click(screen.getByText(timeText(start)));
    first.unmount();

    // Opened again, as after the "pick another" link: a new request, and nothing picked.
    render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
    expect(availability).toHaveBeenCalledTimes(2);
    expect(bookButton()).toBeDisabled();
  });

  it('opens on the day it is asked to (the checkout\'s "Find a new time"), and on the first day without one', async () => {
    const first = Date.parse('2026-09-11T10:00:00Z');
    const later = Date.parse('2026-09-18T14:00:00Z');
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [{ start: first, end: first + 3600000 }, { start: later, end: later + 3600000 }],
      connected: true,
    });

    const withDay = render(
      <NylasBookingForm {...baseProps} preselectedDayKey={dayKeyOf(later, VIEWER_ZONE)} />
    );
    await waitFor(() => expect(screen.getByText(timeText(later))).toBeInTheDocument());
    expect(screen.queryByText(timeText(first))).toBeNull();
    withDay.unmount();

    render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(screen.getByText(timeText(first))).toBeInTheDocument());
    expect(screen.queryByText(timeText(later))).toBeNull();
  });

  it('ignores a day it has no times for', async () => {
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [{ start, end: start + 3600000 }],
      connected: true,
    });
    render(<NylasBookingForm {...baseProps} preselectedDayKey="2030-01-01" />);
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
  });

  it('cannot be submitted until a slot is chosen, then says what was chosen and what it costs', async () => {
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [{ start, end: start + 3600000 }],
      connected: true,
    });
    render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());

    expect(bookButton()).toBeDisabled();
    expect(screen.getByText('BookingPanel.pickATime')).toBeInTheDocument();

    await userEvent.click(screen.getByText(timeText(start)));
    await waitFor(() => expect(bookButton()).toBeEnabled());
    // "Wed 18 Nov · 10:00 am · 60 min" in the viewer's zone, and "Total for 60 min  $50"
    expect(screen.getByText('BookingPanel.totalFor')).toBeInTheDocument();
    expect(screen.getByText('$50')).toBeInTheDocument();
    expect(screen.queryByText('BookingPanel.pickATime')).not.toBeInTheDocument();
  });

  it('asks for a price check when a slot is picked', async () => {
    const onFetchTransactionLineItems = jest.fn();
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [{ start, end: start + 3600000 }],
      connected: true,
    });
    render(
      <NylasBookingForm {...baseProps} onFetchTransactionLineItems={onFetchTransactionLineItems} />
    );
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
    await userEvent.click(screen.getByText(timeText(start)));

    expect(onFetchTransactionLineItems).toHaveBeenCalledWith(
      expect.objectContaining({
        orderData: expect.objectContaining({
          bookingStart: new Date(start),
          bookingEnd: new Date(start + 3600000),
          priceVariantName: 'test',
        }),
      })
    );
  });

  it('submits the chosen times and length (what checkout reads)', async () => {
    const onSubmit = jest.fn();
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [{ start, end: start + 3600000 }],
      connected: true,
    });
    render(<NylasBookingForm {...baseProps} onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
    await userEvent.click(screen.getByText(timeText(start)));
    await userEvent.click(bookButton());

    // final-form also passes the form API and a callback after the values.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        bookingStartTime: String(start),
        bookingEndTime: String(start + 3600000),
        priceVariantName: 'test',
      })
    );
  });

  it('shows no "Choose your session" step when there is only one length', async () => {
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [{ start, end: start + 3600000 }],
      connected: true,
    });
    render(<NylasBookingForm {...baseProps} isPriceVariationsInUse />);
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
    expect(screen.queryByText('BookingPanel.chooseSession')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});

describe('session lengths', () => {
  // Each length has its own Nylas configuration on the server, so changing the length must fetch
  // that length's slots - not filter one list in the browser.
  const twoLengths = {
    ...baseProps,
    isPriceVariationsInUse: true,
    priceVariants: [
      { name: 'Quick', bookingLengthInMinutes: 30, priceInSubunits: 2500 },
      { name: 'Deep', bookingLengthInMinutes: 90, priceInSubunits: 9000 },
    ],
  };
  const half = Date.parse('2026-09-11T22:30:00Z');

  it('lists each length as a radio row with its name and price, the first chosen', async () => {
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [], connected: true });
    render(<NylasBookingForm {...twoLengths} />);
    const quick = await screen.findByRole('radio', { name: /Quick/ });
    const deep = screen.getByRole('radio', { name: /Deep/ });
    expect(quick).toHaveAttribute('aria-checked', 'true');
    expect(deep).toHaveAttribute('aria-checked', 'false');
    expect(within(quick).getByText('$25')).toBeInTheDocument();
    expect(within(deep).getByText('$90')).toBeInTheDocument();
  });

  it('asks for the preselected length, then refetches when another is chosen', async () => {
    const spy = jest
      .spyOn(api, 'nylasAvailability')
      .mockImplementation(async ({ priceVariantName }) => ({
        slots: [
          priceVariantName === 'Deep'
            ? slot('2026-09-11T22:30:00Z', 90)
            : slot('2026-09-11T20:00:00Z', 30),
        ],
        connected: true,
      }));
    render(<NylasBookingForm {...twoLengths} />);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ priceVariantName: 'Quick' }))
    );

    await userEvent.click(screen.getByRole('radio', { name: /Deep/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ priceVariantName: 'Deep' }))
    );
    expect(screen.getByRole('radio', { name: /Deep/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('clears a chosen slot, and shows the new length and price, when the length changes', async () => {
    jest.spyOn(api, 'nylasAvailability').mockImplementation(async () => ({
      slots: [slot('2026-09-11T22:30:00Z', 30), slot('2026-09-11T22:30:00Z', 90)],
      connected: true,
    }));
    render(<NylasBookingForm {...twoLengths} />);
    await waitFor(() => expect(screen.getByText(timeText(half))).toBeInTheDocument());
    await userEvent.click(screen.getByText(timeText(half)));
    await waitFor(() => expect(bookButton()).toBeEnabled());
    expect(screen.getAllByText('$25').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('radio', { name: /Deep/ }));
    await waitFor(() => expect(bookButton()).toBeDisabled());
    // The total follows the length chosen.
    expect(screen.getAllByText('$90').length).toBeGreaterThan(1);
  });
});

describe('the day strip and the month grid', () => {
  // Three consecutive days with times, at a different hour each day so which day's times are shown
  // can be told apart. Relative to now: a fixed date drifts into the past and the calendar then
  // blocks it.
  const days = () => {
    const base = Date.now() + 3 * 86400000;
    return [0, 1, 2].map(d => {
      const start = base + d * 86400000 + d * 3600000;
      return { start, end: start + 3600000 };
    });
  };
  const dayButtons = container =>
    Array.from(container.querySelectorAll('button[aria-pressed][aria-label]')).filter(
      b => !/^\d{1,2}:\d{2}/.test(b.textContent)
    );

  it('shows five days from the first with times, leaving the others unselectable', async () => {
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: days(), connected: true });
    const { container } = render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(container.querySelector('button[aria-label]')).toBeTruthy());

    const buttons = dayButtons(container).slice(0, 5);
    expect(buttons).toHaveLength(5);
    expect(buttons.filter(b => !b.disabled)).toHaveLength(3);
    expect(buttons.filter(b => b.disabled)).toHaveLength(2);
    // The first day with times is the one selected to begin with.
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves every day with times selectable, not just the first (it shows that day’s times)', async () => {
    // Regression: the old calendar's selection could not move off the first available day.
    const slots = days();
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots, connected: true });
    const { container } = render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(screen.getByText(timeText(slots[0].start))).toBeInTheDocument());

    const [, second, third] = dayButtons(container);
    await userEvent.click(second);
    expect(screen.getByText(timeText(slots[1].start))).toBeInTheDocument();
    expect(screen.queryByText(timeText(slots[0].start))).not.toBeInTheDocument();

    await userEvent.click(third);
    expect(screen.getByText(timeText(slots[2].start))).toBeInTheDocument();
  });

  it('"More dates" opens a month grid where only days with times can be picked, and "Fewer dates" closes it', async () => {
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: days(), connected: true });
    const { container } = render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(container.querySelector('button[aria-label]')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'BookingPanel.moreDates' }));
    // A month has far more days than the three with times, so most cells are unselectable; the
    // client discovers empty days by looking, not by clicking through them.
    const cells = Array.from(container.querySelectorAll('button[aria-label]')).filter(
      b => !b.hasAttribute('aria-expanded') && /^\d{1,2}$/.test(b.textContent)
    );
    expect(cells.length).toBeGreaterThanOrEqual(28);
    expect(cells.filter(b => b.disabled).length).toBeGreaterThan(20);
    expect(cells.filter(b => !b.disabled).length).toBeGreaterThanOrEqual(1);
    expect(cells.filter(b => !b.disabled).length).toBeLessThanOrEqual(3);

    // Picking one closes the grid and shows that day's times.
    const pick = cells.find(b => !b.disabled && b.getAttribute('aria-pressed') === 'false');
    if (pick) {
      await userEvent.click(pick);
      expect(
        screen.queryByRole('button', { name: 'BookingPanel.fewerDates' })
      ).not.toBeInTheDocument();
    } else {
      await userEvent.click(screen.getByRole('button', { name: 'BookingPanel.fewerDates' }));
    }
    expect(screen.getByRole('button', { name: 'BookingPanel.moreDates' })).toBeInTheDocument();
  });
});

describe('messaging the coach', () => {
  const start = Date.parse('2026-09-11T22:30:00Z');
  const withSlot = () =>
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({
      slots: [{ start, end: start + 3600000 }],
      connected: true,
    });

  it('offers "Message {name}" in the panel and calls the existing inquiry flow', async () => {
    withSlot();
    const onMessage = jest.fn();
    render(<NylasBookingForm {...baseProps} authorFirstName="Maya" onMessage={onMessage} />);
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
    expect(screen.getByText('BookingPanel.askFirst')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'BookingPanel.message' }));
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('does not offer it to the coach on her own session', async () => {
    withSlot();
    render(
      <NylasBookingForm {...baseProps} isOwnListing authorFirstName="Maya" onMessage={jest.fn()} />
    );
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'BookingPanel.message' })).not.toBeInTheDocument();
  });

  it('in the phone sheet is a small link beside the cancelling line, not the block', async () => {
    withSlot();
    render(
      <BookingLayoutContext.Provider value={LAYOUT_SHEET}>
        <NylasBookingForm {...baseProps} authorFirstName="Maya" onMessage={jest.fn()} />
      </BookingLayoutContext.Provider>
    );
    await waitFor(() => expect(screen.getByText(timeText(start))).toBeInTheDocument());
    expect(screen.queryByText('BookingPanel.askFirst')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BookingPanel.message' })).toBeInTheDocument();
    expect(screen.getByText('BookingPanel.freeCancel')).toBeInTheDocument();
  });
});

describe('NylasBookingForm: the line under the Book button', () => {
  const HOUR = 3600000;
  // A time on the hour, `hours` from now.
  const slotIn = hours => {
    const start = Math.ceil((Date.now() + hours * HOUR) / HOUR) * HOUR;
    return { start, end: start + HOUR };
  };
  const pick = async hours => {
    const s = slotIn(hours);
    jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots: [s], connected: true });
    render(<NylasBookingForm {...baseProps} />);
    await waitFor(() => expect(screen.getByText(timeText(s.start))).toBeInTheDocument());
    return s;
  };

  it('says "Free to cancel up to 48 hours before." until a time is picked', async () => {
    await pick(72);
    expect(screen.getByText('BookingPanel.freeCancel')).toBeInTheDocument();
    expect(screen.queryByText('BookingPanel.insideFreeWindow')).not.toBeInTheDocument();
  });

  it('a time 72 hours out keeps the free-to-cancel line', async () => {
    const s = await pick(72);
    await userEvent.click(screen.getByText(timeText(s.start)));
    expect(screen.getByText('BookingPanel.freeCancel')).toBeInTheDocument();
    expect(screen.queryByText('BookingPanel.insideFreeWindow')).not.toBeInTheDocument();
  });

  it('a time 30 hours out says it is less than 48 hours away instead, and never the free line', async () => {
    const s = await pick(30);
    await userEvent.click(screen.getByText(timeText(s.start)));
    expect(screen.getByText('BookingPanel.insideFreeWindow')).toBeInTheDocument();
    expect(screen.queryByText('BookingPanel.freeCancel')).not.toBeInTheDocument();
  });

  it('says it in these words', () => {
    expect(en['BookingPanel.insideFreeWindow']).toBe(
      "Less than 48 hours away: can't be moved or cancelled for a refund."
    );
    expect(en['BookingPanel.freeCancel']).toBe('Free to cancel up to 48 hours before.');
  });

  it('keeps "Times in your timezone (…) · Change" on one line, so "Change" is never alone', () => {
    const css = fs.readFileSync(path.join(__dirname, 'NylasBookingForm.module.css'), 'utf8');
    const rule = css.match(/\.timeZoneLine\s*\{([^}]*)\}/)[1];
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });
});
