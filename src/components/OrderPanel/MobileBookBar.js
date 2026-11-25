import React from 'react';

import { FormattedMessage } from '../../util/reactIntl';

import css from './MobileBookBar.module.css';

/**
 * The phone's bar at the bottom of the session page (docs/design/session-page/ Phone): the price and
 * length, when the next time is, and a solid "See times" button that opens the booking sheet.
 *
 * @param {Object} props
 * @param {string} [props.priceText] "$110"
 * @param {number} [props.minutes] "· 60 min"
 * @param {string} [props.nextDay] "Tue 17 Nov"; the line is left out without one
 * @param {string} props.buttonId
 * @param {Function} props.onClick
 */
const MobileBookBar = ({ priceText, minutes, nextDay, buttonId, onClick }) => (
  <div className={css.bar} data-testid="book-bar">
    <div className={css.info}>
      <span>
        {priceText ? <b className={css.price}>{priceText}</b> : null}
        {minutes ? (
          <span className={css.minutes}>
            {priceText ? ' · ' : ''}
            <FormattedMessage id="BookingPanel.barMinutes" values={{ minutes }} />
          </span>
        ) : null}
      </span>
      {nextDay ? (
        <span className={css.next}>
          <FormattedMessage id="BookingPanel.next" values={{ day: nextDay }} />
        </span>
      ) : null}
    </div>
    <button type="button" id={buttonId} className={css.button} onClick={onClick}>
      <FormattedMessage id="BookingPanel.seeTimes" />
    </button>
  </div>
);

export default MobileBookBar;
