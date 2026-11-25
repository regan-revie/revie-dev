import React from 'react';

import { FormattedMessage } from '../../util/reactIntl';
import { isNetworkError } from '../../util/networkError';
import {
  isTransactionInitiateAmountTooLowError,
  isTransactionInitiateMissingStripeAccountError,
  isTransactionInitiateBookingTimeNotAvailableError,
  isTransactionInitiateListingInsufficientStockError,
  isTransactionChargeDisabledError,
  isTransactionZeroPaymentError,
  isTransitionQuantityInfoMissingError,
  isTooManyRequestsError,
  transactionInitiateOrderStripeErrors,
  isProviderCommissionBiggerThanMinPrice,
  isCalendarNotBookableError,
} from '../../util/errors';

import ErrorNote from './RevieCheckout/ErrorNote';

// Collect error message checks to a single function.
/**
 * The time the client chose is no longer free in Sharetribe: its own "booking time not available" code,
 * or a plain 409 from the initiate calls (the Sentry issue REVIE-PLATFORM-8 was a 409 on the price
 * check). A conflict of another kind that has its own message (a provider without payouts, stock)
 * keeps it.
 */
export const isSlotTakenError = error =>
  isTransactionInitiateBookingTimeNotAvailableError(error) ||
  (!!error &&
    error.status === 409 &&
    !isTransactionInitiateListingInsufficientStockError(error) &&
    !isTransactionInitiateMissingStripeAccountError(error));

export const getErrorMessages = (
  listingNotFound,
  initiateOrderError,
  isPaymentExpired,
  retrievePaymentIntentError,
  speculateTransactionError,
  listingLink,
  pickAnotherTimeLink
) => {
  let listingNotFoundErrorMessage = null;
  let initiateOrderErrorMessage = null;
  let speculateErrorMessage = null;

  const isAmountTooLowError = isTransactionInitiateAmountTooLowError(initiateOrderError);
  const isChargeDisabledError = isTransactionChargeDisabledError(initiateOrderError);
  const stripeErrors = transactionInitiateOrderStripeErrors(initiateOrderError);

  // We want to show one error at a time for the real transition
  if (listingNotFound) {
    listingNotFoundErrorMessage = <FormattedMessage id="CheckoutPage.listingNotFoundError" />;
  } else if (isCalendarNotBookableError(initiateOrderError)) {
    initiateOrderErrorMessage = <FormattedMessage id="CheckoutPage.calendarNotBookable" />;
  } else if (isAmountTooLowError) {
    initiateOrderErrorMessage = <FormattedMessage id="CheckoutPage.initiateOrderAmountTooLow" />;
  } else if (isSlotTakenError(initiateOrderError)) {
    // If bookings are used, there could be error related to those. Revie: Sharetribe can still hold
    // a slot Nylas shows as free (another client is checking out, or a late-cancelled session keeps
    // its slot), so this is a normal thing to meet at checkout: say so and offer fresh times.
    initiateOrderErrorMessage = (
      <FormattedMessage
        id="CheckoutPage.bookingTimeJustTaken"
        values={{ pickAnotherTimeLink: pickAnotherTimeLink || listingLink }}
      />
    );
  } else if (isTransitionQuantityInfoMissingError(initiateOrderError)) {
    initiateOrderErrorMessage = (
      <FormattedMessage id="CheckoutPage.correctQuantityInformationMissing" />
    );
  } else if (isTransactionInitiateListingInsufficientStockError(initiateOrderError)) {
    // If stock management is used, there could be error related to that
    initiateOrderErrorMessage = <FormattedMessage id="CheckoutPage.notEnoughStockMessage" />;
  } else if (isChargeDisabledError) {
    initiateOrderErrorMessage = <FormattedMessage id="CheckoutPage.chargeDisabledMessage" />;
  } else if (stripeErrors && stripeErrors.length > 0) {
    const noAccountMsg =
      'Your destination account needs to have at least one of the following capabilities enabled';
    if (stripeErrors.length === 1 && stripeErrors[0].indexOf(noAccountMsg) > -1) {
      initiateOrderErrorMessage = (
        <FormattedMessage id="CheckoutPage.destinationAccountNotCompleteStripeError" />
      );
    } else {
      // NOTE: Error messages from Stripes are not part of translations.
      // By default they are in English.
      const stripeErrorsAsString = stripeErrors.join(', ');
      initiateOrderErrorMessage = (
        <FormattedMessage
          id="CheckoutPage.initiateOrderStripeError"
          values={{ stripeErrors: stripeErrorsAsString }}
        />
      );
    }
  } else if (isTooManyRequestsError(initiateOrderError)) {
    // 429 Too Many Requests
    initiateOrderErrorMessage = <FormattedMessage id="CheckoutPage.tooManyRequestsError" />;
  } else if (isProviderCommissionBiggerThanMinPrice(initiateOrderError)) {
    speculateErrorMessage = (
      <FormattedMessage id="CheckoutPage.providerCommissionBiggerThanMinPrice" />
    );
  } else if (isNetworkError(initiateOrderError)) {
    // Revie: the request never got an answer (offline, dropped connection, blocked, server
    // restarting). Nothing has been charged, and saying so is what the client needs to hear.
    initiateOrderErrorMessage = <FormattedMessage id="CheckoutPage.networkError" />;
  } else if (initiateOrderError) {
    // Generic initiate order error
    initiateOrderErrorMessage = (
      <FormattedMessage id="CheckoutPage.initiateOrderError" values={{ listingLink }} />
    );
  }

  // We want to show one error at a time for speculateTransition
  if (isTransactionInitiateMissingStripeAccountError(speculateTransactionError)) {
    speculateErrorMessage = (
      <FormattedMessage id="CheckoutPage.providerStripeAccountMissingError" />
    );
  } else if (isCalendarNotBookableError(speculateTransactionError)) {
    speculateErrorMessage = <FormattedMessage id="CheckoutPage.calendarNotBookable" />;
  } else if (isSlotTakenError(speculateTransactionError)) {
    speculateErrorMessage = (
      <FormattedMessage
        id="CheckoutPage.bookingTimeJustTaken"
        values={{ pickAnotherTimeLink: pickAnotherTimeLink || listingLink }}
      />
    );
  } else if (isTransactionInitiateListingInsufficientStockError(speculateTransactionError)) {
    speculateErrorMessage = <FormattedMessage id="CheckoutPage.notEnoughStockMessage" />;
  } else if (isTransactionZeroPaymentError(speculateTransactionError)) {
    speculateErrorMessage = <FormattedMessage id="CheckoutPage.initiateOrderAmountTooLow" />;
  } else if (isTransitionQuantityInfoMissingError(speculateTransactionError)) {
    speculateErrorMessage = (
      <FormattedMessage id="CheckoutPage.correctQuantityInformationMissing" />
    );
  } else if (isProviderCommissionBiggerThanMinPrice(speculateTransactionError)) {
    speculateErrorMessage = (
      <FormattedMessage id="CheckoutPage.providerCommissionBiggerThanMinPrice" />
    );
  } else if (isNetworkError(speculateTransactionError)) {
    speculateErrorMessage = <FormattedMessage id="CheckoutPage.networkError" />;
  } else if (speculateTransactionError) {
    speculateErrorMessage = <FormattedMessage id="CheckoutPage.speculateFailedMessage" />;
  }

  // Add paragraph-container for the error message, if it exists
  // Revie: every error on the page is the same note: error red, bold, with an icon (ErrorNote).
  const listingNotFoundErrorMessageParagraph = listingNotFoundErrorMessage ? (
    <ErrorNote boxed>{listingNotFoundErrorMessage}</ErrorNote>
  ) : null;
  const initiateOrderErrorMessageParagraph = initiateOrderErrorMessage ? (
    <ErrorNote boxed>{initiateOrderErrorMessage}</ErrorNote>
  ) : null;
  const speculateErrorMessageParagraph = speculateErrorMessage ? (
    <ErrorNote boxed>{speculateErrorMessage}</ErrorNote>
  ) : null;
  const speculateTransactionErrorMessageParagraph =
    speculateTransactionError &&
    !isTransactionInitiateMissingStripeAccountError(speculateTransactionError) &&
    // The slot message above already says what is wrong; "Failed to fetch breakdown information"
    // beside it only adds noise.
    !isSlotTakenError(speculateTransactionError) ? (
      <ErrorNote>
        <FormattedMessage id="CheckoutPage.speculateTransactionError" />
      </ErrorNote>
    ) : null;

  // Stripe might throw error when retrieving payment intent
  const retrievePaymentIntentErrorMessageParagraph = retrievePaymentIntentError ? (
    <ErrorNote boxed>
      <FormattedMessage
        id="CheckoutPage.retrievingStripePaymentIntentFailed"
        values={{ listingLink }}
      />
    </ErrorNote>
  ) : null;

  // Stripe related processes expire unpaid checkouts via the transaction process
  const paymentExpiredMessageParagraph = isPaymentExpired ? (
    <ErrorNote boxed>
      <FormattedMessage id="CheckoutPage.paymentExpiredMessage" values={{ listingLink }} />
    </ErrorNote>
  ) : null;

  return {
    listingNotFoundErrorMessage: listingNotFoundErrorMessageParagraph,
    initiateOrderErrorMessage: initiateOrderErrorMessageParagraph,
    paymentExpiredMessage: paymentExpiredMessageParagraph,
    retrievePaymentIntentErrorMessage: retrievePaymentIntentErrorMessageParagraph,
    speculateErrorMessage: speculateErrorMessageParagraph,
    speculateTransactionErrorMessage: speculateTransactionErrorMessageParagraph,
  };
};
