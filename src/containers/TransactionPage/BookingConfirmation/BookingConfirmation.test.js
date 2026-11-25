import React from 'react';
import '@testing-library/jest-dom';
import Decimal from 'decimal.js';
import { createIntl } from 'react-intl';

import * as api from '../../../util/api';
import en from '../../../translations/en.json';
import { types as sdkTypes } from '../../../util/sdkLoader';
import {
  createBooking,
  createCurrentUser,
  createListing,
  createMessage,
  createTransaction,
  createUser,
} from '../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';
import BookingConfirmation from './BookingConfirmation';

const { Money } = sdkTypes;
const { screen, within, userEvent, waitFor } = testingLibrary;
const noop = () => null;
const HOUR = 3600000;

// The page's own words: the real messages, so the tests read what the client reads.
const messages = en;
const intl = createIntl({ locale: 'en', messages: en });

const coach = createUser('coach', {
  profile: { displayName: 'Maya R.', abbreviatedName: 'MR', publicData: { pronouns: 'she-her' } },
});
const client = createCurrentUser('client', {
  profile: {
    firstName: 'Jess',
    lastName: 'Lee',
    displayName: 'Jess L.',
    abbreviatedName: 'JL',
  },
});

const START = new Date(Date.now() + 5 * 24 * HOUR);
const END = new Date(START.getTime() + HOUR);

const listingWith = (publicData = {}) =>
  createListing(
    'listing-1',
    {
      title: 'Get clear on your next career move, then make it.',
      publicData: {
        listingType: 'signature-session',
        transactionProcessAlias: 'default-booking/release-7',
        unitType: 'fixed',
        calendarBookingEnabled: true,
        ...publicData,
      },
    },
    { author: coach }
  );

const sessionLine = {
  code: 'line-item/fixed',
  includeFor: ['customer', 'provider'],
  quantity: new Decimal(1),
  unitPrice: new Money(11000, 'USD'),
  lineTotal: new Money(11000, 'USD'),
  reversal: false,
};
const providerCommission = {
  code: 'line-item/provider-commission',
  includeFor: ['provider'],
  unitPrice: new Money(11000, 'USD'),
  lineTotal: new Money(-2200, 'USD'),
  reversal: false,
};
const promoLine = {
  code: 'line-item/promo-discount',
  includeFor: ['customer'],
  quantity: new Decimal(1),
  unitPrice: new Money(-1650, 'USD'),
  lineTotal: new Money(-1650, 'USD'),
  reversal: false,
};

const transactionWith = ({ metadata, protectedData, lineItems, total } = {}) => {
  const tx = createTransaction({
    id: 'tx-1',
    processName: 'default-booking',
    booking: createBooking('b-1', { start: START, end: END }),
    lineItems: lineItems || [sessionLine, providerCommission],
    total: total || new Money(11000, 'USD'),
  });
  return {
    ...tx,
    attributes: {
      ...tx.attributes,
      metadata: metadata || {},
      protectedData: protectedData || {},
    },
  };
};

const status = (overrides = {}) => ({
  source: 'database',
  status: 'created',
  bookingStart: START.toISOString(),
  bookingEnd: END.toISOString(),
  freeCancellationNow: true,
  rescheduleAllowed: true,
  cancellationPending: false,
  meetLink: 'https://meet.google.com/abc-defg',
  calendarUrl: 'https://example.com/api/nylas/calendar/tok/revie-session.ics',
  ...overrides,
});

const baseProps = {
  provider: coach,
  currentUser: client,
  messages: [],
  showSendMessageForm: true,
  onMessageSubmit: jest.fn(),
  sendMessageInProgress: false,
  onCancelledOnCalendar: noop,
};

const renderPage = ({ processState = 'accepted', listing, transaction, ...extra } = {}) =>
  render(
    <BookingConfirmation
      {...baseProps}
      intl={intl}
      listing={listing || listingWith()}
      transaction={transaction || transactionWith()}
      processState={processState}
      {...extra}
    />,
    { messages }
  );

beforeEach(() => {
  window.matchMedia = jest.fn(() => ({
    matches: true,
    addEventListener: noop,
    removeEventListener: noop,
  }));
  jest.spyOn(api, 'nylasBookingStatus').mockResolvedValue(status());
});
afterEach(() => jest.restoreAllMocks());

describe('the hero', () => {
  it('shows the coach and the client with name pills, the date card, "You\'re booked." and the title with the coach in caps', async () => {
    renderPage();
    const hero = screen.getByTestId('booking-hero');
    expect(within(hero).getByRole('heading', { level: 1 })).toHaveTextContent("You're booked.");
    expect(within(hero).getByText('Maya')).toBeInTheDocument();
    expect(within(hero).getByText('You')).toBeInTheDocument();
    // The client has no photo here: her initials, on lavender.
    expect(within(hero).getAllByTestId('coach-photo-initials')).toHaveLength(2);
    expect(within(hero).getAllByTestId('coach-photo')).toHaveLength(2);
    const date = within(hero).getByTestId('hero-date');
    expect(date).toHaveTextContent(/[A-Z][a-z]{2} · [A-Z][a-z]{2}/);
    expect(date).toHaveTextContent(/\d{1,2}:\d{2} [AP]M/);
    expect(hero).toHaveTextContent(
      'Get clear on your next career move, then make it · with Maya R.'
    );
  });
});

describe('each state', () => {
  it('booked: the session card, what happens next, the message card and the payment box', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /Join on Google Meet/ })).toHaveAttribute(
      'href',
      'https://meet.google.com/abc-defg'
    );
    expect(screen.getByRole('link', { name: /Add to calendar/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What happens next.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Message Maya' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Payment' })).toBeInTheDocument();
    expect(screen.getByText('Free to cancel or move until', { exact: false })).toBeInTheDocument();
  });

  it('confirming: "Confirming your session…" with the line about the coach\'s calendar', () => {
    renderPage({ processState: 'preauthorized' });
    const panel = screen.getByTestId('state-confirming');
    expect(within(panel).getByRole('heading')).toHaveTextContent('Confirming your session…');
    expect(panel).toHaveTextContent(
      "We're locking in your time with Maya. This usually takes a few seconds."
    );
    expect(screen.queryByRole('heading', { name: 'What happens next.' })).toBeNull();
  });

  it.each([['declined'], ['expired'], ['payment-expired']])(
    "didn't go through (%s): not charged, and a way to pick another time",
    processState => {
      renderPage({ processState });
      const panel = screen.getByTestId('state-declined');
      expect(within(panel).getByRole('heading')).toHaveTextContent(
        "Uh-oh! That one didn't go through."
      );
      expect(panel).toHaveTextContent("You haven't been charged.");
      expect(within(panel).getByRole('link', { name: 'Pick another time' })).toHaveAttribute(
        'href',
        expect.stringContaining('/l/')
      );
    }
  );

  it('the client cancelled early: "Session cancelled.", the refund, and "Book Maya again"', () => {
    renderPage({
      processState: 'canceled',
      transaction: transactionWith({ metadata: { cancelledBy: 'client' } }),
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Session cancelled.');
    const section = screen.getByTestId('cancelled-section');
    expect(section).toHaveTextContent('Your refund is on its way.');
    expect(section).toHaveTextContent(
      "We've sent your refund of $110.00. Expect it in 5 to 10 days."
    );
    expect(section).toHaveTextContent("We've also taken the session off both your calendars.");
    expect(within(section).getByRole('link', { name: 'Book Maya again' })).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Find a coach' })).toBeInTheDocument();
    // Nothing left to join, move or cancel.
    expect(screen.queryByRole('heading', { name: 'What happens next.' })).toBeNull();
    expect(screen.queryByText('Reschedule')).toBeNull();
  });

  it('the client cancelled late: charged, and "We\'ve let Maya know."', () => {
    renderPage({ processState: 'late-cancelled' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Session cancelled.');
    const section = screen.getByTestId('cancelled-section');
    expect(section).toHaveTextContent(
      "You cancelled less than 48 hours before, so we've charged the full price. We've let Maya know."
    );
    expect(section).not.toHaveTextContent('refund is on its way');
  });

  it('the coach cancelled: a full refund, and "Book another time"', () => {
    renderPage({
      processState: 'canceled',
      transaction: transactionWith({ metadata: { cancelledBy: 'provider' } }),
    });
    const section = screen.getByTestId('cancelled-section');
    expect(section).toHaveTextContent(
      "Maya had to cancel, so we've refunded you in full. Expect it in 5 to 10 days."
    );
    expect(within(section).getByRole('link', { name: 'Book another time' })).toBeInTheDocument();
  });

  it('cancelled from this page: the heading and the refund section replace the card at once', async () => {
    jest.spyOn(api, 'nylasCancelBooking').mockResolvedValue({ ok: true });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: /Cancel this session\?/ })).toBeInTheDocument();
    expect(screen.getByText("You'll get a full refund of $110.00.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Session cancelled.')
    );
    expect(screen.getByTestId('cancelled-section')).toHaveTextContent('Your refund is on its way.');
  });

  it('done: the session has been, so no card and no next steps', () => {
    renderPage({ processState: 'delivered' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Your booking was completed.'
    );
    expect(screen.queryByRole('heading', { name: 'What happens next.' })).toBeNull();
  });
});

describe('"What happens next."', () => {
  const stepTitles = () =>
    screen
      .getAllByRole('listitem')
      .map(li => li.textContent)
      .filter(text => /^\d/.test(text));

  it('hides "Before your session" when the session has neither pre_work nor a prep link', async () => {
    renderPage({ listing: listingWith({ pre_work: '   ', prep_link: '' }) });
    await screen.findByRole('heading', { name: 'What happens next.' });
    expect(screen.queryByText('Before your session.')).toBeNull();
    expect(screen.queryByRole('link', { name: /prep questionnaire/ })).toBeNull();
    // The numbers close up: 1 and 2.
    expect(stepTitles()).toHaveLength(2);
    expect(stepTitles()[0]).toMatch(/^1Check your inbox\./);
    expect(stepTitles()[1]).toMatch(/^2Join from here or the invite\./);
  });

  it('shows pre_work as plain text, with no button when there is no prep link', async () => {
    renderPage({
      listing: listingWith({ pre_work: 'Think about the one decision you keep avoiding.' }),
    });
    expect(await screen.findByText('Before your session.')).toBeInTheDocument();
    expect(screen.getByText('Think about the one decision you keep avoiding.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /prep questionnaire/ })).toBeNull();
    expect(stepTitles()).toHaveLength(3);
  });

  it('shows the button alone when there is a prep link and no pre_work', async () => {
    renderPage({ listing: listingWith({ prep_link: 'https://forms.gle/abc' }) });
    const button = await screen.findByRole('link', { name: /Open your prep questionnaire/ });
    expect(button).toHaveAttribute('href', 'https://forms.gle/abc');
    expect(button).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Before your session.')).toBeInTheDocument();
  });

  it('shows both, and never a link that is not a web link', async () => {
    const { unmount } = renderPage({
      listing: listingWith({ pre_work: 'Bring a question.', prep_link: 'forms.gle/abc' }),
    });
    expect(await screen.findByText('Bring a question.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /prep questionnaire/ })).toHaveAttribute(
      'href',
      'https://forms.gle/abc'
    );
    unmount();

    renderPage({ listing: listingWith({ prep_link: 'javascript:alert(1)' }) });
    await screen.findByRole('heading', { name: 'What happens next.' });
    expect(screen.queryByRole('link', { name: /prep questionnaire/ })).toBeNull();
    expect(screen.queryByText('Before your session.')).toBeNull();
  });
});

describe('the message card', () => {
  const msg = (id, content, sender) => createMessage(id, { content }, { sender });

  it('shows the latest two messages, mine on the right, with the way to the whole conversation', async () => {
    renderPage({
      messages: [
        msg('m1', 'First of three', coach),
        msg('m2', 'Hi Maya! Excited for this.', client),
        msg('m3', 'Perfect. See you Thursday!', coach),
      ],
    });
    const bubbles = within(screen.getByTestId('message-bubbles'));
    expect(bubbles.queryByText('First of three')).toBeNull();
    expect(bubbles.getByText('Hi Maya! Excited for this.').className).toMatch(/mine/);
    expect(bubbles.getByText('Perfect. See you Thursday!').className).toMatch(/theirs/);
    expect(
      screen.getByRole('link', { name: 'See the whole conversation in your inbox' })
    ).toBeInTheDocument();
  });

  it("starts with the note written at checkout, as the client's first words", async () => {
    renderPage({
      transaction: transactionWith({
        protectedData: { customerDefaultMessage: 'I want to talk about a promotion.' },
      }),
    });
    expect(screen.getByText('I want to talk about a promotion.').className).toMatch(/mine/);
  });

  it("sends what is typed through the page's own sender, and clears the box", async () => {
    const onMessageSubmit = jest.fn();
    renderPage({ onMessageSubmit });
    await userEvent.type(screen.getByLabelText('Message'), 'See you then');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onMessageSubmit).toHaveBeenCalledWith({ message: 'See you then' }, expect.any(Object));
    onMessageSubmit.mock.calls[0][1].reset();
    await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''));
  });

  it('has no send box when messaging is not allowed', () => {
    renderPage({ showSendMessageForm: false });
    expect(screen.queryByLabelText('Message')).toBeNull();
  });
});

describe('the payment box', () => {
  it('shows the price, a promo discount if there was one, and the total paid; no receipt link', () => {
    renderPage({
      transaction: transactionWith({
        lineItems: [sessionLine, promoLine, providerCommission],
        total: new Money(9350, 'USD'),
        metadata: { promo: { code: 'NEWYEAR15' } },
      }),
    });
    expect(screen.getByTestId('payment-session')).toHaveTextContent('$110.00');
    expect(screen.getByText('Promo discount (NEWYEAR15)')).toBeInTheDocument();
    expect(screen.getByTestId('payment-discount')).toHaveTextContent('−$16.50');
    expect(screen.getByTestId('payment-total')).toHaveTextContent('$93.50');
    expect(screen.queryByText(/receipt/i)).toBeNull();
  });

  it('has no discount line without a code', () => {
    renderPage();
    expect(screen.queryByTestId('payment-discount')).toBeNull();
    expect(screen.getByTestId('payment-total')).toHaveTextContent('$110.00');
  });
});

describe('wording', () => {
  const banned = /\b(orders?|requests?|sales?|listings?)\b/i;

  it.each([
    ['booked', { processState: 'accepted' }],
    ['confirming', { processState: 'preauthorized' }],
    ['declined', { processState: 'declined' }],
    ['cancelled', { processState: 'late-cancelled' }],
  ])('never says order, request, sale or listing on the %s page', async (_, props) => {
    renderPage(props);
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(50));
    expect(document.body.textContent).not.toMatch(banned);
  });

  it('none of the messages it uses does either', () => {
    const offenders = Object.keys(en)
      .filter(k => k.startsWith('BookingConfirmation.') || k.startsWith('ManageCalendarBooking.'))
      .filter(k => banned.test(en[k]))
      .map(k => `${k}: ${en[k]}`);
    expect(offenders).toEqual([]);
  });

  it('the browser tab reads "Your booking with Maya | Revie"', () => {
    expect(en['BookingConfirmation.pageTitle']).toBe('Your booking with {name} | Revie');
  });
});
