import React, { useState } from 'react';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';

import { IconPrep } from './SessionIcons';
import { SectionLabel, ToggleButton } from './SessionParts';
import { hasText, splitDescription } from './sessionPageHelpers';

import css from './SessionSections.module.css';

/**
 * "The session": the first sentence of the description set large, the rest in body text with a
 * "Read more" for anything longer, then the "Before your session" card when the coach has said what
 * happens beforehand (the pre_work field).
 */
const SessionAbout = ({ description, preWork }) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const { lead, body, more } = splitDescription(description);

  if (!lead && !hasText(preWork)) {
    return null;
  }

  return (
    <section
      aria-label={intl.formatMessage({ id: 'SessionPage.aboutLabel' })}
      className={css.about}
      data-testid="session-about"
    >
      <SectionLabel>
        <FormattedMessage id="SessionPage.labelSession" />
      </SectionLabel>

      {lead ? <p className={css.lead}>{lead}</p> : null}
      {body ? <p className={css.body}>{body}</p> : null}
      {more.length > 0 ? (
        <>
          {open ? (
            <div id="session-more" className={css.more}>
              {more.map((paragraph, i) => (
                <p key={i} className={css.paragraph}>
                  {paragraph}
                </p>
              ))}
            </div>
          ) : null}
          <div>
            <ToggleButton expanded={open} controls="session-more" onClick={() => setOpen(!open)}>
              <FormattedMessage id={open ? 'SessionPage.readLess' : 'SessionPage.readMore'} />
            </ToggleButton>
          </div>
        </>
      ) : null}

      {hasText(preWork) ? (
        <div className={css.prepCard} data-testid="prep-card">
          <IconPrep size={32} />
          <div className={css.prepText}>
            <div className={css.prepTitle}>
              <FormattedMessage id="SessionPage.prepTitle" />
            </div>
            <p className={css.prepBody}>{preWork.trim()}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default SessionAbout;
