import React, { useState, useEffect } from 'react';
import { useCallback } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';

// Utils
import { FormattedMessage } from '../../util/reactIntl';
import { LISTING_STATE_CLOSED, propTypes } from '../../util/types';
import { OFFER, REQUEST } from '../../transactions/transaction';

// Global ducks (for Redux actions and thunks)
import { getMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { manageDisableScrolling, isScrollingDisabled } from '../../ducks/ui.duck';
import { initializeCardPaymentData } from '../../ducks/stripe.duck.js';

// Shared components
import { H4, Page, NamedLink, OrderPanel, LayoutSingleColumn } from '../../components';

// Related components and modules
import FooterContainer from '../FooterContainer/FooterContainer';
import NotFoundPage from '../NotFoundPage/NotFoundPage';

import {
  sendInquiry,
  setInitialValues,
  fetchTimeSlots,
  fetchTransactionLineItems,
} from './ListingPage.duck';

import {
  LoadingPage,
  ErrorPage,
  handleContactUser,
  handleSubmitInquiry,
  handleNavigateToMakeOfferPage,
  handleNavigateToRequestQuotePage,
  handleSubmit,
  priceForSchemaMaybe,
  getDerivedRenderData,
} from './ListingPage.shared';
import ListingPageAccessWrapper from './ListingPageAccessWrapper';

// The redesigned session page (docs/design/session-page/)
import SessionTopbar from './SessionPage/SessionTopbar';
import SessionNoticeStrip from './SessionPage/SessionNoticeStrip';
import SessionHero from './SessionPage/SessionHero';
import SessionAbout from './SessionPage/SessionAbout';
import SessionCoach from './SessionPage/SessionCoach';
import SessionGoodToKnow from './SessionPage/SessionGoodToKnow';
import SessionReviews from './SessionPage/SessionReviews';
import SessionInquiryModal from './SessionPage/SessionInquiryModal';
import { firstNameOf } from './SessionPage/sessionPageHelpers';
import SessionOutcomesSection from '../../components/SessionOutcomes/SessionOutcomesSection';

import css from './ListingPage.module.css';
import sessionCss from './SessionPage/SessionPage.module.css';

const MIN_LENGTH_FOR_LONG_WORDS_IN_TITLE = 16;

export const ListingPageComponent = props => {
  const [inquiryModalOpen, setInquiryModalOpen] = useState(
    props.inquiryModalOpenForListingId === props.params.id
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    isAuthenticated,
    currentUser,
    getListing,
    getOwnListing,
    intl,
    onManageDisableScrolling,
    params: rawParams,
    location,
    scrollingDisabled,
    showListingError,
    reviews = [],
    sendInquiryInProgress,
    sendInquiryError,
    history,
    callSetInitialValues,
    onSendInquiry,
    onInitializeCardPaymentData,
    config,
    routeConfiguration,
    showOwnListingsOnly,
    ...restOfProps
  } = props;

  const derivedData = getDerivedRenderData({
    rawParams,
    getListing,
    getOwnListing,
    showOwnListingsOnly,
    currentUser,
    config,
    intl,
    location,
    longWordMinLength: MIN_LENGTH_FOR_LONG_WORDS_IN_TITLE,
    longWordClassName: css.longWord,
    payoutDetailsWarningClassName: css.payoutDetailsWarning,
  });
  const {
    listingId,
    currentListing,
    listingSlug,
    params,
    listingPathParamType,
    listingTab,
    description,
    price,
    title,
    publicData,
    richTitle,
    isOwnListing,
    showListingImage,
    processType,
    ensuredAuthor,
    noPayoutDetailsSetWithOwnListing,
    payoutDetailsWarning,
    authorDisplayName,
    schemaTitle,
    facebookImages,
    twitterImages,
    schemaImages,
    productURL,
    availabilityMaybe,
    noIndexMaybe,
    hasInvalidListingData,
  } = derivedData;

  const topbar = <SessionTopbar />;

  if (showListingError && showListingError.status === 404) {
    // 404 listing not found
    return <NotFoundPage staticContext={props.staticContext} />;
  } else if (showListingError) {
    // Other error in fetching listing
    return <ErrorPage topbar={topbar} scrollingDisabled={scrollingDisabled} intl={intl} />;
  } else if (!currentListing.id) {
    // Still loading the listing
    return <LoadingPage topbar={topbar} scrollingDisabled={scrollingDisabled} intl={intl} />;
  }

  if (hasInvalidListingData) {
    // Listing should always contain listingType, transactionProcessAlias and unitType)
    return (
      <ErrorPage topbar={topbar} scrollingDisabled={scrollingDisabled} intl={intl} invalidListing />
    );
  }
  const unitType = publicData.unitType;
  const isNegotiation = processType === 'negotiation';

  const commonParams = { params, history, routes: routeConfiguration };
  const onContactUser = handleContactUser({
    ...commonParams,
    currentUser,
    callSetInitialValues,
    setInitialValues, // from ListingPage.duck.js (set initial values for the listing page)
    location,
    setInquiryModalOpen,
  });
  // Note: this is for inquire transition to inquiry state in booking, purchase and negotiation processes.
  // Inquiry process is handled through handleSubmit.
  const onSubmitInquiry = handleSubmitInquiry({
    ...commonParams,
    getListing,
    onSendInquiry,
    setInquiryModalOpen,
  });

  const handleOrderSubmit = values => {
    const isCurrentlyClosed = currentListing.attributes.state === LISTING_STATE_CLOSED;
    if (isOwnListing || isCurrentlyClosed) {
      window.scrollTo(0, 0);
    } else if (isNegotiation && unitType === REQUEST) {
      // This is to navigate to MakeOfferPage when InvokeNegotiationForm is submitted
      const onNavigateToMakeOfferPage = handleNavigateToMakeOfferPage({
        ...commonParams,
        getListing,
      });
      onNavigateToMakeOfferPage(values);
    } else if (isNegotiation && unitType === OFFER) {
      // This is to navigate to MakeOfferPage when InvokeNegotiationForm is submitted
      const onNavigateToRequestQuotePage = handleNavigateToRequestQuotePage({
        ...commonParams,
        getListing,
      });
      onNavigateToRequestQuotePage(values);
    } else {
      const onSubmit = handleSubmit({
        ...commonParams,
        currentUser,
        callSetInitialValues,
        getListing,
        onInitializeCardPaymentData,
      });
      onSubmit(values);
    }
  };

  return (
    <Page
      title={schemaTitle}
      scrollingDisabled={scrollingDisabled}
      author={authorDisplayName}
      description={description}
      facebookImages={facebookImages}
      twitterImages={twitterImages}
      {...noIndexMaybe}
      schema={{
        '@context': 'http://schema.org',
        '@type': 'Product',
        description: description,
        name: schemaTitle,
        image: schemaImages,
        offers: {
          '@type': 'Offer',
          url: productURL,
          ...priceForSchemaMaybe(price),
          ...availabilityMaybe,
        },
      }}
    >
      <LayoutSingleColumn
        className={sessionCss.pageRoot}
        topbar={topbar}
        footer={<FooterContainer />}
      >
        <div className={sessionCss.page}>
          <SessionNoticeStrip
            mounted={mounted}
            listing={currentListing}
            isOwnListing={isOwnListing}
            noPayoutDetailsSetWithOwnListing={noPayoutDetailsSetWithOwnListing}
            editParams={{
              id: listingId.uuid,
              slug: listingSlug,
              type: listingPathParamType,
              tab: listingTab,
            }}
          />
          <div className={sessionCss.main}>
            <div className={sessionCss.column}>
              <SessionHero
                listing={currentListing}
                author={ensuredAuthor}
                reviews={reviews}
                userFields={config.user?.userFields}
                onManageDisableScrolling={onManageDisableScrolling}
              />

              <SessionAbout description={description} preWork={publicData.pre_work} />

              {/* "You'll walk away with": hidden unless outcome 1 has text */}
              <SessionOutcomesSection publicData={publicData} />

              {/* Hidden while the session has no reviews */}
              <SessionReviews reviews={reviews} />

              <SessionCoach author={ensuredAuthor} userFields={config.user?.userFields} />

              <SessionGoodToKnow
                firstName={firstNameOf(authorDisplayName)}
                authorId={ensuredAuthor?.id?.uuid}
              />
            </div>

            <div className={sessionCss.bookColumn}>
              <OrderPanel
                listing={currentListing}
                isOwnListing={isOwnListing}
                onSubmit={handleOrderSubmit}
                authorLink={
                  // The coach's own page: the template linked to an author section lower down, which
                  // the redesigned page no longer has.
                  <NamedLink
                    className={css.authorNameLink}
                    name="ProfilePage"
                    params={{ id: ensuredAuthor?.id?.uuid }}
                  >
                    {authorDisplayName}
                  </NamedLink>
                }
                title={
                  <FormattedMessage id="ListingPage.orderTitle" values={{ title: richTitle }} />
                }
                titleDesktop={
                  // The page's own h1 is in the hero, so the panel's heading is an h2.
                  <H4 as="h2" className={css.orderPanelTitle}>
                    <FormattedMessage id="ListingPage.orderTitle" values={{ title: richTitle }} />
                  </H4>
                }
                sectionHeadingAs="h2"
                payoutDetailsWarning={payoutDetailsWarning}
                author={ensuredAuthor}
                onManageDisableScrolling={onManageDisableScrolling}
                onContactUser={onContactUser}
                {...restOfProps}
                validListingTypes={config.listing.listingTypes}
                marketplaceCurrency={config.currency}
                dayCountAvailableForBooking={config.stripe.dayCountAvailableForBooking}
                marketplaceName={config.marketplaceName}
                showListingImage={showListingImage}
              />
            </div>
          </div>
          <SessionInquiryModal
            title={title}
            authorDisplayName={authorDisplayName}
            isOpen={isAuthenticated && inquiryModalOpen}
            onClose={() => setInquiryModalOpen(false)}
            sendInquiryError={sendInquiryError}
            sendInquiryInProgress={sendInquiryInProgress}
            onSubmitInquiry={onSubmitInquiry}
            onManageDisableScrolling={onManageDisableScrolling}
          />
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

/**
 * The ListingPage component with carousel layout.
 *
 * @component
 * @param {Object} props
 * @param {Object} props.params - The path params object
 * @param {string} props.params.id - The listing id
 * @param {string} props.params.slug - The listing slug
 * @param {LISTING_PAGE_DRAFT_VARIANT | LISTING_PAGE_PENDING_APPROVAL_VARIANT} props.params.variant - The listing variant
 * @param {Function} props.onManageDisableScrolling - The on manage disable scrolling function
 * @param {boolean} props.isAuthenticated - Whether the user is authenticated
 * @param {Function} props.getListing - The get listing function
 * @param {Function} props.getOwnListing - The get own listing function
 * @param {Object} props.currentUser - The current user
 * @param {boolean} props.scrollingDisabled - Whether scrolling is disabled
 * @param {string} props.inquiryModalOpenForListingId - The inquiry modal open for the specific listing id
 * @param {propTypes.error} props.showListingError - The show listing error
 * @param {Function} props.callSetInitialValues - The call page-specific setInitialValues function, which is given to this function as a parameter
 * @param {Array<propTypes.review>} props.reviews - The reviews
 * @param {propTypes.error} props.fetchReviewsError - The fetch reviews error
 * @param {Object<string, Object>} props.monthlyTimeSlots - The monthly time slots. E.g. { '2019-11': { timeSlots: [], fetchTimeSlotsInProgress: false, fetchTimeSlotsError: null } }
 * @param {Object<string, Object>} props.timeSlotsForDate - The time slots for date. E.g. { '2019-11-01': { timeSlots: [], fetchedAt: 1572566400000, fetchTimeSlotsError: null, fetchTimeSlotsInProgress: false } }
 * @param {boolean} props.sendInquiryInProgress - Whether the send inquiry is in progress
 * @param {propTypes.error} props.sendInquiryError - The send inquiry error
 * @param {Function} props.onSendInquiry - The on send inquiry function
 * @param {Function} props.onInitializeCardPaymentData - The on initialize card payment data function
 * @param {Function} props.onFetchTimeSlots - The on fetch time slots function
 * @param {Function} props.onFetchTransactionLineItems - The on fetch transaction line items function
 * @param {Array<propTypes.transactionLineItem>} props.lineItems - The line items
 * @param {boolean} props.fetchLineItemsInProgress - Whether the fetch line items is in progress
 * @param {propTypes.error} props.fetchLineItemsError - The fetch line items error
 * @returns {JSX.Element} listing page component
 */
const ListingPage = props => {
  const dispatch = useDispatch();
  const store = useStore();

  const { isAuthenticated } = useSelector(state => state.auth);
  const {
    showListingError,
    reviews,
    fetchReviewsError,
    monthlyTimeSlots,
    timeSlotsForDate,
    sendInquiryInProgress,
    sendInquiryError,
    lineItems,
    fetchLineItemsInProgress,
    fetchLineItemsError,
    inquiryModalOpenForListingId,
  } = useSelector(state => state.ListingPage);
  const currentUser = useSelector(state => state.user?.currentUser);
  const scrollingDisabled = useSelector(state => isScrollingDisabled(state));

  const getListing = useCallback(
    id => {
      const state = store.getState();
      const ref = { id, type: 'listing' };
      const listings = getMarketplaceEntities(state, [ref]);
      return listings.length === 1 ? listings[0] : null;
    },
    [store]
  );
  const getOwnListing = useCallback(
    id => {
      const state = store.getState();
      const ref = { id, type: 'ownListing' };
      const listings = getMarketplaceEntities(state, [ref]);
      return listings.length === 1 ? listings[0] : null;
    },
    [store]
  );

  const onManageDisableScrolling = useCallback(
    (componentId, disableScrolling) =>
      dispatch(manageDisableScrolling(componentId, disableScrolling)),
    [dispatch]
  );
  const callSetInitialValues = useCallback(
    (setInitialValuesFn, values, saveToSessionStorage) =>
      dispatch(setInitialValuesFn(values, saveToSessionStorage)),
    [dispatch]
  );
  const onFetchTransactionLineItems = useCallback(
    params => dispatch(fetchTransactionLineItems(params)),
    [dispatch]
  );
  const onSendInquiry = useCallback((listing, message) => dispatch(sendInquiry(listing, message)), [
    dispatch,
  ]);
  const onInitializeCardPaymentData = useCallback(() => dispatch(initializeCardPaymentData()), [
    dispatch,
  ]);
  const onFetchTimeSlots = useCallback(
    (listingId, start, end, timeZone, options) =>
      dispatch(fetchTimeSlots(listingId, start, end, timeZone, options)),
    [dispatch]
  );

  return (
    <ListingPageAccessWrapper
      {...props}
      PageComponent={ListingPageComponent}
      isAuthenticated={isAuthenticated}
      currentUser={currentUser}
      getListing={getListing}
      getOwnListing={getOwnListing}
      scrollingDisabled={scrollingDisabled}
      inquiryModalOpenForListingId={inquiryModalOpenForListingId}
      showListingError={showListingError}
      reviews={reviews}
      fetchReviewsError={fetchReviewsError}
      monthlyTimeSlots={monthlyTimeSlots}
      timeSlotsForDate={timeSlotsForDate}
      lineItems={lineItems}
      fetchLineItemsInProgress={fetchLineItemsInProgress}
      fetchLineItemsError={fetchLineItemsError}
      sendInquiryInProgress={sendInquiryInProgress}
      sendInquiryError={sendInquiryError}
      onManageDisableScrolling={onManageDisableScrolling}
      callSetInitialValues={callSetInitialValues}
      onFetchTransactionLineItems={onFetchTransactionLineItems}
      onSendInquiry={onSendInquiry}
      onInitializeCardPaymentData={onInitializeCardPaymentData}
      onFetchTimeSlots={onFetchTimeSlots}
    />
  );
};

export default ListingPage;
