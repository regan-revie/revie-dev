import React from 'react';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { CoachPhoto, NamedLink } from '../../../components';
import { createSlug } from '../../../util/urlHelpers';
import { isInsideFreeWindow } from '../../../util/freeCancellationWindow';
import { splitAfterLastComma } from '../../ListingPage/SessionPage/sessionPageHelpers';
import {
  IconCalendarStar,
  IconCancelling,
  IconVideoCall,
} from '../../ListingPage/SessionPage/SessionIcons';

import {
  findNewTimeSearch,
  formatCancelUntil,
  formatSessionWhen,
  sessionMinutes,
} from './checkoutFormat';

import css from './CheckoutSummary.module.css';

/**
 * The checkout's booking summary: the maroon card (docs/design/checkout/ Main and Phone). The coach's
 * sticker photo, the session's title and coach, when it is and for how long, what it costs (with the
 * promo line when a code is on), the total, and what cancelling costs. On a desktop it sticks to the
 * top while the form scrolls; on a phone it comes first.
 *
 * It only lays out what the page hands it: the price lines come from the transaction's own line
 * items, so the numbers here are the ones the server will charge. A promo code field (the page's
 * `promoSection`) lives inside it.
 *
 * @param {Object} props
 * @param {string} props.listingTitle the session's title (bold after its last comma)
 * @param {Object} props.listingId the listing's UUID, for "Find a new time"
 * @param {Object} props.author the coach, as a user entity
 * @param {string} props.coachName "Maya R."
 * @param {string} props.coachFirstName "Maya"
 * @param {number} [props.startMs] when the session starts (epoch ms)
 * @param {number} [props.endMs]
 * @param {string} props.timeZone the viewer's IANA timezone
 * @param {string} props.timeZoneCity "London"
 * @param {string} [props.priceVariantName] the chosen length's name, kept in "Find a new time"
 * @param {string} [props.locale]
 * @param {string} [props.sessionPriceText] "$110.00": the session line
 * @param {React.ReactNode} [props.promoSection] the promo code control
 * @param {string} [props.totalText] "$93.50"
 * @param {boolean} [props.showNoFees] "No booking fees": only when the totals really carry no client fee
 * @param {React.ReactNode} [props.errorMessage] an error to show where the price would be
 */
const CheckoutSummary = props => {
  const {
    listingTitle,
    listingId,
    author,
    coachName,
    coachFirstName,
    startMs,
    endMs,
    timeZone,
    timeZoneCity,
    priceVariantName,
    locale,
    sessionPriceText,
    promoSection,
    totalText,
    showNoFees,
    errorMessage,
  } = props;

  const intl = useIntl();
  const { lead, bold } = splitAfterLastComma(listingTitle);
  const hasTime = Number.isFinite(startMs) && Number.isFinite(endMs);
  const minutes = hasTime ? sessionMinutes(startMs, endMs) : null;

  return (
    <aside
      className={css.root}
      aria-label={intl.formatMessage({ id: 'CheckoutPage.summaryLabel' })}
      data-testid="checkout-summary"
    >
      <div className={css.coach}>
        <CoachPhoto
          className={css.photo}
          image={author?.profileImage}
          name={coachName}
          sizes="76px"
        />
        <div className={css.coachText}>
          <div className={css.title} data-testid="summary-title">
            {lead}
            {bold ? <b>{bold}</b> : null}
          </div>
          <span className={css.with}>
            <FormattedMessage
              id="CheckoutPage.summaryWith"
              values={{
                name: author?.id ? (
                  <NamedLink
                    name="ProfilePage"
                    params={{ id: author.id.uuid }}
                    className={css.link}
                  >
                    {coachName}
                  </NamedLink>
                ) : (
                  coachName
                ),
              }}
            />
          </span>
        </div>
      </div>

      {hasTime ? (
        <ul className={css.facts}>
          <li className={css.fact}>
            <IconCalendarStar size={22} />
            <span>
              <b data-testid="summary-when">
                {formatSessionWhen(startMs, endMs, timeZone, locale)}
              </b>
              {' · '}
              <NamedLink
                name="ListingPage"
                params={{ id: listingId?.uuid, slug: createSlug(listingTitle) }}
                to={{ search: findNewTimeSearch({ priceVariantName, startMs, timeZone }) }}
                className={css.link}
              >
                <FormattedMessage id="CheckoutPage.findNewTime" />
              </NamedLink>
              <br />
              <span className={css.quiet}>
                <FormattedMessage
                  id="CheckoutPage.inYourTimezone"
                  values={{ zone: timeZoneCity }}
                />
              </span>
            </span>
          </li>
          <li className={css.fact}>
            <IconVideoCall size={22} />
            <span>
              <FormattedMessage id="CheckoutPage.videoCall" values={{ minutes }} />
            </span>
          </li>
        </ul>
      ) : null}

      <hr className={css.rule} />

      {errorMessage ? <div className={css.errorChip}>{errorMessage}</div> : null}

      <div className={css.lines}>
        {sessionPriceText ? (
          <div className={css.line}>
            <span>
              {minutes ? (
                <FormattedMessage id="CheckoutPage.sessionLine" values={{ minutes }} />
              ) : (
                <FormattedMessage id="CheckoutPage.sessionLineNoLength" />
              )}
            </span>
            <span data-testid="summary-session-price">{sessionPriceText}</span>
          </div>
        ) : null}
        {promoSection}
      </div>

      <div className={css.totalRow}>
        <div className={css.totalLabels}>
          <span className={css.totalLabel}>
            <FormattedMessage id="CheckoutPage.total" />
          </span>
          {showNoFees ? (
            <span className={css.noFees}>
              <FormattedMessage id="CheckoutPage.noFees" />
            </span>
          ) : null}
        </div>
        <span className={css.total} data-testid="summary-total">
          {totalText}
        </span>
      </div>

      {hasTime && isInsideFreeWindow(startMs) ? (
        // Never a "free to cancel until" time that has already passed: a session starting within 48
        // hours can't be moved, and cancelling is charged (the coach cancelling still refunds in full).
        <div className={css.insideBox} data-testid="inside-48">
          <span aria-hidden="true" className={css.insideMark}>
            !
          </span>
          <span>
            <FormattedMessage
              id="CheckoutPage.insideWindow"
              values={{ name: coachFirstName, b: chunks => <b>{chunks}</b> }}
            />
          </span>
        </div>
      ) : hasTime ? (
        <div className={css.cancelBox}>
          <IconCancelling size={22} />
          <span>
            <FormattedMessage
              id="CheckoutPage.cancelBox"
              values={{
                date: formatCancelUntil(startMs, timeZone, locale),
                name: coachFirstName,
                b: chunks => <b>{chunks}</b>,
              }}
            />
          </span>
        </div>
      ) : null}
    </aside>
  );
};

export default CheckoutSummary;
