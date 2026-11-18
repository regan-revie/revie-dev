import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { outcomesOf } from '../../util/sessionOutcomes';
import { Heading } from '../../components';

import css from './SessionOutcomes.module.css';

/**
 * "You'll walk away with": the session's outcomes as a simple numbered list on the session page.
 * Renders nothing unless outcome 1 has text. The designed layout comes with the session page
 * redesign; this is deliberately plain.
 *
 * @param {Object} props
 * @param {Object} props.publicData the listing's publicData
 */
const SessionOutcomesSection = props => {
  const { publicData, className } = props;
  const outcomes = outcomesOf(publicData);

  return outcomes.length > 0 ? (
    <section className={classNames(css.section, className)} data-testid="session-outcomes">
      <Heading as="h2" rootClassName={css.sectionHeading}>
        <FormattedMessage id="SessionOutcomesSection.title" />
      </Heading>
      <ol className={css.list}>
        {outcomes.map((text, index) => (
          <li key={index} className={css.listItem}>
            {text}
          </li>
        ))}
      </ol>
    </section>
  ) : null;
};

export default SessionOutcomesSection;
