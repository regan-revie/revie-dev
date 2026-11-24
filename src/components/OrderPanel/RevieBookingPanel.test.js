import React from 'react';
import '@testing-library/jest-dom';

import { createUser, createListing } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import * as api from '../../util/api';
import enMessages from '../../translations/en.json';

import NylasBookingForm from './NylasBookingForm/NylasBookingForm';
import RevieBookingPanel, { PANEL_STATES } from './RevieBookingPanel';
import { pronounWords } from './BookingPanelParts';

const { screen, waitFor, userEvent, within } = testingLibrary;
const messages = enMessages;

const VIEWER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
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

const coach = (pronouns = 'she-her') =>
  createUser('coach-1', {
    profile: { displayName: 'Maya R.', abbreviatedName: 'MR', publicData: { pronouns } },
  });

const priceVariants = [
  { name: '30-minute session', bookingLengthInMinutes: 30, priceInSubunits: 6000 },
  { name: '60-minute session', bookingLengthInMinutes: 60, priceInSubunits: 11000 },
];

// Tomorrow-ish, so "Next: ..." is a real day in every timezone.
const start = Date.now() + 4 * 86400000;
const slots = [{ start, end: start + 30 * 60000 }];

const setPhone = isPhone => {
  window.matchMedia = jest.fn().mockImplementation(query => ({
    matches: isPhone,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
};

const baseProps = () => ({
  state: PANEL_STATES.FORM,
  listing: createListing('session-1', { publicData: { calendarBookingEnabled: true } }),
  author: coach(),
  isOwnListing: false,
  price: { amount: 6000, currency: 'USD' },
  priceVariants,
  BookingForm: NylasBookingForm,
  bookingFormProps: {
    listingId: 'session-1',
    isOwnListing: false,
    isPriceVariationsInUse: true,
    priceVariants,
    price: { amount: 6000, currency: 'USD' },
    onSubmit: jest.fn(),
    onFetchTransactionLineItems: jest.fn(),
    marketplaceName: 'Revie',
  },
  setupCardProps: {},
  onContactUser: jest.fn(),
  isOrderOpen: false,
  onOpenOrder: jest.fn(),
  onCloseOrder: jest.fn(),
  onManageDisableScrolling: jest.fn(),
});

beforeEach(() => {
  jest.spyOn(api, 'nylasAvailability').mockResolvedValue({ slots, connected: true });
});
afterEach(() => {
  jest.restoreAllMocks();
  delete window.matchMedia;
});

describe('on desktop', () => {
  it('is a card: "Book with Maya", the three steps, the total and the book button; no bar', async () => {
    setPhone(false);
    render(<RevieBookingPanel {...baseProps()} />, { messages });

    const panel = await screen.findByTestId('booking-panel');
    expect(within(panel).getByRole('heading', { name: 'Book with Maya' })).toBeInTheDocument();
    expect(within(panel).getByText('Choose your session')).toBeInTheDocument();
    expect(await within(panel).findByText('Pick a day')).toBeInTheDocument();
    expect(within(panel).getByText('Pick a time')).toBeInTheDocument();
    expect(within(panel).getByText('No booking fees')).toBeInTheDocument();
    expect(within(panel).getByText('Free to cancel up to 48 hours before.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Message Maya' })).toBeInTheDocument();
    expect(screen.queryByTestId('book-bar')).not.toBeInTheDocument();
  });

  it('"Message Maya" uses the existing inquiry flow with the coach', async () => {
    setPhone(false);
    const props = baseProps();
    render(<RevieBookingPanel {...props} />, { messages });
    await userEvent.click(await screen.findByRole('button', { name: 'Message Maya' }));
    expect(props.onContactUser).toHaveBeenCalledWith(props.author);
  });

  it('says "Ask her first" for she/her and "Ask them first" for they/them or no pronouns', async () => {
    setPhone(false);
    const { unmount } = render(<RevieBookingPanel {...baseProps()} />, { messages });
    expect(await screen.findByText("Not sure Maya's the one? Ask her first.")).toBeInTheDocument();
    unmount();

    render(<RevieBookingPanel {...baseProps()} author={coach('they-them')} />, { messages });
    expect(await screen.findByText("Not sure Maya's the one? Ask them first.")).toBeInTheDocument();
  });
});

describe('on a phone', () => {
  it('is a bar with the price, the length, "Next: {day}" and a "See times" button; the sheet is closed', async () => {
    setPhone(true);
    const props = baseProps();
    render(<RevieBookingPanel {...props} />, { messages });

    const bar = await screen.findByTestId('book-bar');
    expect(within(bar).getByText('$60')).toBeInTheDocument();
    expect(within(bar).getByText(/30 min/)).toBeInTheDocument();
    expect(await within(bar).findByText(/^Next: \w{3} \d{1,2} \w{3}$/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-panel')).not.toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'See times' }));
    expect(props.onOpenOrder).toHaveBeenCalledTimes(1);
  });

  it('opens a sheet with the same steps, a sticky total and the book button, and books', async () => {
    setPhone(true);
    const props = baseProps();
    render(<RevieBookingPanel {...props} isOrderOpen />, { messages });

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Book with Maya' })).toBeInTheDocument();
    expect(within(sheet).getByText('Choose your session')).toBeInTheDocument();
    expect(await within(sheet).findByText('Pick a day')).toBeInTheDocument();

    // The same booking behaviour as the panel: pick a time, then book.
    const book = within(sheet).getByRole('button', { name: 'Book a session' });
    expect(book).toBeDisabled();
    await userEvent.click(await within(sheet).findByText(timeText(start)));
    await waitFor(() => expect(book).toBeEnabled());
    // The summary and total sit above the button in the sheet.
    expect(within(sheet).getByText(/· 30 min$/)).toBeInTheDocument();
    await userEvent.click(book);
    expect(props.bookingFormProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.bookingFormProps.onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        bookingStartTime: String(start),
        bookingEndTime: String(start + 30 * 60000),
        priceVariantName: '30-minute session',
      })
    );

    // The cancelling line and the small "Message Maya" link share a row (not the panel's block).
    expect(within(sheet).getByText('Free to cancel up to 48 hours before.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Message Maya' })).toBeInTheDocument();
    expect(within(sheet).queryByText(/Not sure Maya/)).not.toBeInTheDocument();
  });

  it('closes with the close button and with Escape', async () => {
    setPhone(true);
    const props = baseProps();
    render(<RevieBookingPanel {...props} isOrderOpen />, { messages });
    const sheet = await screen.findByRole('dialog');

    await userEvent.click(within(sheet).getByRole('button', { name: 'CLOSE' }));
    expect(props.onCloseOrder).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    expect(props.onCloseOrder).toHaveBeenCalledTimes(2);
  });

  it('locks the page behind the sheet while it is open', async () => {
    setPhone(true);
    const props = baseProps();
    render(<RevieBookingPanel {...props} isOrderOpen />, { messages });
    await screen.findByRole('dialog');
    expect(props.onManageDisableScrolling).toHaveBeenCalledWith('BookingSheet', true);
  });

  it("never opens the sheet on the coach's own session", async () => {
    setPhone(true);
    render(<RevieBookingPanel {...baseProps()} isOwnListing isOrderOpen />, { messages });
    await screen.findByTestId('book-bar');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('when the coach cannot be booked yet: what a client sees', () => {
  const clientProps = (pronouns, extra = {}) => ({
    ...baseProps(),
    state: PANEL_STATES.NOT_TAKING,
    author: coach(pronouns),
    ...extra,
  });

  it('shows the prices, the explanation, "Find another coach" and "Message Maya"', async () => {
    setPhone(false);
    const props = clientProps('she-her');
    render(<RevieBookingPanel {...props} />, { messages });

    const card = await screen.findByTestId('not-taking-bookings');
    expect(within(card).getByRole('heading', { name: 'Book with Maya' })).toBeInTheDocument();
    expect(within(card).getByText('30-minute session')).toBeInTheDocument();
    expect(within(card).getByText('$60')).toBeInTheDocument();
    expect(within(card).getByText('$110')).toBeInTheDocument();
    expect(within(card).getByText("Maya isn't taking bookings yet.")).toBeInTheDocument();
    expect(
      within(card).getByText(
        "She's setting up her calendar. Message her, or find a coach who's free now."
      )
    ).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Find another coach' })).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'Message Maya' }));
    expect(props.onContactUser).toHaveBeenCalledWith(props.author);
    // Nothing to book, so no booking steps.
    expect(screen.queryByText('Pick a day')).not.toBeInTheDocument();
  });

  it('uses "They\'re ... their ... them" with they/them, with another set of pronouns, or with none', async () => {
    setPhone(false);
    const they = "They're setting up their calendar. Message them, or find a coach who's free now.";
    const { unmount } = render(<RevieBookingPanel {...clientProps('they-them')} />, { messages });
    expect(await screen.findByText(they)).toBeInTheDocument();
    unmount();

    const { unmount: unmount2 } = render(<RevieBookingPanel {...clientProps('she-they')} />, {
      messages,
    });
    expect(await screen.findByText(they)).toBeInTheDocument();
    unmount2();

    render(<RevieBookingPanel {...clientProps(null)} />, { messages });
    expect(await screen.findByText(they)).toBeInTheDocument();
  });

  it('uses he/him as set', async () => {
    setPhone(false);
    render(<RevieBookingPanel {...clientProps('he-him')} />, { messages });
    expect(
      await screen.findByText(
        "He's setting up his calendar. Message him, or find a coach who's free now."
      )
    ).toBeInTheDocument();
  });

  it('is the same card on a phone (there is nothing to open a sheet for)', async () => {
    setPhone(true);
    render(<RevieBookingPanel {...clientProps('she-her')} />, { messages });
    expect(await screen.findByTestId('not-taking-bookings')).toBeInTheDocument();
    expect(screen.queryByTestId('book-bar')).not.toBeInTheDocument();
  });
});

describe('when the coach cannot be booked yet: what the coach sees on her own session', () => {
  const setup = overrides => ({
    ...baseProps(),
    state: PANEL_STATES.SETUP,
    isOwnListing: true,
    setupCardProps: {
      calendarConnected: false,
      calendarReconnectNeeded: false,
      payoutDetailsSet: false,
      profileFinished: undefined,
      bookable: false,
      ...overrides,
    },
  });

  it('says "Clients can\'t book this session yet." with "2 steps left" and a dashed circle and action per row', async () => {
    setPhone(false);
    render(<RevieBookingPanel {...setup({})} />, { messages });

    const card = await screen.findByTestId('setup-card');
    expect(within(card).getByRole('heading')).toHaveTextContent(
      "Clients can't book this session yet."
    );
    expect(within(card).getByText('2 steps left')).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'Connect your Google Calendar' })
    ).toHaveTextContent('Connect →');
    expect(within(card).getByRole('button', { name: 'Add your payout details' })).toHaveTextContent(
      'Add →'
    );
  });

  it('says "One step left" with a tick and the word "Connected" for what is done', async () => {
    setPhone(false);
    render(<RevieBookingPanel {...setup({ calendarConnected: true })} />, { messages });

    const card = await screen.findByTestId('setup-card');
    expect(within(card).getByText('One step left')).toBeInTheDocument();
    expect(within(card).getByText('Connected')).toBeInTheDocument();
    expect(
      within(card).queryByRole('button', { name: 'Connect your Google Calendar' })
    ).not.toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'Add your payout details' })
    ).toBeInTheDocument();
  });

  it('with a broken Google connection says "Reconnect →" and counts it as a step', async () => {
    setPhone(false);
    render(
      <RevieBookingPanel
        {...setup({
          calendarConnected: false,
          calendarReconnectNeeded: true,
          payoutDetailsSet: true,
        })}
      />,
      { messages }
    );
    const card = await screen.findByTestId('setup-card');
    expect(within(card).getByRole('heading')).toHaveTextContent(
      "Clients can't book this session right now."
    );
    expect(within(card).getByText('One step left')).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'Reconnect your Google Calendar' })
    ).toHaveTextContent('Reconnect →');
    expect(within(card).getByText('Added')).toBeInTheDocument();
  });

  it('keeps the profile row (three rows) when the profile questions exist', async () => {
    setPhone(false);
    render(
      <RevieBookingPanel
        {...setup({
          calendarConnected: true,
          payoutDetailsSet: true,
          profileFinished: false,
          bookable: true,
        })}
      />,
      { messages }
    );
    const card = await screen.findByTestId('setup-card');
    expect(within(card).getByRole('heading')).toHaveTextContent(
      "Clients can book this session, but can't find it yet."
    );
    expect(within(card).getAllByRole('listitem')).toHaveLength(3);
    expect(within(card).getByRole('button', { name: 'Finish your profile' })).toBeInTheDocument();
  });
});

describe('pronounWords', () => {
  it('reads she/her and he/him as set and everything else as they/them', () => {
    expect(pronounWords('she-her')).toEqual({
      subjectIs: "She's",
      object: 'her',
      possessive: 'her',
    });
    expect(pronounWords('he-him')).toEqual({ subjectIs: "He's", object: 'him', possessive: 'his' });
    ['they-them', 'she-they', 'he-they', 'other', undefined, ''].forEach(key => {
      expect(pronounWords(key)).toEqual({
        subjectIs: "They're",
        object: 'them',
        possessive: 'their',
      });
    });
  });
});
