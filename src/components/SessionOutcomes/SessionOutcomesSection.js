import React from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { outcomesOf } from '../../util/sessionOutcomes';
import { Band, Headline } from '../../containers/ListingPage/SessionPage/SessionParts';

import css from './SessionOutcomesSection.module.css';

/**
 * "You'll walk away with": the session's outcomes as a periwinkle band on the session page, each
 * with its number in a forest circle, joined by a thin line. Renders nothing unless outcome 1 has
 * text (it is required, so without it the rest should not stand alone); a blank outcome 2 or 3 is
 * skipped, so the numbering never has a gap.
 *
 * Replaces the plain numbered list this component first drew (session page redesign, job A).
 *
 * @param {Object} props
 * @param {Object} props.publicData the listing's publicData
 */
const SessionOutcomesSection = props => {
  const { publicData, className } = props;
  const intl = useIntl();
  const outcomes = outcomesOf(publicData);

  if (outcomes.length === 0) {
    return null;
  }

  return (
    <Band
      tone="periwinkle"
      aria-labelledby="session-outcomes-title"
      className={classNames(css.section, className)}
      data-testid="session-outcomes"
    >
      <Headline
        id="session-outcomes-title"
        lead={intl.formatMessage({ id: 'SessionOutcomesSection.titleLead' })}
        bold={intl.formatMessage({ id: 'SessionOutcomesSection.titleBold' })}
      />
      <div className={css.track}>
        <ol className={css.list}>
          {outcomes.map((text, index) => (
            <li key={index} className={css.item}>
              <span aria-hidden="true" className={css.number}>
                {index + 1}
              </span>
              <span className={css.text}>{text}</span>
            </li>
          ))}
        </ol>
      </div>
    </Band>
  );
};

export default SessionOutcomesSection;
