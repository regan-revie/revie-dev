import React, { useState } from 'react';

import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { userDisplayNameAsString } from '../../../util/data';
import { NamedLink, WavePhoto } from '../../../components';

import { Headline, ToggleButton } from './SessionParts';
import {
  COACH_QUOTE_KEY,
  COMMUNICATION_STYLE_KEY,
  PRONOUNS_KEY,
  SOCIAL_LINK_KEY,
  TOOLS_KEY,
} from './coachFields';
import {
  firstNameOf,
  hasText,
  optionLabels,
  safeExternalUrl,
  socialKind,
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

const ChevronRight = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const SOCIAL_ICONS = { linkedin: LinkedInIcon, instagram: InstagramIcon, link: LinkIcon };

/**
 * "Get to know {name}": the quote card (when the coach has written one), how they coach, the tools
 * they use, and their story behind a "Read {name}'s story" toggle.
 *
 * The quote card carries the coach's photo in the wavy shape, her name in capitals and pronouns
 * (when she has set them), and a button to her profile.
 *
 * `afterReviews` is set when the session has reviews: the section then opens with a hairline and
 * more space, so the reviews and the coach read as two sections rather than one long one.
 */
const SessionCoach = ({ author, userFields, afterReviews = false }) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);

  const profile = author?.attributes?.profile || {};
  const publicData = profile.publicData || {};
  const displayName = userDisplayNameAsString(author, '');
  const name = firstNameOf(displayName);
  const pronouns = optionLabels(userFields, PRONOUNS_KEY, publicData[PRONOUNS_KEY])[0];

  const quote = hasText(publicData[COACH_QUOTE_KEY]) ? publicData[COACH_QUOTE_KEY].trim() : null;
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
    <section
      aria-labelledby="session-coach"
      className={classNames(css.coach, { [css.coachAfterReviews]: afterReviews })}
      data-testid="session-coach"
    >
      <Headline
        id="session-coach"
        lead={intl.formatMessage({ id: 'SessionPage.coachHeadingLead' })}
        bold={intl.formatMessage({ id: 'SessionPage.coachHeadingBold' }, { name })}
      />

      {quote ? (
        <figure className={css.quoteCard} data-testid="coach-quote">
          <WavePhoto
            className={css.quotePhoto}
            image={author?.profileImage}
            name={displayName}
            sizes="(min-width: 1024px) 260px, 90vw"
          />
          <div className={css.quoteBody}>
            <blockquote className={css.quote}>“{quote}”</blockquote>
            <figcaption className={css.quoteCaption}>
              <span className={css.quoteName}>{displayName}</span>
              {pronouns ? <span className={css.quotePronouns}>{pronouns}</span> : null}
            </figcaption>
            {author?.id ? (
              <NamedLink
                name="ProfilePage"
                params={{ id: author.id.uuid }}
                className={css.profileButton}
              >
                <FormattedMessage id="SessionPage.seeProfileButton" values={{ name }} />
                <ChevronRight />
              </NamedLink>
            ) : null}
          </div>
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
