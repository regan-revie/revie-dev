import React from 'react';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { NamedLink } from '../../components';

import { BookingCard, MessageCoach, PanelHeading, pronounWords } from './BookingPanelParts';
import { formatPanelPrice } from './NylasBookingForm/PriceVariantRadios';

import css from './NotTakingBookingsCard.module.css';

/**
 * What a client sees when the coach cannot be booked yet (docs/design/session-page/ States, left
 * card): the prices, then "{Name} isn't taking bookings yet", a solid "Find another coach" and an
 * outlined "Message {Name}". Nothing here is an error, so nothing is red.
 *
 * @param {Object} props
 * @param {string} props.name the coach's first name
 * @param {string} [props.pronounsKey] the coach's pronouns option (`she-her`, ...)
 * @param {Array} [props.priceVariants] {name, priceInSubunits}
 * @param {string} [props.currency]
 * @param {Function} [props.onMessage] the existing inquiry flow; the button is left out without it
 */
const NotTakingBookingsCard = ({ name, pronounsKey, priceVariants = [], currency, onMessage }) => {
  const intl = useIntl();
  const { subjectIs, object, possessive } = pronounWords(pronounsKey);

  return (
    <BookingCard className={css.card} data-testid="not-taking-bookings">
      <PanelHeading name={name} />
      {priceVariants.length > 0 ? (
        <ul className={css.prices}>
          {priceVariants.map(variant => (
            <li key={variant.name} className={css.priceRow}>
              <span className={css.priceName}>{variant.name}</span>
              <span>{formatPanelPrice(intl, variant.priceInSubunits, currency)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={css.message}>
        <p className={css.lead}>
          <FormattedMessage id="BookingPanel.notTakingLead" values={{ name }} />
        </p>
        <p className={css.text}>
          <FormattedMessage
            id="BookingPanel.notTakingText"
            values={{ subjectIs, object, possessive }}
          />
        </p>
      </div>
      <NamedLink name="SearchPage" className={css.findButton}>
        <FormattedMessage id="BookingPanel.findAnother" />
      </NamedLink>
      {onMessage ? <MessageCoach name={name} onClick={onMessage} /> : null}
    </BookingCard>
  );
};

export default NotTakingBookingsCard;
