import React from 'react';
import '@testing-library/jest-dom';
import { IntlProvider } from 'react-intl';

import { NamedLink } from '../../components';
import { FormattedMessage } from '../../util/reactIntl';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import en from '../../translations/en.json';
import { getErrorMessages, isSlotTakenError } from './ErrorMessages';

const { screen } = testingLibrary;

const networkFailure = { type: 'error', name: 'TypeError', message: 'Failed to fetch' };
const messageIdOf = element => element?.props?.children?.props?.id;

describe('getErrorMessages()', () => {
  it('tells the client nothing was charged when the initiate request never got an answer', () => {
    const messages = getErrorMessages(false, networkFailure, false, null, null, null);
    expect(messageIdOf(messages.initiateOrderErrorMessage)).toBe('CheckoutPage.networkError');
  });

  it('says the same when the price estimate could not be reached', () => {
    const messages = getErrorMessages(false, null, false, null, networkFailure, null);
    expect(messageIdOf(messages.speculateErrorMessage)).toBe('CheckoutPage.networkError');
  });

  it('keeps the generic message for an error the server actually returned', () => {
    const serverError = { type: 'error', name: 'Error', message: 'boom', status: 500 };
    const messages = getErrorMessages(false, serverError, false, null, null, null);
    expect(messageIdOf(messages.initiateOrderErrorMessage)).toBe('CheckoutPage.initiateOrderError');
  });

  describe('a time that was just taken (Sharetribe answered 409)', () => {
    const slotTaken = {
      type: 'error',
      name: 'Error',
      status: 409,
      apiErrors: [{ status: 409, code: 'transaction-booking-time-not-available' }],
    };
    // What the Sentry issue looked like: a 409 on the price check, with no code we recognise.
    const plain409 = { type: 'error', name: 'Error', status: 409, apiErrors: [] };
    const pickAnother = { link: 'pick another' };
    const listingLink = { link: 'the listing page' };

    it.each([['the booking-time code', slotTaken], ['a plain 409', plain409]])(
      'says so on the price check, with a link to pick another time (%s)',
      (_, error) => {
        const messages = getErrorMessages(
          false,
          null,
          false,
          null,
          error,
          listingLink,
          pickAnother
        );
        const element = messages.speculateErrorMessage;
        expect(element.props.children.props.id).toBe('CheckoutPage.bookingTimeJustTaken');
        expect(element.props.children.props.values.pickAnotherTimeLink).toBe(pickAnother);
      }
    );

    it('says so when the real request is refused, too', () => {
      const messages = getErrorMessages(
        false,
        plain409,
        false,
        null,
        null,
        listingLink,
        pickAnother
      );
      expect(messageIdOf(messages.initiateOrderErrorMessage)).toBe(
        'CheckoutPage.bookingTimeJustTaken'
      );
    });

    it('does not add the generic "Failed to fetch breakdown information" beside it', () => {
      const messages = getErrorMessages(
        false,
        null,
        false,
        null,
        plain409,
        listingLink,
        pickAnother
      );
      expect(messages.speculateTransactionErrorMessage).toBeNull();
    });

    it('still shows that generic line for a different failure', () => {
      const serverError = { type: 'error', name: 'Error', status: 500, apiErrors: [] };
      const messages = getErrorMessages(
        false,
        null,
        false,
        null,
        serverError,
        listingLink,
        pickAnother
      );
      expect(messages.speculateTransactionErrorMessage).not.toBeNull();
    });

    it('leaves a conflict that has its own message alone (a provider with no payouts, stock)', () => {
      const noStripe = {
        type: 'error',
        status: 409,
        apiErrors: [{ code: 'transaction-missing-stripe-account' }],
      };
      const stock = {
        type: 'error',
        status: 409,
        apiErrors: [{ code: 'transaction-listing-insufficient-stock' }],
      };
      expect(isSlotTakenError(noStripe)).toBe(false);
      expect(isSlotTakenError(stock)).toBe(false);
      expect(isSlotTakenError({ type: 'error', status: 500, apiErrors: [] })).toBe(false);
      expect(isSlotTakenError(null)).toBe(false);
    });

    it('says exactly what the client is told', () => {
      // eslint-disable-next-line global-require
      const en = require('../../translations/en.json');
      expect(en['CheckoutPage.bookingTimeJustTaken']).toBe(
        'That time was just taken. Please {pickAnotherTimeLink}.'
      );
      expect(en['CheckoutPage.pickAnotherTimeLinkText']).toBe('pick another');
    });
  });

  it('reads, in full, "That time was just taken. Please pick another.", with "pick another" a link to the listing', () => {
    // The test environment shows every message as its key, so this one reads the real wording.
    const pickAnother = (
      <NamedLink name="ListingPage" params={{ id: 'listing-1', slug: 'find-your-focus' }}>
        <FormattedMessage id="CheckoutPage.pickAnotherTimeLinkText" />
      </NamedLink>
    );
    const messages = getErrorMessages(
      false,
      null,
      false,
      null,
      { type: 'error', name: 'Error', status: 409, apiErrors: [] },
      null,
      pickAnother
    );
    render(
      <IntlProvider locale="en" messages={en}>
        {messages.speculateErrorMessage}
      </IntlProvider>
    );

    expect(screen.getByText(/That time was just taken\. Please/)).toHaveTextContent(
      'That time was just taken. Please pick another.'
    );
    expect(screen.getByRole('link', { name: 'pick another' })).toHaveAttribute(
      'href',
      '/l/find-your-focus/listing-1'
    );
  });
});

describe('a session switched off while the checkout was open (the coach has to reconnect their calendar)', () => {
  const notBookable = {
    type: 'error',
    status: 400,
    apiErrors: [{ status: 400, code: 'calendar-not-bookable' }],
  };

  it('says the coach is not taking bookings right now, for the real booking', () => {
    const messages = getErrorMessages(false, notBookable, false, null, null, null);
    expect(messageIdOf(messages.initiateOrderErrorMessage)).toBe(
      'CheckoutPage.calendarNotBookable'
    );
  });

  it('says it for the price preview too', () => {
    const messages = getErrorMessages(false, null, false, null, notBookable, null);
    expect(messageIdOf(messages.speculateErrorMessage)).toBe('CheckoutPage.calendarNotBookable');
  });

  it('is not mistaken for "that time was just taken"', () => {
    expect(isSlotTakenError(notBookable)).toBe(false);
  });

  it('has wording in the translations', () => {
    expect(en['CheckoutPage.calendarNotBookable']).toMatch(/isn't taking bookings/);
  });
});
