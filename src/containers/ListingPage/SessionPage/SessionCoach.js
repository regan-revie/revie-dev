import React, { useState } from 'react';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { userDisplayNameAsString } from '../../../util/data';

import { Headline, SectionLabel, ToggleButton } from './SessionParts';
import {
  COACH_QUOTE_KEY,
  COMMUNICATION_STYLE_KEY,
  SOCIAL_LINK_KEY,
  TOOLS_KEY,
} from './coachFields';
import {
  firstNameOf,
  hasText,
  optionLabels,
  safeExternalUrl,
  socialKind,
  splitAfterLastComma,
} from './sessionPageHelpers';

import css from './SessionSections.module.css';

const LinkedInIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
    <path d="M9 11v5M9 8.3v.2M12.2 16v-3c0-2.4 3.3-2.4 3.3 0v3M12.2 11v5" />
  </svg>
);

const InstagramIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="5" width="14" height="14" rx="4" />
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="16.3" cy="7.7" r="0.6" fill="currentColor" />
  </svg>
);

const LinkIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);

const SOCIAL_ICONS = { linkedin: LinkedInIcon, instagram: InstagramIcon, link: LinkIcon };

/**
 * "The coach": the quote card (when the coach has written one), how they coach, the tools they use,
 * and their story behind a "Read {name}'s story" toggle.
 */
const SessionCoach = ({ author, userFields }) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);

  const profile = author?.attributes?.profile || {};
  const publicData = profile.publicData || {};
  const name = firstNameOf(userDisplayNameAsString(author, ''));

  const quote = hasText(publicData[COACH_QUOTE_KEY]) ? publicData[COACH_QUOTE_KEY].trim() : null;
  const quoteParts = quote ? splitAfterLastComma(quote) : null;
  const styles = optionLabels(
    userFields,
    COMMUNICATION_STYLE_KEY,
    publicData[COMMUNICATION_STYLE_KEY]
  );
  const tools = optionLabels(userFields, TOOLS_KEY, publicData[TOOLS_KEY]);
  const bio = hasText(profile.bio) ? profile.bio.trim() : null;
  const socialHref = safeExternalUrl(publicData[SOCIAL_LINK_KEY]);
  const hasStory = !!bio || !!socialHref;
  const SocialIcon = socialHref ? SOCIAL_ICONS[socialKind(socialHref)] : null;

  return (
    <section aria-labelledby="session-coach" className={css.coach} data-testid="session-coach">
      <SectionLabel>
        <FormattedMessage id="SessionPage.labelCoach" />
      </SectionLabel>
      <Headline
        id="session-coach"
        lead={intl.formatMessage({ id: 'SessionPage.coachHeadingLead' })}
        bold={intl.formatMessage({ id: 'SessionPage.coachHeadingBold' }, { name })}
      />

      {quote ? (
        <figure className={css.quoteCard} data-testid="coach-quote">
          <blockquote className={css.quote}>
            “{quoteParts.lead}
            <b>{quoteParts.bold}</b>”
          </blockquote>
        </figure>
      ) : null}

      {styles.length > 0 || tools.length > 0 ? (
        <div className={css.traits}>
          {styles.length > 0 ? (
            <>
              <div className={css.traitLabel}>
                <FormattedMessage id="SessionPage.coachingStyle" />
              </div>
              <ul className={css.traitTags}>
                {styles.map((tag, i) => (
                  <li key={`${tag}-${i}`} className={css.stylePill}>
                    {tag}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {tools.length > 0 ? (
            <>
              <div className={css.traitLabel}>
                <FormattedMessage id="SessionPage.tools" />
              </div>
              <ul className={css.traitTags}>
                {tools.map((tag, i) => (
                  <li key={`${tag}-${i}`} className={css.toolPill}>
                    {tag}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {hasStory ? (
        <div className={css.storyBlock}>
          {open ? (
            <div id="coach-story" className={css.story} data-testid="coach-story">
              {bio
                ? bio.split(/\n\s*\n/).map((paragraph, i) => (
                    <p key={i} className={css.paragraph}>
                      {paragraph}
                    </p>
                  ))
                : null}
              {socialHref ? (
                <div className={css.social}>
                  <a
                    href={socialHref}
                    className={css.socialLink}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={intl.formatMessage({ id: 'SessionPage.socialLink' }, { name })}
                  >
                    <SocialIcon />
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}
          <div>
            <ToggleButton expanded={open} controls="coach-story" onClick={() => setOpen(!open)}>
              <FormattedMessage
                id={open ? 'SessionPage.hideStory' : 'SessionPage.readStory'}
                values={{ name }}
              />
            </ToggleButton>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default SessionCoach;
