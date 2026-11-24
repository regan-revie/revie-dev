import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { userDisplayNameAsString } from '../../util/data';
import useNextAvailable from '../../containers/ListingPage/SessionPage/useNextAvailable';
import {
  firstNameOf,
  formatShortDay,
} from '../../containers/ListingPage/SessionPage/sessionPageHelpers';

import BookingSheet from './BookingSheet';
import MobileBookBar from './MobileBookBar';
import NotTakingBookingsCard from './NotTakingBookingsCard';
import SessionSetupCard from './SessionSetupCard/SessionSetupCard';
import { formatPanelPrice } from './NylasBookingForm/PriceVariantRadios';
import { BookingCard, BookingLayoutContext, LAYOUT_PANEL, PanelHeading } from './BookingPanelParts';

export const PHONE_MAX_WIDTH = 1023;
export const BOOK_BAR_BUTTON_ID = 'orderPanelSubmitButton';

/** Whether the screen is phone-sized (below the width where the panel moves beside the page). */
export const useIsPhoneLayout = (maxWidth = PHONE_MAX_WIDTH) => {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, [maxWidth]);
  return isPhone;
};

export const PANEL_STATES = {
  FORM: 'form',
  SETUP: 'setup',
  NOT_TAKING: 'notTaking',
  SETTING_UP: 'settingUp',
};

/**
 * The booking side of a session (docs/design/session-page/): one of four things.
 *
 * - `form`: the booking steps. On desktop, a card beside the page. On a phone, a bar at the bottom
 *   of the page ("$110 · 60 min", "Next: Tue 17 Nov", "See times") that opens the steps in a sheet.
 * - `setup`: the coach's own checklist, while the session cannot be booked yet.
 * - `notTaking`: what a client sees while it cannot be booked yet.
 * - `settingUp`: the coach's own note while the server finishes setting the session up.
 *
 * Only the layout lives here; what happens when a time is chosen and booked is the booking form's,
 * unchanged.
 *
 * @param {Object} props
 * @param {string} props.state one of PANEL_STATES
 * @param {Object} props.listing
 * @param {Object} props.author the coach (user entity)
 * @param {boolean} props.isOwnListing
 * @param {Object} props.price the session's price (Money)
 * @param {Array} props.priceVariants
 * @param {React.ComponentType} props.BookingForm the booking form component
 * @param {Object} props.bookingFormProps everything the booking form is given
 * @param {Object} props.setupCardProps the setup card's props
 * @param {Function} props.onContactUser the existing inquiry flow
 * @param {boolean} props.isOrderOpen the phone sheet is open (`?orderOpen=true`)
 * @param {Function} props.onOpenOrder
 * @param {Function} props.onCloseOrder
 * @param {Function} props.onManageDisableScrolling
 */
const RevieBookingPanel = props => {
  const {
    className,
    state,
    listing,
    author,
    isOwnListing,
    price,
    priceVariants = [],
    BookingForm,
    bookingFormProps,
    setupCardProps,
    onContactUser,
    isOrderOpen,
    onOpenOrder,
    onCloseOrder,
    onManageDisableScrolling,
  } = props;
  const intl = useIntl();
  const isPhone = useIsPhoneLayout();

  const name = firstNameOf(userDisplayNameAsString(author, ''));
  const pronounsKey = author?.attributes?.profile?.publicData?.pronouns;
  const currency = price?.currency;
  const onMessage = onContactUser && author ? () => onContactUser(author) : undefined;

  // The bar shows the first length, which is what the sheet opens with.
  const firstVariant = priceVariants[0];
  const nextStart = useNextAvailable({
    listingId: listing.id?.uuid,
    priceVariantName: firstVariant?.name,
    enabled: state === PANEL_STATES.FORM && isPhone,
  });

  if (state === PANEL_STATES.SETUP) {
    return (
      <div className={className}>
        <SessionSetupCard {...setupCardProps} />
      </div>
    );
  }

  if (state === PANEL_STATES.SETTING_UP) {
    return (
      <div className={className}>
        <BookingCard data-testid="setting-up">
          <p style={{ margin: 0 }}>
            <FormattedMessage id="BookingPanel.settingUp" />
          </p>
        </BookingCard>
      </div>
    );
  }

  if (state === PANEL_STATES.NOT_TAKING) {
    return (
      <div className={className}>
        <NotTakingBookingsCard
          name={name}
          pronounsKey={pronounsKey}
          priceVariants={priceVariants}
          currency={currency}
          onMessage={onMessage}
        />
      </div>
    );
  }

  const form = (
    <BookingForm
      {...bookingFormProps}
      authorFirstName={name}
      authorPronouns={pronounsKey}
      onMessage={onMessage}
    />
  );

  if (!isPhone) {
    return (
      <div className={classNames(className)}>
        <BookingLayoutContext.Provider value={LAYOUT_PANEL}>
          <BookingCard
            data-testid="booking-panel"
            aria-label={intl.formatMessage({ id: 'BookingPanel.ariaLabel' })}
          >
            <PanelHeading name={name} />
            {form}
          </BookingCard>
        </BookingLayoutContext.Provider>
      </div>
    );
  }

  const barPrice = formatPanelPrice(intl, firstVariant?.priceInSubunits ?? price?.amount, currency);
  return (
    <div className={className}>
      <MobileBookBar
        priceText={barPrice}
        minutes={firstVariant?.bookingLengthInMinutes}
        nextDay={nextStart ? formatShortDay(nextStart, intl.locale) : null}
        buttonId={BOOK_BAR_BUTTON_ID}
        onClick={onOpenOrder}
      />
      <BookingSheet
        isOpen={!!isOrderOpen && !isOwnListing}
        onClose={onCloseOrder}
        name={name}
        returnFocusId={BOOK_BAR_BUTTON_ID}
        onManageDisableScrolling={onManageDisableScrolling}
      >
        {form}
      </BookingSheet>
    </div>
  );
};

export default RevieBookingPanel;
