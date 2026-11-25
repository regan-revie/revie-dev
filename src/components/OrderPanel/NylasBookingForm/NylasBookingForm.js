import React, { useEffect, useMemo, useState } from 'react';
import { Form as FinalForm, FormSpy } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { getDefaultTimeZoneOnBrowser, getTimeZoneNames } from '../../../util/dates';
import { nylasAvailability } from '../../../util/api';
import { isInsideFreeWindow } from '../../../util/freeCancellationWindow';

import { Form } from '../../../components';

import FetchLineItemsError from '../FetchLineItemsError/FetchLineItemsError.js';
import { MessageCoach, pronounWords, useBookingLayout, LAYOUT_SHEET } from '../BookingPanelParts';
import NylasSlotSteps from './NylasSlotSteps';
import PriceVariantRadios, { formatPanelPrice } from './PriceVariantRadios';

import {
  formatSlotTime12,
  formatSummaryDay,
  groupSlotsByDay,
  slotMatchesVariant,
  timeZoneCity,
} from './nylasSlots';
import css from './NylasBookingForm.module.css';

/**
 * Booking form driven by the coach's connected calendar rather than a Sharetribe availability plan.
 *
 * Replaces BookingFixedDurationForm for listings with calendar booking enabled. It emits the same
 * values that form does - bookingStartTime, bookingEndTime and priceVariantName - so everything
 * downstream of ListingPage.shared.js handleSubmit is untouched.
 *
 * Times are shown in the **viewer's** timezone, not the coach's, so a client never has to work out
 * what "15:00 America/Los_Angeles" means for them. The zone is detected from the browser and shown
 * explicitly, and can be changed - a client booking while travelling wants their home zone, not
 * wherever they happen to be.
 *
 * Slots come from our own server rather than Nylas directly, because the coach's notice period is
 * enforced there and a filter applied in the browser would be one devtools edit away from bypass.
 *
 * There is no sign-in gate here: CheckoutPage is declared with `auth: true`, so the router redirects
 * a logged-out visitor to sign in and returns them, which matters because the live marketplace is
 * public.
 */
const NylasBookingForm = props => {
  const intl = useIntl();
  const layout = useBookingLayout();
  const isSheet = layout === LAYOUT_SHEET;
  const [changingZone, setChangingZone] = useState(false);
  const {
    rootClassName,
    className,
    listingId,
    isOwnListing,
    price,
    onFetchTransactionLineItems,
    fetchLineItemsInProgress,
    fetchLineItemsError,
    isPriceVariationsInUse,
    priceVariants = [],
    // Kept for the callers that still pass it; the length is now chosen with PriceVariantRadios.
    // eslint-disable-next-line no-unused-vars
    priceVariantFieldComponent,
    preselectedPriceVariant,
    // The day to open on (`?day=`), from the checkout's "Find a new time".
    preselectedDayKey,
    marketplaceName, // eslint-disable-line no-unused-vars
    payoutDetailsWarning,
    authorFirstName,
    authorPronouns,
    onMessage,
    ...rest
  } = props;

  const [availability, setAvailability] = useState({
    status: 'loading',
    slots: [],
    connected: true,
  });
  const [timeZone, setTimeZone] = useState(() => getDefaultTimeZoneOnBrowser());
  const [selectedSlot, setSelectedSlot] = useState(null);

  const listingIdString = listingId?.uuid || listingId;
  const initialPriceVariant = preselectedPriceVariant || priceVariants[0] || null;

  // The chosen session length. Each length has its own Nylas configuration on the server, so the
  // slots to show depend on it: changing the variant fetches that variant's slots rather than
  // filtering one list in the browser.
  const [variantName, setVariantName] = useState(initialPriceVariant?.name || null);

  const timeZoneNames = useMemo(() => getTimeZoneNames(), []);
  const { object: coachObject } = pronounWords(authorPronouns);

  useEffect(() => {
    let cancelled = false;
    setAvailability({ status: 'loading', slots: [], connected: true });

    nylasAvailability({
      listingId: listingIdString,
      ...(isPriceVariationsInUse && variantName ? { priceVariantName: variantName } : {}),
    })
      .then(response => {
        if (cancelled) return;
        setAvailability({
          status: 'ready',
          slots: response.slots || [],
          connected: response.connected !== false,
        });
      })
      .catch(e => {
        if (cancelled) return;
        // Swallowing this leaves the client staring at "try again shortly" and whoever is debugging
        // with nothing. The status separates the causes: 403 is the session, 502 the calendar
        // provider, 400 the request itself.
        console.error(
          `[nylas] Could not load availability for listing ${listingIdString}: ` +
            `status=${e?.status || 'none'} ${e?.message || e}`,
          e?.data || ''
        );
        setAvailability({ status: 'error', slots: [], connected: true });
      });

    // Guards against a slower earlier request landing after a newer one and overwriting it.
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingIdString, variantName]);

  const clearSelection = form => {
    setSelectedSlot(null);
    form.change('bookingStartTime', null);
    form.change('bookingEndTime', null);
  };

  const handleSlotSelect = (slot, priceVariantName, form) => {
    setSelectedSlot(slot);
    form.change('bookingStartTime', String(slot.start));
    form.change('bookingEndTime', String(slot.end));

    if (isOwnListing) return;

    onFetchTransactionLineItems({
      orderData: {
        bookingStart: new Date(slot.start),
        bookingEnd: new Date(slot.end),
        ...(priceVariantName ? { priceVariantName } : {}),
      },
      listingId,
      isOwnListing,
    });
  };

  const classes = classNames(rootClassName || css.root, className);

  return (
    <FinalForm
      {...rest}
      initialValues={initialPriceVariant ? { priceVariantName: initialPriceVariant.name } : {}}
      render={formRenderProps => {
        const { handleSubmit, form, values } = formRenderProps;

        const chosenVariant =
          priceVariants.find(v => v.name === values.priceVariantName) || initialPriceVariant;

        // Nylas returns slots at the configuration's duration, so a slot that does not match the
        // chosen variant would charge for one length and book another.
        const matching = availability.slots.filter(s => slotMatchesVariant(s, chosenVariant));
        const days = groupSlotsByDay(matching, timeZone);

        const notReady =
          availability.status === 'loading' ? (
            <p className={css.notice}>
              <FormattedMessage
                id="NylasBookingForm.loading"
                defaultMessage="Loading available times…"
              />
            </p>
          ) : availability.status === 'error' ? (
            <p className={css.error}>
              <FormattedMessage
                id="NylasBookingForm.error"
                defaultMessage="We couldn't load available times. Please try again shortly."
              />
            </p>
          ) : !availability.connected ? (
            <p className={css.notice}>
              <FormattedMessage
                id="NylasBookingForm.notConnected"
                defaultMessage="This coach hasn't connected their calendar yet, so online booking isn't available."
              />
            </p>
          ) : days.length === 0 ? (
            <p className={css.notice}>
              <FormattedMessage
                id="NylasBookingForm.noSlots"
                defaultMessage="No times are available at the moment. Please check back soon."
              />
            </p>
          ) : null;

        // The steps are numbered as shown: with a single length there is nothing to choose, so the
        // first step is the day.
        const hasLengthStep = isPriceVariationsInUse && priceVariants.length > 1;
        const dayStepNumber = hasLengthStep ? 2 : 1;

        // What is being bought: the chosen length's price, or the session's own price.
        const currency = price?.currency;
        const totalAmount = chosenVariant?.priceInSubunits ?? price?.amount;
        const totalText = formatPanelPrice(intl, totalAmount, currency);
        const minutes =
          chosenVariant?.bookingLengthInMinutes ||
          (selectedSlot ? Math.round((selectedSlot.end - selectedSlot.start) / 60000) : null);

        const summary = selectedSlot
          ? intl.formatMessage(
              { id: 'BookingPanel.summary' },
              {
                day: formatSummaryDay(selectedSlot.start, timeZone, intl.locale),
                time: formatSlotTime12(selectedSlot.start, timeZone, intl.locale),
                minutes: minutes || '',
              }
            )
          : null;

        const messageMaybe =
          onMessage && !isOwnListing ? (
            isSheet ? (
              <MessageCoach variant="link" name={authorFirstName} onClick={onMessage} />
            ) : (
              <div className={css.messageBlock}>
                <div className={css.messageText}>
                  <FormattedMessage
                    id="BookingPanel.askFirst"
                    values={{ name: authorFirstName, object: coachObject }}
                  />
                </div>
                <MessageCoach name={authorFirstName} onClick={onMessage} />
              </div>
            )
          ) : null;

        // "Free to cancel up to 48 hours before." is only true for a session more than 48 hours away.
        // Once a time inside the 48 hours is picked the line says so instead, never offering a free
        // window that has already passed. (Same rule as the server: util/freeCancellationWindow.js.)
        const cancelNote = (
          <FormattedMessage
            id={
              selectedSlot && isInsideFreeWindow(selectedSlot.start)
                ? 'BookingPanel.insideFreeWindow'
                : 'BookingPanel.freeCancel'
            }
          />
        );

        return (
          <Form
            onSubmit={handleSubmit}
            className={classes}
            enforcePagePreloadFor="CheckoutPage"
            data-layout={layout}
          >
            <div className={css.steps}>
              {hasLengthStep ? (
                <PriceVariantRadios
                  priceVariants={priceVariants}
                  currency={currency}
                  stepNumber={1}
                />
              ) : null}

              {/* Changing the length invalidates the pick, so clear it rather than leave a selection
                  that no longer matches what is being bought, and fetch that length's slots. */}
              <FormSpy
                subscription={{ values: true }}
                onChange={({ values: current }) => {
                  const next = current.priceVariantName || null;
                  if (next !== variantName) {
                    clearSelection(form);
                    setVariantName(next);
                  }
                }}
              />

              {notReady || (
                // Remounts on a timezone change (via key), which resets its internally-held day
                // selection - day boundaries move with the zone, so a previously chosen day may no
                // longer exist. clearSelection below only needs to clear the *slot*.
                <NylasSlotSteps
                  key={timeZone}
                  slots={matching}
                  timeZone={timeZone}
                  selectedSlot={selectedSlot}
                  dayStepNumber={dayStepNumber}
                  initialDayKey={preselectedDayKey}
                  onSelectSlot={slot => handleSlotSelect(slot, values.priceVariantName, form)}
                  onDayChange={() => clearSelection(form)}
                />
              )}

              {/* Stated and changeable rather than assumed. A client booking while travelling wants
                  their home zone, not wherever the laptop currently is. */}
              <div className={css.timeZoneBlock}>
                <div className={css.timeZoneLine}>
                  <span className={css.timeZoneText}>
                    <FormattedMessage
                      id="BookingPanel.timeZoneLine"
                      values={{ zone: timeZoneCity(timeZone) }}
                    />
                  </span>
                  <span className={css.timeZoneChange}>
                    {' · '}
                    <button
                      type="button"
                      className={css.linkButton}
                      aria-expanded={changingZone}
                      onClick={() => setChangingZone(!changingZone)}
                    >
                      <FormattedMessage id="BookingPanel.changeTimeZone" />
                    </button>
                  </span>
                </div>
                {changingZone ? (
                  <select
                    className={css.timeZoneSelect}
                    aria-label={intl.formatMessage({ id: 'BookingPanel.timeZoneLabel' })}
                    value={timeZone}
                    onChange={e => {
                      setTimeZone(e.target.value);
                      // The selected slot may no longer make sense on the new zone's day boundaries.
                      // The slot steps reset their own day selection, via their key={timeZone}.
                      clearSelection(form);
                    }}
                  >
                    {timeZoneNames.map(zone => (
                      <option key={zone} value={zone}>
                        {zone.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            <div className={css.footer}>
              <div className={css.totalRow}>
                <div className={css.totalLabels}>
                  <span className={css.totalFor}>
                    {isSheet ? (
                      summary || <FormattedMessage id="BookingPanel.pickATime" />
                    ) : minutes ? (
                      <FormattedMessage id="BookingPanel.totalFor" values={{ minutes }} />
                    ) : (
                      <FormattedMessage id="BookingPanel.total" />
                    )}
                  </span>
                  <span className={css.noFees}>
                    <FormattedMessage id="BookingPanel.noFees" />
                  </span>
                </div>
                {totalText ? <span className={css.totalPrice}>{totalText}</span> : null}
              </div>

              {isSheet ? null : (
                <div className={summary ? css.summary : css.summaryHint}>
                  {summary || <FormattedMessage id="BookingPanel.pickATime" />}
                </div>
              )}

              <FetchLineItemsError error={fetchLineItemsError} />

              <button
                type="submit"
                className={css.bookButton}
                disabled={!selectedSlot || fetchLineItemsInProgress}
              >
                <FormattedMessage
                  id="NylasBookingForm.bookButton"
                  defaultMessage="Book a session"
                />
              </button>

              {isSheet ? (
                <div className={css.sheetLinks}>
                  <span className={css.cancelText}>{cancelNote}</span>
                  {messageMaybe}
                </div>
              ) : (
                <>
                  <p className={css.cancelText}>{cancelNote}</p>
                  {messageMaybe}
                </>
              )}
              {payoutDetailsWarning}
            </div>
          </Form>
        );
      }}
    />
  );
};

export default NylasBookingForm;
