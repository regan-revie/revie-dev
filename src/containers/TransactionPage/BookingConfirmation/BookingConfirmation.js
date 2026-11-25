import React, { useState } from 'react';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { formatMoney } from '../../../util/currency';
import { getDefaultTimeZoneOnBrowser } from '../../../util/dates';
import {
  LINE_ITEM_CUSTOMER_COMMISSION,
  LINE_ITEM_PROMO_DISCOUNT,
  LINE_ITEM_PROVIDER_COMMISSION,
} from '../../../util/types';
import { firstNameOf } from '../../ListingPage/SessionPage/sessionPageHelpers';
import ManageCalendarBooking from '../ManageCalendarBooking/ManageCalendarBooking';

import BookingHero from './BookingHero';
import {
  CancelledSection,
  MessageCard,
  NextSteps,
  PaymentBox,
  StatePanel,
} from './BookingSections';
import { getBookingPageState } from './bookingState';
import { formatDiscount } from '../../CheckoutPage/RevieCheckout/checkoutFormat';

import css from './BookingConfirmation.module.css';

const boldTag = chunks => <b>{chunks}</b>;

/**
 * The client's booking page: what a client lands on after checkout and comes back to, to join, move
 * or cancel their session (docs/design/booking-confirmation/). A restyle of working behaviour: the
 * time, the join and calendar links, rescheduling and cancelling are `ManageCalendarBooking`'s;
 * messages, the review prompt and the activity list are the template page's own, handed in.
 *
 * @param {Object} props
 * @param {Object} props.transaction the denormalised transaction (with listing, provider, booking)
 * @param {Object} props.listing
 * @param {Object} props.provider the coach
 * @param {Object} props.currentUser the client
 * @param {string} props.processState the state `getStateData` works out
 * @param {Array} props.messages the transaction's messages, oldest first
 * @param {boolean} props.showSendMessageForm whether this client may write a message
 * @param {Function} props.onMessageSubmit (values, form) => void, the page's own sender
 * @param {boolean} props.sendMessageInProgress
 * @param {Object} props.sendMessageError
 * @param {React.ReactNode} [props.reviewButtons] the template's "Leave a review" button, when it applies
 * @param {React.ReactNode} [props.activityFeed] the template's activity list (older messages, moves)
 * @param {Function} props.onCancelledOnCalendar lets the page re-read the transaction
 * @param {Function} props.onManageDisableScrolling
 */
const BookingConfirmation = props => {
  const {
    transaction,
    listing,
    provider,
    currentUser,
    processState,
    messages,
    showSendMessageForm,
    onMessageSubmit,
    sendMessageInProgress,
    sendMessageError,
    reviewButtons,
    activityFeed,
    onCancelledOnCalendar,
  } = props;
  const intl = useIntl();
  // What the "Your session" card reports: the time as it is now, and a cancellation made here.
  const [calendarView, setCalendarView] = useState(null);

  const timeZone = getDefaultTimeZoneOnBrowser();
  const metadata = transaction?.attributes?.metadata;
  const state = getBookingPageState({ processState, metadata, calendarView });

  const coachProfile = provider?.attributes?.profile || {};
  const coachName = coachProfile.displayName || '';
  const coachFirstName = firstNameOf(coachName);
  const clientProfile = currentUser?.attributes?.profile || {};
  const clientName = clientProfile.displayName || clientProfile.firstName || '';
  const listingTitle = listing?.attributes?.title || '';
  const listingId = listing?.id?.uuid;
  const publicData = listing?.attributes?.publicData || {};

  const booking = transaction?.booking?.attributes;
  const startMs = Number.isFinite(calendarView?.start)
    ? calendarView.start
    : booking?.start
    ? new Date(booking.start).getTime()
    : NaN;

  // The payment box and the refund sentence read the transaction's own line items.
  const customerLines = (transaction?.attributes?.lineItems || []).filter(
    li => !li.reversal && li.includeFor?.includes('customer')
  );
  const sessionLine = customerLines.find(
    li =>
      ![
        LINE_ITEM_PROMO_DISCOUNT,
        LINE_ITEM_PROVIDER_COMMISSION,
        LINE_ITEM_CUSTOMER_COMMISSION,
      ].includes(li.code)
  );
  const promoLine = customerLines.find(li => li.code === LINE_ITEM_PROMO_DISCOUNT);
  const payin = transaction?.attributes?.payinTotal;
  const totalText = payin ? formatMoney(intl, payin) : '';
  const sessionPriceText = sessionLine ? formatMoney(intl, sessionLine.lineTotal) : '';
  const discountText = promoLine ? formatDiscount(formatMoney(intl, promoLine.lineTotal)) : '';
  const promoCode = metadata?.promo?.code;

  const hero = ({ heading }) => (
    <BookingHero
      coachImage={provider?.profileImage}
      coachName={coachName}
      coachFirstName={coachFirstName}
      clientImage={currentUser?.profileImage}
      clientName={clientName}
      startMs={startMs}
      timeZone={timeZone}
      heading={heading}
      sessionTitle={listingTitle}
    />
  );

  if (state.kind === 'confirming' || state.kind === 'declined') {
    return (
      <StatePanel
        kind={state.kind}
        coachFirstName={coachFirstName}
        listingId={listingId}
        listingTitle={listingTitle}
      />
    );
  }

  const isCancelled = state.kind === 'cancelled';
  const isLive = state.kind === 'live';
  const heading = isCancelled ? (
    <FormattedMessage id="BookingConfirmation.cancelledHeading" values={{ b: boldTag }} />
  ) : isLive ? (
    <FormattedMessage id="BookingConfirmation.bookedHeading" values={{ b: boldTag }} />
  ) : (
    <FormattedMessage id="BookingConfirmation.doneHeading" />
  );

  return (
    <div className={css.root}>
      {hero({ heading })}
      <div className={css.page}>
        <div className={css.columns}>
          <div className={css.mainColumn}>
            {isLive ? (
              <ManageCalendarBooking
                transactionId={transaction?.id}
                listingId={listing?.id}
                onCancelled={onCancelledOnCalendar}
                onViewChange={setCalendarView}
                refundText={totalText}
              />
            ) : null}

            {isCancelled ? (
              <CancelledSection
                kind={state.cancel}
                coachFirstName={coachFirstName}
                refundText={totalText}
                listingId={listingId}
                listingTitle={listingTitle}
              />
            ) : null}

            {isLive ? (
              <NextSteps preWork={publicData.pre_work} prepLink={publicData.prep_link} />
            ) : null}

            {reviewButtons ? <div className={css.reviewRow}>{reviewButtons}</div> : null}
          </div>

          <div className={css.sideColumn}>
            <MessageCard
              messages={messages}
              note={transaction?.attributes?.protectedData?.customerDefaultMessage}
              currentUserId={currentUser?.id?.uuid}
              coachName={coachName}
              coachFirstName={coachFirstName}
              coachImage={provider?.profileImage}
              canSend={showSendMessageForm}
              onSend={(text, form) => onMessageSubmit({ message: text }, form)}
              sending={sendMessageInProgress}
              sendError={sendMessageError}
            />
            <PaymentBox
              sessionPriceText={sessionPriceText}
              promoCode={promoCode}
              discountText={discountText}
              totalText={totalText}
            />
          </div>
        </div>

        {activityFeed ? (
          <section className={css.activity} aria-labelledby="activity-title">
            <h2 id="activity-title" className={css.activityTitle}>
              <FormattedMessage id="BookingConfirmation.activityTitle" />
            </h2>
            {activityFeed}
          </section>
        ) : null}
      </div>
    </div>
  );
};

export default BookingConfirmation;
