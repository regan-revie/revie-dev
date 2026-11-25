import React, { useState } from 'react';

// Import contexts and util modules
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { pathByRouteName } from '../../util/routes';
import {
  isValidCurrencyForTransactionProcess,
  pickTransactionFieldsData,
} from '../../util/fieldHelpers.js';
import {
  propTypes,
  LINE_ITEM_CUSTOMER_COMMISSION,
  LINE_ITEM_PROMO_DISCOUNT,
  LINE_ITEM_PROVIDER_COMMISSION,
} from '../../util/types';
import { ensureTransaction } from '../../util/data';
import { formatMoney } from '../../util/currency';
import { getDefaultTimeZoneOnBrowser } from '../../util/dates';
import { isInsideFreeWindow } from '../../util/freeCancellationWindow';
import { createSlug } from '../../util/urlHelpers';
import { nylasCreateBooking, promoCheck } from '../../util/api';
import {
  isTransactionInitiateListingNotFoundError,
  isTransactionsTransitionInvalidTransition,
  promoRefusalReason,
} from '../../util/errors';
import {
  getProcess,
  resolveLatestProcessName,
  BOOKING_PROCESS_NAME,
  NEGOTIATION_PROCESS_NAME,
  PURCHASE_PROCESS_NAME,
} from '../../transactions/transaction';

// Import shared components
import { H4, NamedLink, Page, TopbarSimplified } from '../../components';
import { timeZoneCity } from '../../components/OrderPanel/NylasBookingForm/nylasSlots';
import { firstNameOf } from '../ListingPage/SessionPage/sessionPageHelpers';

// Session helpers file needs to be imported before other CheckoutPage modules that use it
import { clearData, storeData } from './CheckoutPageSessionHelpers';

import {
  bookingDatesMaybe,
  getBillingDetails,
  getFormattedTotalPrice,
  getShippingDetailsMaybe,
  getTransactionTypeData,
  clientTimeZoneMaybe,
  hasDefaultPaymentMethod,
  hasPaymentExpired,
  hasTransactionPassedPendingPayment,
  processCheckoutWithPayment,
  setOrderPageInitialValues,
} from './CheckoutPageTransactionHelpers.js';
import { getErrorMessages } from './ErrorMessages';

import StripePaymentForm from './StripePaymentForm/StripePaymentForm';
import PromoCodeSection from './PromoCodeSection/PromoCodeSection';
import { CheckoutFooter, CheckoutTopbar } from './RevieCheckout/CheckoutChrome';
import CheckoutSummary from './RevieCheckout/CheckoutSummary';
import { formatDiscount, subjectWillOf } from './RevieCheckout/checkoutFormat';

import css from './CheckoutPage.module.css';
import revieCss from './RevieCheckout/RevieCheckout.module.css';

// Stripe PaymentIntent statuses, where user actions are already completed
// https://stripe.com/docs/payments/payment-intents/status
const STRIPE_PI_USER_ACTIONS_DONE_STATUSES = ['processing', 'requires_capture', 'succeeded'];

// Payment charge options
const ONETIME_PAYMENT = 'ONETIME_PAYMENT';
const PAY_AND_SAVE_FOR_LATER_USE = 'PAY_AND_SAVE_FOR_LATER_USE';
const USE_SAVED_CARD = 'USE_SAVED_CARD';

const paymentFlow = (selectedPaymentMethod, saveAfterOnetimePayment) => {
  // Payment mode could be 'replaceCard', but without explicit saveAfterOnetimePayment flag,
  // we'll handle it as one-time payment
  return selectedPaymentMethod === 'defaultCard'
    ? USE_SAVED_CARD
    : saveAfterOnetimePayment
    ? PAY_AND_SAVE_FOR_LATER_USE
    : ONETIME_PAYMENT;
};

// The terms page, which opens in a new tab so the booking in progress is not lost.
const termsPath = routeConfiguration => {
  try {
    return pathByRouteName('TermsOfServicePage', routeConfiguration);
  } catch (e) {
    return '/terms-of-service';
  }
};

const capitalizeString = s => `${s.charAt(0).toUpperCase()}${s.substr(1)}`;

/**
 * Prefix the properties of the chosen price variant as first level properties for the protected data of the transaction
 *
 * @example
 * const priceVariant = {
 *   name: 'something',
 * }
 *
 * will be returned as:
 * const priceVariant = {
 *   priceVariantName: 'something',
 * }
 *
 * @param {Object} priceVariant - The price variant object
 * @returns {Object} The price variant object with the properties prefixed with priceVariant*
 */
const prefixPriceVariantProperties = priceVariant => {
  if (!priceVariant) {
    return {};
  }

  const entries = Object.entries(priceVariant).map(([key, value]) => {
    return [`priceVariant${capitalizeString(key)}`, value];
  });
  return Object.fromEntries(entries);
};

/**
 * Construct orderParams object using pageData from session storage, shipping details, and optional payment params.
 * Note: This is used for both speculate transition and real transition
 *       - Speculate transition is called, when the the component is mounted. It's used to test if the data can go through the API validation
 *       - Real transition is made, when the user submits the StripePaymentForm.
 *
 * @param {Object} pageData data that's saved to session storage.
 * @param {Object} shippingDetails shipping address if applicable.
 * @param {Object} optionalPaymentParams (E.g. paymentMethod or setupPaymentMethodForSaving)
 * @param {Object} config app-wide configs. This contains hosted configs too.
 * @returns orderParams.
 */
const getOrderParams = (
  pageData,
  shippingDetails,
  optionalPaymentParams,
  config,
  transactionFieldProtectedData,
  customerDefaultMessage
) => {
  const quantity = pageData.orderData?.quantity;
  const quantityMaybe = quantity ? { quantity } : {};
  const seats = pageData.orderData?.seats;
  const seatsMaybe = seats ? { seats } : {};
  const deliveryMethod = pageData.orderData?.deliveryMethod;
  const deliveryMethodMaybe = deliveryMethod ? { deliveryMethod } : {};
  const { listingType, unitType, priceVariants } = pageData?.listing?.attributes?.publicData || {};

  // price variant data for fixed duration bookings
  const priceVariantName = pageData.orderData?.priceVariantName;
  const priceVariantNameMaybe = priceVariantName ? { priceVariantName } : {};
  // Revie: a promo code the client applied. Judged and priced on the server only.
  const promoCode = pageData.orderData?.promoCode;
  const promoCodeMaybe = promoCode ? { promoCode } : {};
  const priceVariant = priceVariants?.find(pv => pv.name === priceVariantName);
  const priceVariantMaybe = priceVariant ? prefixPriceVariantProperties(priceVariant) : {};

  const customerDefaultMessageMaybe = customerDefaultMessage ? { customerDefaultMessage } : {};

  const protectedDataMaybe = {
    protectedData: {
      ...getTransactionTypeData(listingType, unitType, config),
      ...deliveryMethodMaybe,
      ...shippingDetails,
      ...priceVariantMaybe,
      ...transactionFieldProtectedData,
      ...customerDefaultMessageMaybe,
      ...clientTimeZoneMaybe(pageData?.listing),
    },
  };

  // Note: Avoid misinterpreting the following logic as allowing arbitrary mixing of `quantity` and `seats`.
  // You can only pass either quantity OR seats and units to the orderParams object
  // Quantity represents the total booked units for the line item (e.g. days, hours).
  // When quantity is not passed, we pass seats and units.
  // If `bookingDatesMaybe` is provided, it determines `units`, and `seats` defaults to 1
  // (implying quantity = units)

  // These are the order parameters for the first payment-related transition
  // which is either initiate-transition or initiate-transition-after-enquiry
  const orderParams = {
    listingId: pageData?.listing?.id,
    ...deliveryMethodMaybe,
    ...quantityMaybe,
    ...seatsMaybe,
    ...bookingDatesMaybe(pageData.orderData?.bookingDates),
    ...priceVariantNameMaybe,
    ...promoCodeMaybe,
    ...protectedDataMaybe,
    ...optionalPaymentParams,
  };
  return orderParams;
};

const fetchSpeculatedTransactionIfNeeded = (orderParams, pageData, fetchSpeculatedTransaction) => {
  const tx = pageData ? pageData.transaction : null;
  const pageDataListing = pageData.listing;
  const processName =
    tx?.attributes?.processName ||
    pageDataListing?.attributes?.publicData?.transactionProcessAlias?.split('/')[0];
  const process = processName ? getProcess(processName) : null;

  // If transaction has passed payment-pending state, speculated tx is not needed.
  const shouldFetchSpeculatedTransaction =
    !!pageData?.listing?.id &&
    !!pageData.orderData &&
    !!process &&
    !hasTransactionPassedPendingPayment(tx, process);

  if (shouldFetchSpeculatedTransaction) {
    const processAlias = pageData.listing.attributes.publicData?.transactionProcessAlias;
    const transactionId = tx ? tx.id : null;
    const isInquiryInPaymentProcess =
      tx?.attributes?.lastTransition === process.transitions.INQUIRE;
    const resolvedProcessName = resolveLatestProcessName(processName);
    const isOfferPendingInNegotiationProcess =
      resolvedProcessName === NEGOTIATION_PROCESS_NAME &&
      tx.attributes.state === `state/${process.states.OFFER_PENDING}`;

    const requestTransition = isInquiryInPaymentProcess
      ? process.transitions.REQUEST_PAYMENT_AFTER_INQUIRY
      : isOfferPendingInNegotiationProcess
      ? process.transitions.REQUEST_PAYMENT_TO_ACCEPT_OFFER
      : process.transitions.REQUEST_PAYMENT;
    const isPrivileged = process.isPrivileged(requestTransition);

    fetchSpeculatedTransaction(
      orderParams,
      processAlias,
      transactionId,
      requestTransition,
      isPrivileged
    );
  }
};

/**
 * Load initial data for the page
 *
 * Since the data for the checkout is not passed in the URL (there
 * might be lots of options in the future), we must pass in the data
 * some other way. Currently the ListingPage sets the initial data
 * for the CheckoutPage's Redux store.
 *
 * For some cases (e.g. a refresh in the CheckoutPage), the Redux
 * store is empty. To handle that case, we store the received data
 * to window.sessionStorage and read it from there if no props from
 * the store exist.
 *
 * This function also sets of fetching the speculative transaction
 * based on this initial data.
 */
export const loadInitialDataForStripePayments = ({
  pageData,
  fetchSpeculatedTransaction,
  fetchStripeCustomer,
  config,
}) => {
  // Fetch currentUser with stripeCustomer entity
  // Note: since there's need for data loading in "componentWillMount" function,
  //       this is added here instead of loadData static function.
  fetchStripeCustomer();

  // Fetch speculated transaction for showing price in order breakdown
  // NOTE: if unit type is line-item/item, quantity needs to be added.
  // The way to pass it to checkout page is through pageData.orderData
  const shippingDetails = {};
  const optionalPaymentParams = {};
  const orderParams = getOrderParams(pageData, shippingDetails, optionalPaymentParams, config);

  fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction);
};

const handleSubmit = (values, process, props, stripe, submitting, setSubmitting) => {
  if (submitting) {
    return;
  }
  setSubmitting(true);

  const {
    history,
    config,
    routeConfiguration,
    speculatedTransaction,
    currentUser,
    stripeCustomerFetched,
    paymentIntent,
    dispatch,
    onInitiateOrder,
    onConfirmCardPayment,
    onConfirmPayment,
    onSavePaymentMethod,
    onFetchTransaction,
    onSubmitCallback,
    pageData,
    setPageData,
    sessionStorageKey,
    transaction: reduxTransaction,
    transactionFieldConfigs = [],
  } = props;
  const { card, message, paymentMethod: selectedPaymentMethod, formValues } = values;
  const { saveAfterOnetimePayment: saveAfterOnetimePaymentRaw } = formValues;

  const transactionFieldsProtectedData = {
    ...pickTransactionFieldsData(formValues, 'protected', true, transactionFieldConfigs),
  };

  const saveAfterOnetimePayment =
    Array.isArray(saveAfterOnetimePaymentRaw) && saveAfterOnetimePaymentRaw.length > 0;
  const selectedPaymentFlow = paymentFlow(selectedPaymentMethod, saveAfterOnetimePayment);
  const hasDefaultPaymentMethodSaved = hasDefaultPaymentMethod(stripeCustomerFetched, currentUser);
  const stripePaymentMethodId = hasDefaultPaymentMethodSaved
    ? currentUser?.stripeCustomer?.defaultPaymentMethod?.attributes?.stripePaymentMethodId
    : null;

  // If paymentIntent status is not waiting user action,
  // confirmCardPayment has been called previously.
  const hasPaymentIntentUserActionsDone =
    paymentIntent && STRIPE_PI_USER_ACTIONS_DONE_STATUSES.includes(paymentIntent.status);

  const requestPaymentParams = {
    pageData,
    speculatedTransaction,
    stripe,
    card,
    billingDetails: getBillingDetails(formValues, currentUser),
    paymentIntent,
    hasPaymentIntentUserActionsDone,
    stripePaymentMethodId,
    process,
    onInitiateOrder,
    onConfirmCardPayment,
    onConfirmPayment,
    onSavePaymentMethod,
    sessionStorageKey,
    stripeCustomer: currentUser?.stripeCustomer,
    isPaymentFlowUseSavedCard: selectedPaymentFlow === USE_SAVED_CARD,
    isPaymentFlowPayAndSaveCard: selectedPaymentFlow === PAY_AND_SAVE_FOR_LATER_USE,
    setPageData,
  };

  const shippingDetails = getShippingDetailsMaybe(formValues);
  // Note: optionalPaymentParams contains Stripe paymentMethod,
  // but that can also be passed on Step 2
  // stripe.confirmCardPayment(stripe, { payment_method: stripePaymentMethodId })
  const optionalPaymentParams =
    selectedPaymentFlow === USE_SAVED_CARD && hasDefaultPaymentMethodSaved
      ? { paymentMethod: stripePaymentMethodId }
      : selectedPaymentFlow === PAY_AND_SAVE_FOR_LATER_USE
      ? { setupPaymentMethodForSaving: true }
      : {};

  // These are the order parameters for the first payment-related transition
  // which is either initiate-transition or initiate-transition-after-enquiry
  const orderParams = getOrderParams(
    pageData,
    shippingDetails,
    optionalPaymentParams,
    config,
    transactionFieldsProtectedData,
    message
  );

  // There are multiple XHR calls that needs to be made against Stripe API and Sharetribe Marketplace API on checkout with payments
  processCheckoutWithPayment(orderParams, requestPaymentParams)
    .then(response => {
      const { orderId, paymentMethodSaved } = response;
      setSubmitting(false);

      // Payment is confirmed, but nothing has told Nylas yet - Sharetribe's own checkout only
      // ever knew about price and payment, never about the coach's calendar. This is the one call
      // that actually creates the Nylas booking; its booking.created webhook is what runs
      // transition/operator-accept and moves the transaction on. Fired without blocking navigation:
      // a slow or failed call here shouldn't stop the client from seeing their confirmation, but a
      // failure does mean the transaction is stuck until reconciled by hand (see CLAUDE.md's
      // Phase 3 hardening notes on abandoned bookings).
      if (pageData?.listing?.attributes?.publicData?.calendarBookingEnabled) {
        nylasCreateBooking({ transactionId: orderId.uuid }).catch(e => {
          console.error('[nylas] Could not create the calendar booking:', e);
        });
      }

      const orderDetailsPath = pathByRouteName('OrderDetailsPage', routeConfiguration, {
        id: orderId.uuid,
      });
      const initialValues = {
        savePaymentMethodFailed: !paymentMethodSaved,
      };

      setOrderPageInitialValues(initialValues, routeConfiguration, dispatch);
      onSubmitCallback();
      history.push(orderDetailsPath);
    })
    .catch(err => {
      console.error(err);
      setSubmitting(false);

      // After process expiry (or if payment was already confirmed), confirm/initiate can fail with
      // invalid transition while checkout still holds a stale pending-payment transaction.
      if (!isTransactionsTransitionInvalidTransition(err)) {
        return;
      }

      const txId = pageData?.transaction?.id || reduxTransaction?.id;
      if (!txId || !onFetchTransaction) {
        return;
      }

      onFetchTransaction(txId)
        .then(tx => {
          if (process.getState(tx) === process.states.PAYMENT_EXPIRED) {
            setPageData({ ...pageData, transaction: tx });
            clearData(sessionStorageKey);
          } else if (process.hasPassedState(process.states.PENDING_PAYMENT, tx)) {
            // Confirm already succeeded earlier (e.g. network drop after Marketplace confirm).
            const orderDetailsPath = pathByRouteName('OrderDetailsPage', routeConfiguration, {
              id: tx.id.uuid,
            });
            setOrderPageInitialValues({}, routeConfiguration, dispatch);
            onSubmitCallback();
            history.push(orderDetailsPath);
          }
        })
        .catch(() => {
          // Keep the generic confirm/initiate error UI from Redux.
        });
    });
};

const onStripeInitialized = (stripe, process, props) => {
  const { paymentIntent, onRetrievePaymentIntent, pageData } = props;
  const tx = pageData?.transaction || null;

  // We need to get up to date PI, if payment is pending but it's not expired.
  const shouldFetchPaymentIntent =
    stripe &&
    !paymentIntent &&
    tx?.id &&
    process?.getState(tx) === process?.states.PENDING_PAYMENT &&
    !hasPaymentExpired(tx, process);

  if (shouldFetchPaymentIntent) {
    const { stripePaymentIntentClientSecret } =
      tx.attributes.protectedData?.stripePaymentIntents?.default || {};

    // Fetch up to date PaymentIntent from Stripe
    onRetrievePaymentIntent({ stripe, stripePaymentIntentClientSecret });
  }
};

/**
 * A component that renders the checkout page with payment.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.scrollingDisabled - Whether the page should scroll
 * @param {string} props.speculateTransactionError - The error message for the speculate transaction
 * @param {propTypes.transaction} props.speculatedTransaction - The speculated transaction
 * @param {string} props.initiateOrderError - The error message for the initiate order
 * @param {string} props.confirmPaymentError - The error message for the confirm payment
 * @param {intlShape} props.intl - The intl object
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {string} props.confirmCardPaymentError - The error message for the confirm card payment
 * @param {propTypes.paymentIntent} props.paymentIntent - The Stripe's payment intent
 * @param {boolean} props.stripeCustomerFetched - Whether the stripe customer has been fetched
 * @param {Object} props.pageData - The page data
 * @param {propTypes.listing} props.pageData.listing - The listing entity
 * @param {boolean} props.showListingImage - A boolean indicating whether images are enabled with this listing type
 * @param {propTypes.transaction} props.pageData.transaction - The transaction entity
 * @param {Object} props.pageData.orderData - The order data
 * @param {string} props.processName - The process name
 * @param {string} props.listingTitle - The listing title
 * @param {string} props.title - The title
 * @param {Function} props.onInitiateOrder - The function to initiate the order
 * @param {Function} props.onConfirmCardPayment - The function to confirm the card payment
 * @param {Function} props.onConfirmPayment - The function to confirm the payment after Stripe call is made
 * @param {Function} props.onFetchTransaction - The function to fetch an up-to-date transaction entity
 * @param {Function} props.onSavePaymentMethod - The function to save the payment method for later use
 * @param {Function} props.onSubmitCallback - The function to submit the callback
 * @param {propTypes.error} props.initiateOrderError - The error message for the initiate order
 * @param {propTypes.error} props.confirmPaymentError - The error message for the confirm payment
 * @param {propTypes.error} props.confirmCardPaymentError - The error message for the confirm card payment
 * @param {propTypes.paymentIntent} props.paymentIntent - The Stripe's payment intent
 * @param {boolean} props.stripeCustomerFetched - Whether the stripe customer has been fetched
 * @param {Object} props.config - The config
 * @param {Object} props.routeConfiguration - The route configuration
 * @param {Object} props.history - The history object
 * @param {Object} props.history.push - The push state function of the history object
 * @returns {JSX.Element}
 */
export const CheckoutPageWithPayment = props => {
  const [submitting, setSubmitting] = useState(false);
  // Initialized stripe library is saved to state - if it's needed at some point here too.
  const [stripe, setStripe] = useState(null);

  const {
    scrollingDisabled,
    speculateTransactionError,
    speculatedTransaction: speculatedTransactionMaybe,
    initiateOrderError,
    confirmPaymentError,
    intl,
    currentUser,
    confirmCardPaymentError,
    showListingImage,
    paymentIntent,
    retrievePaymentIntentError,
    stripeCustomerFetched,
    pageData,
    processName,
    listingTitle,
    title,
    transactionFieldConfigs = [],
    showTransactionFields,
    config,
    sessionStorageKey,
    setPageData,
  } = props;

  // Since the listing data is already given from the ListingPage
  // and stored to handle refreshes, it might not have the possible
  // deleted or closed information in it. If the transaction
  // initiate or the speculative initiate fail due to the listing
  // being deleted or closed, we should dig the information from the
  // errors and not the listing data.
  const listingNotFound =
    isTransactionInitiateListingNotFoundError(speculateTransactionError) ||
    isTransactionInitiateListingNotFoundError(initiateOrderError);

  const { listing, transaction, orderData } = pageData;

  // Revie promo code. The code lives in pageData.orderData (and so in session storage, surviving a
  // refresh); applying or removing one stores it, then asks the server for a new price.
  const repriceWith = nextOrderData => {
    const next = { ...pageData, orderData: nextOrderData };
    setPageData(next);
    storeData(nextOrderData, next.listing, next.transaction, sessionStorageKey);
    fetchSpeculatedTransactionIfNeeded(
      getOrderParams(next, {}, {}, config),
      next,
      props.fetchSpeculatedTransaction
    );
  };
  const applyPromo = async code => {
    let result;
    try {
      result = await promoCheck({ code });
    } catch (e) {
      return { reason: 'unavailable' };
    }
    if (!result || !result.ok) return { reason: (result && result.reason) || 'invalid' };
    repriceWith({ ...orderData, promoCode: result.code, promoPercent: result.percentOff });
    return {};
  };
  const removePromo = () => {
    const { promoCode, promoPercent, ...withoutPromo } = orderData || {};
    repriceWith(withoutPromo);
  };
  // The server refusing the code while pricing or booking (it expired a moment ago, say). Those
  // errors get their own message here, not the generic checkout error.
  const promoRefusedReason =
    promoRefusalReason(speculateTransactionError) || promoRefusalReason(initiateOrderError);
  const existingTransaction = ensureTransaction(transaction);
  const speculatedTransaction = ensureTransaction(speculatedTransactionMaybe, {}, null);

  // If existing transaction has line-items, it has gone through one of the request-payment transitions.
  // Otherwise, we try to rely on speculatedTransaction for order breakdown data.
  const tx =
    existingTransaction?.attributes?.lineItems?.length > 0
      ? existingTransaction
      : speculatedTransaction;
  const transactionProcessAlias = listing?.attributes?.publicData?.transactionProcessAlias;
  const priceVariantName =
    tx.attributes.protectedData?.priceVariantName || orderData?.priceVariantName;

  // Revie: the summary shows the transaction's own line items, so the numbers on the page are the
  // ones the server will charge: the session, the promo discount if a code is on, and the total.
  // Shown only once the (speculated) transaction is loaded, i.e. it has an id and line items.
  const hasLineItems = !!tx.id && tx.attributes.lineItems?.length > 0;
  const customerLineItems = hasLineItems
    ? tx.attributes.lineItems.filter(li => !li.reversal && li.includeFor?.includes('customer'))
    : [];
  const promoLineItem = customerLineItems.find(li => li.code === LINE_ITEM_PROMO_DISCOUNT);
  const sessionLineItem = customerLineItems.find(
    li =>
      ![
        LINE_ITEM_PROMO_DISCOUNT,
        LINE_ITEM_PROVIDER_COMMISSION,
        LINE_ITEM_CUSTOMER_COMMISSION,
      ].includes(li.code)
  );
  // "No booking fees" is only said when it is true: there is no fee line for the client.
  const hasCustomerFee = customerLineItems.some(li => li.code === LINE_ITEM_CUSTOMER_COMMISSION);

  const totalPrice = hasLineItems ? getFormattedTotalPrice(tx, intl) : null;

  const process = processName ? getProcess(processName) : null;
  const transitions = process.transitions;
  const isPaymentExpired = hasPaymentExpired(existingTransaction, process);

  // Allow showing page when currentUser is still being downloaded,
  // but show payment form only when user info is loaded.
  const showPaymentForm = !!(
    currentUser &&
    !listingNotFound &&
    !initiateOrderError &&
    !speculateTransactionError &&
    !retrievePaymentIntentError &&
    !isPaymentExpired
  );

  const listingLink = (
    <NamedLink
      name="ListingPage"
      params={{ id: listing?.id?.uuid, slug: createSlug(listingTitle) }}
    >
      <FormattedMessage id="CheckoutPage.errorlistingLinkText" />
    </NamedLink>
  );

  // Revie: where a client goes when the time they chose has just been taken. The listing page loads
  // the available times afresh when it opens (NylasBookingForm asks the server on mount) and starts
  // with no time picked, so this is also how the times are refreshed.
  const pickAnotherTimeLink = (
    <NamedLink
      name="ListingPage"
      params={{ id: listing?.id?.uuid, slug: createSlug(listingTitle) }}
    >
      <FormattedMessage id="CheckoutPage.pickAnotherTimeLinkText" />
    </NamedLink>
  );

  const errorMessages = getErrorMessages(
    listingNotFound,
    promoRefusedReason ? null : initiateOrderError,
    isPaymentExpired,
    retrievePaymentIntentError,
    promoRefusedReason ? null : speculateTransactionError,
    listingLink,
    pickAnotherTimeLink
  );

  const isBooking = processName === BOOKING_PROCESS_NAME;
  // Only before the booking is started: once it exists its price is fixed (the payment is made for
  // exactly that amount), so a code can no longer be added or taken off.
  const showPromoCode = isBooking && !(existingTransaction?.attributes?.lineItems?.length > 0);
  const isPurchase = processName === PURCHASE_PROCESS_NAME;
  const isNegotiation = processName === NEGOTIATION_PROCESS_NAME;

  const txTransitions = existingTransaction?.attributes?.transitions || [];
  const hasInquireTransition = txTransitions.find(tr => tr.transition === transitions.INQUIRE);
  const showInitialMessageInput = !hasInquireTransition && !isNegotiation;

  // Get first and last name of the current user and use it in the StripePaymentForm to autofill the name field
  const userName = currentUser?.attributes?.profile
    ? `${currentUser.attributes.profile.firstName} ${currentUser.attributes.profile.lastName}`
    : null;

  // If paymentIntent status is not waiting user action,
  // confirmCardPayment has been called previously.
  const hasPaymentIntentUserActionsDone =
    paymentIntent && STRIPE_PI_USER_ACTIONS_DONE_STATUSES.includes(paymentIntent.status);

  // If your marketplace works mostly in one country you can use initial values to select country automatically
  // e.g. {country: 'FI'}

  const initialValuesForStripePayment = { name: userName, recipientName: userName };
  const askShippingDetails =
    orderData?.deliveryMethod === 'shipping' &&
    !hasTransactionPassedPendingPayment(existingTransaction, process);

  const listingLocation = listing?.attributes?.publicData?.location;
  const showPickUpLocation = isPurchase && orderData?.deliveryMethod === 'pickup';
  const showLocation = (isBooking || isNegotiation) && listingLocation?.address;

  const providerDisplayName = isNegotiation
    ? existingTransaction?.provider?.attributes?.profile?.displayName
    : listing?.author?.attributes?.profile?.displayName;

  // Check if the listing currency is compatible with Stripe for the specified transaction process.
  // This function validates the currency against the transaction process requirements and
  // ensures it is supported by Stripe, as indicated by the 'stripe' parameter.
  // If using a transaction process without any stripe actions, leave out the 'stripe' parameter.
  const currency =
    existingTransaction?.attributes?.payinTotal?.currency || listing.attributes.price?.currency;
  const isStripeCompatibleCurrency = isValidCurrencyForTransactionProcess(
    transactionProcessAlias,
    currency,
    'stripe'
  );

  // Render an error message if the listing is using a non Stripe supported currency
  // and is using a transaction process with Stripe actions (default-booking or default-purchase)
  if (!isStripeCompatibleCurrency) {
    return (
      <Page title={title} scrollingDisabled={scrollingDisabled}>
        <TopbarSimplified />
        <div className={css.contentContainer}>
          <section className={css.incompatibleCurrency}>
            <H4 as="h1" className={css.heading}>
              <FormattedMessage id="CheckoutPage.incompatibleCurrency" />
            </H4>
          </section>
        </div>
      </Page>
    );
  }

  // ---- The summary (Revie checkout design, docs/design/checkout/) ----
  const author = listing?.author;
  const coachName = author?.attributes?.profile?.displayName || '';
  const coachFirstName = firstNameOf(coachName);
  const pronounsKey = author?.attributes?.profile?.publicData?.pronouns;

  const bookingStart = orderData?.bookingDates?.bookingStart || tx?.booking?.attributes?.start;
  const bookingEnd = orderData?.bookingDates?.bookingEnd || tx?.booking?.attributes?.end;
  const startMs = bookingStart ? new Date(bookingStart).getTime() : NaN;
  const endMs = bookingEnd ? new Date(bookingEnd).getTime() : NaN;
  // Times are the viewer's, as on the booking panel.
  const viewerTimeZone = getDefaultTimeZoneOnBrowser();

  const sessionPriceText = sessionLineItem ? formatMoney(intl, sessionLineItem.lineTotal) : null;
  const discountText = promoLineItem
    ? formatDiscount(formatMoney(intl, promoLineItem.lineTotal))
    : null;

  // The code control sits in the summary. Before the booking is started a code can be added or
  // taken off; once it exists the price is fixed, and an applied code is only shown.
  const promoSection = showPromoCode ? (
    <PromoCodeSection
      appliedCode={orderData?.promoCode}
      appliedPercent={orderData?.promoPercent}
      discountText={discountText}
      refusedReason={promoRefusedReason}
      onApply={applyPromo}
      onRemove={removePromo}
    />
  ) : orderData?.promoCode ? (
    <PromoCodeSection
      appliedCode={orderData.promoCode}
      appliedPercent={orderData.promoPercent}
      discountText={discountText}
    />
  ) : null;

  const termsHref = termsPath(props.routeConfiguration);

  const pageErrors = [
    errorMessages.initiateOrderErrorMessage,
    errorMessages.listingNotFoundErrorMessage,
    errorMessages.speculateErrorMessage,
    errorMessages.retrievePaymentIntentErrorMessage,
    errorMessages.paymentExpiredMessage,
  ].filter(Boolean);

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <CheckoutTopbar />
      <main className={revieCss.main}>
        <NamedLink
          name="ListingPage"
          params={{ id: listing?.id?.uuid, slug: createSlug(listingTitle) }}
          className={revieCss.back}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          <FormattedMessage id="CheckoutPage.backToSession" />
        </NamedLink>

        <h1 className={revieCss.heading}>
          {isBooking ? (
            <FormattedMessage id="CheckoutPage.heading" values={{ b: chunks => <b>{chunks}</b> }} />
          ) : (
            title
          )}
        </h1>

        <div className={revieCss.columns}>
          <div className={revieCss.summaryColumn}>
            <CheckoutSummary
              listingTitle={listingTitle}
              listingId={listing?.id}
              author={author}
              coachName={coachName}
              coachFirstName={coachFirstName}
              startMs={startMs}
              endMs={endMs}
              timeZone={viewerTimeZone}
              timeZoneCity={timeZoneCity(viewerTimeZone)}
              priceVariantName={priceVariantName}
              locale={intl.locale}
              sessionPriceText={sessionPriceText}
              promoSection={promoSection}
              totalText={totalPrice}
              showNoFees={hasLineItems && !hasCustomerFee}
              errorMessage={errorMessages.speculateTransactionErrorMessage}
            />
          </div>

          <div className={revieCss.formColumn}>
            {pageErrors.length > 0 ? <div className={revieCss.errors}>{pageErrors}</div> : null}

            {showPaymentForm ? (
              <StripePaymentForm
                className={css.paymentForm}
                onSubmit={values =>
                  handleSubmit(values, process, props, stripe, submitting, setSubmitting)
                }
                inProgress={submitting}
                formId="CheckoutPagePaymentForm"
                providerDisplayName={providerDisplayName}
                coachFirstName={coachFirstName}
                coachWillWord={subjectWillOf(pronounsKey)}
                termsHref={termsHref}
                insideFreeWindow={isInsideFreeWindow(startMs)}
                showInitialMessageInput={showInitialMessageInput}
                initialValues={initialValuesForStripePayment}
                initiateOrderError={initiateOrderError}
                confirmCardPaymentError={confirmCardPaymentError}
                confirmPaymentError={confirmPaymentError}
                hasHandledCardPayment={hasPaymentIntentUserActionsDone}
                loadingData={!stripeCustomerFetched}
                defaultPaymentMethod={
                  hasDefaultPaymentMethod(stripeCustomerFetched, currentUser)
                    ? currentUser.stripeCustomer.defaultPaymentMethod
                    : null
                }
                paymentIntent={paymentIntent}
                onStripeInitialized={stripe => {
                  setStripe(stripe);
                  return onStripeInitialized(stripe, process, props);
                }}
                askShippingDetails={askShippingDetails}
                showPickUpLocation={showPickUpLocation}
                showLocation={showLocation}
                listingLocation={listingLocation}
                totalPrice={totalPrice}
                locale={config.localization.locale}
                stripePublishableKey={config.stripe.publishableKey}
                marketplaceName={config.marketplaceName}
                processName={processName}
                isFuzzyLocation={config.maps.fuzzy.enabled}
                transactionFieldConfigs={transactionFieldConfigs}
                showTransactionFields={showTransactionFields}
              />
            ) : null}
          </div>
        </div>
      </main>
      <CheckoutFooter />
    </Page>
  );
};

export default CheckoutPageWithPayment;
