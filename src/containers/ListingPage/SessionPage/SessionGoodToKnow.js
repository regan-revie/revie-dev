import React from 'react';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { NamedLink } from '../../../components';

import { IconVideoCall, IconPaying, IconCancelling, IconCalendarStar } from './SessionIcons';
import { Band, Headline, SectionLabel } from './SessionParts';

import css from './SessionSections.module.css';

/**
 * "Good to know": the four things a client wants settled before booking - how the session happens,
 * paying, cancelling, moving it - as off-white cards on a maroon band. These are the platform's
 * policy, the same for every coach and session (48 hours is the cancellation and move limit, see
 * docs/tech-constraints.md), so the words are fixed rather than read from the session.
 */
const SessionGoodToKnow = ({ firstName, authorId }) => {
  const intl = useIntl();
  const cards = [
    { id: 'meet', Icon: IconVideoCall },
    { id: 'paying', Icon: IconPaying },
    { id: 'cancelling', Icon: IconCancelling },
    { id: 'moving', Icon: IconCalendarStar },
  ];

  return (
    <Band
      tone="maroon"
      aria-labelledby="session-good"
      className={css.good}
      data-testid="session-good"
    >
      <SectionLabel>
        <FormattedMessage id="SessionPage.labelDetails" />
      </SectionLabel>
      <Headline
        id="session-good"
        lead={intl.formatMessage({ id: 'SessionPage.goodLead' })}
        bold={intl.formatMessage({ id: 'SessionPage.goodBold' })}
      />
      <div className={css.goodGrid}>
        {cards.map(({ id, Icon }) => (
          <div key={id} className={css.goodCard}>
            <Icon size={40} className={css.goodIcon} />
            <div className={css.goodTitle}>
              <FormattedMessage id={`SessionPage.good.${id}.title`} />
            </div>
            <p className={css.goodText}>
              <FormattedMessage id={`SessionPage.good.${id}.text`} values={{ name: firstName }} />
            </p>
          </div>
        ))}
      </div>
      {authorId ? (
        <NamedLink name="ProfilePage" params={{ id: authorId }} className={css.allSessions}>
          <FormattedMessage id="SessionPage.allSessions" values={{ name: firstName }} />
        </NamedLink>
      ) : null}
    </Band>
  );
};

export default SessionGoodToKnow;
