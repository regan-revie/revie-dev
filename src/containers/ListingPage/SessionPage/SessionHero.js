import React, { useRef, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { userDisplayNameAsString } from '../../../util/data';
import { NamedLink, ResponsiveImage } from '../../../components';

import { IconVideoCall, IconCalendarStar, IconPrep } from './SessionIcons';
import TagsDialog from './TagsDialog';
import useNextAvailable from './useNextAvailable';
import { Band, SectionLabel } from './SessionParts';
import {
  COACH_TITLE_KEY,
  CERTIFICATIONS_KEY,
  LANGUAGES_KEY,
  LIVED_EXPERIENCE_KEY,
  LOCATION_KEY,
  PRONOUNS_KEY,
} from './coachFields';
import {
  averageRating,
  capTags,
  firstNameOf,
  formatShortDay,
  hasText,
  lengthsText,
  optionLabels,
  sessionLengths,
  splitAfterLastComma,
  tagColourAt,
} from './sessionPageHelpers';

import css from './SessionHero.module.css';

const AVATAR_VARIANTS = ['square-small', 'square-small2x'];

const Star = ({ size }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    style={{ flex: 'none' }}
  >
    <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z" />
  </svg>
);

/** The capsule "sticker" photo: the coach's profile image, tilted, over a chartreuse shape. */
const CoachSticker = ({ image, name }) => {
  const hasImage = image && image.id;
  const initials = name
    .split(/\s+/)
    .map(part => part.charAt(0))
    .join('')
    .slice(0, 2);
  return (
    <div className={css.sticker}>
      <div aria-hidden="true" className={css.stickerBack} />
      <div className={css.stickerPhoto}>
        {hasImage ? (
          <ResponsiveImage
            rootClassName={css.stickerImage}
            alt={name}
            image={image}
            variants={AVATAR_VARIANTS}
            sizes="(min-width: 1024px) 112px, 76px"
          />
        ) : (
          <span aria-hidden="true" className={css.stickerInitials}>
            {initials}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * The maroon hero at the top of the session page: what the session is called, a few quick facts,
 * and who the coach is.
 *
 * @param {Object} props
 * @param {Object} props.listing the session (listing entity)
 * @param {Object} props.author the coach (user entity, with profileImage)
 * @param {Array} props.reviews this session's reviews
 * @param {Array} props.userFields user field configs, for option labels
 * @param {Function} props.onManageDisableScrolling
 */
const SessionHero = props => {
  const { listing, author, reviews = [], userFields, onManageDisableScrolling } = props;
  const intl = useIntl();
  const [tagsOpen, setTagsOpen] = useState(false);
  const moreButtonRef = useRef(null);

  const { title, publicData = {} } = listing.attributes;
  const profile = author?.attributes?.profile || {};
  const authorPublicData = profile.publicData || {};
  const displayName = userDisplayNameAsString(author, '');
  const firstName = firstNameOf(displayName);

  // Title: Regular up to the last comma, Bold after it (whole title Bold with no comma).
  const { lead, bold } = splitAfterLastComma(title);

  // "SIGNATURE SESSION · 30, 60 OR 90 MIN" from the price variants.
  const lengths = sessionLengths(publicData);
  const orWord = intl.formatMessage({ id: 'SessionPage.or' });
  const labelLengths = lengthsText(lengths, orWord);
  const labelLengthsPhone = lengthsText(lengths, orWord, true);

  // Quick facts.
  const variantName = publicData.priceVariants?.[0]?.name;
  const nextStart = useNextAvailable({
    listingId: listing.id?.uuid,
    priceVariantName: variantName,
    enabled: !!publicData.calendarBookingEnabled,
  });
  const nextDay = nextStart ? formatShortDay(nextStart, intl.locale) : null;
  const showPrep = hasText(publicData.pre_work);

  // The coach.
  const pronouns = optionLabels(userFields, PRONOUNS_KEY, authorPublicData[PRONOUNS_KEY])[0];
  const coachTitle = hasText(authorPublicData[COACH_TITLE_KEY])
    ? authorPublicData[COACH_TITLE_KEY].trim()
    : null;
  const certification = optionLabels(
    userFields,
    CERTIFICATIONS_KEY,
    authorPublicData[CERTIFICATIONS_KEY]
  )[0];
  const where = [
    optionLabels(userFields, LOCATION_KEY, authorPublicData[LOCATION_KEY])[0],
    optionLabels(userFields, LANGUAGES_KEY, authorPublicData[LANGUAGES_KEY]).join(', '),
  ]
    .filter(hasText)
    .join(' · ');
  const rating = averageRating(reviews);
  const tags = capTags(
    optionLabels(userFields, LIVED_EXPERIENCE_KEY, authorPublicData[LIVED_EXPERIENCE_KEY])
  );

  const profileLink = author?.id ? (
    <NamedLink
      name="ProfilePage"
      params={{ id: author.id.uuid }}
      className={css.name}
      ariaLabel={intl.formatMessage({ id: 'SessionPage.seeProfile' }, { name: displayName })}
    >
      {displayName}
    </NamedLink>
  ) : (
    <span className={css.name}>{displayName}</span>
  );

  return (
    <Band
      tone="maroon"
      className={css.hero}
      aria-labelledby="session-title"
      data-testid="session-hero"
    >
      <SectionLabel>
        <span className={css.labelWide}>
          <FormattedMessage
            id={labelLengths ? 'SessionPage.heroLabel' : 'SessionPage.heroLabelNoLengths'}
            values={{ lengths: labelLengths }}
          />
        </span>
        <span className={css.labelNarrow}>
          <FormattedMessage
            id={labelLengths ? 'SessionPage.heroLabel' : 'SessionPage.heroLabelNoLengths'}
            values={{ lengths: labelLengthsPhone }}
          />
        </span>
      </SectionLabel>

      <h1 id="session-title" className={css.title} data-testid="session-title">
        {lead}
        <b>{bold}</b>
      </h1>

      <ul className={css.facts} aria-label={intl.formatMessage({ id: 'SessionPage.quickFacts' })}>
        <li className={css.fact}>
          <IconVideoCall className={css.factIcon} />
          <FormattedMessage id="SessionPage.factVideoCall" />
        </li>
        {nextDay ? (
          <li className={css.fact} data-testid="fact-next-available">
            <IconCalendarStar className={css.factIcon} />
            <FormattedMessage id="SessionPage.factNextAvailable" values={{ day: nextDay }} />
          </li>
        ) : null}
        {showPrep ? (
          <li className={css.fact} data-testid="fact-prep">
            <IconPrep className={css.factIcon} />
            <FormattedMessage id="SessionPage.factPrep" />
          </li>
        ) : null}
      </ul>

      <div className={css.coachRow}>
        <CoachSticker image={author?.profileImage} name={displayName} />

        <div className={css.info}>
          <div className={css.nameRow}>
            {profileLink}
            {pronouns ? <span className={css.pronouns}>{pronouns}</span> : null}
          </div>
          {coachTitle ? <div className={css.coachTitle}>{coachTitle}</div> : null}
        </div>

        <div className={css.badges}>
          {rating ? (
            <a href="#reviews" className={css.newBadge} data-testid="rating-badge">
              <Star size={14} />
              <FormattedMessage
                id="SessionPage.ratingBadge"
                values={{ rating, count: reviews.length }}
              />
            </a>
          ) : (
            <span className={css.newBadge} data-testid="new-badge">
              <Star size={14} />
              <FormattedMessage id="SessionPage.newToRevie" />
            </span>
          )}
          {certification ? <span className={css.cert}>{certification}</span> : null}
          {where ? <span className={css.where}>{where}</span> : null}
        </div>

        {tags.all.length > 0 ? (
          <ul
            className={css.tags}
            aria-label={intl.formatMessage({ id: 'SessionPage.livedExperience' })}
            data-testid="hero-tags"
          >
            {tags.shown.map((tag, i) => (
              <li key={`${tag}-${i}`} className={classNames(css.tag, css[`tag_${tagColourAt(i)}`])}>
                {tag}
              </li>
            ))}
            {tags.hiddenCount > 0 ? (
              <li>
                <button
                  type="button"
                  ref={moreButtonRef}
                  className={css.moreButton}
                  onClick={() => setTagsOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={tagsOpen}
                >
                  <FormattedMessage
                    id="SessionPage.moreTags"
                    values={{ count: tags.hiddenCount }}
                  />
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <TagsDialog
        isOpen={tagsOpen}
        onClose={() => setTagsOpen(false)}
        firstName={firstName}
        tags={tags.all}
        onManageDisableScrolling={onManageDisableScrolling}
        returnFocusRef={moreButtonRef}
      />
    </Band>
  );
};

export default SessionHero;
