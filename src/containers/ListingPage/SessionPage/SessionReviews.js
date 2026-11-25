import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { UserDisplayName } from '../../../components';

import { Headline } from './SessionParts';
import { reviewScore } from './sessionPageHelpers';

import css from './SessionSections.module.css';

const REVIEWS_SHOWN = 2;

const Star = ({ filled }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={classNames({ [css.starEmpty]: !filled })}
    style={{ flex: 'none' }}
  >
    <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z" />
  </svg>
);

const ReviewCard = ({ review }) => {
  const intl = useIntl();
  const { rating, content, createdAt } = review.attributes;
  const monthYear = intl.formatDate(createdAt, { month: 'short', year: 'numeric' });
  return (
    <figure className={css.reviewCard} data-testid="review-card">
      <div
        role="img"
        aria-label={intl.formatMessage({ id: 'SessionPage.ratingOutOfFive' }, { rating })}
        className={css.stars}
      >
        {[1, 2, 3, 4, 5].map(n => (
          <Star key={n} filled={n <= rating} />
        ))}
      </div>
      <blockquote className={css.reviewQuote}>“{content}”</blockquote>
      <figcaption className={css.reviewCaption}>
        <b>
          <UserDisplayName user={review.author} intl={intl} />
        </b>
        <span className={css.reviewDate}>{monthYear}</span>
      </figcaption>
    </figure>
  );
};

/**
 * "Reviews of this session". Nothing at all while the session has none: a blank "Reviews (0)" says
 * the wrong thing to a visitor. With some, the two latest and a button for the rest. The average is
 * shown only from three reviews (see `reviewScore`); with one or two the cards stand alone.
 *
 * Each review shows the month it was written; the length of the session reviewed is not on the
 * review the API returns, so it is left out rather than guessed.
 */
const SessionReviews = ({ reviews = [] }) => {
  const intl = useIntl();
  const [showAll, setShowAll] = useState(false);

  if (reviews.length === 0) {
    return null;
  }

  const newestFirst = [...reviews].sort(
    (a, b) => new Date(b.attributes.createdAt) - new Date(a.attributes.createdAt)
  );
  const shown = showAll ? newestFirst : newestFirst.slice(0, REVIEWS_SHOWN);
  const canExpand = newestFirst.length > REVIEWS_SHOWN;
  const { average } = reviewScore(reviews);

  return (
    <section
      id="reviews"
      aria-labelledby="session-reviews"
      className={css.reviews}
      data-testid="session-reviews"
    >
      <div className={css.reviewsHeader}>
        <Headline
          id="session-reviews"
          lead={intl.formatMessage({ id: 'SessionPage.reviewsLead' })}
          bold={intl.formatMessage({ id: 'SessionPage.reviewsBold' })}
        />
        {average ? (
          <div className={css.average} data-testid="reviews-average">
            <span className={css.averageNumber}>{average}</span>
            <span>
              <FormattedMessage id="SessionPage.fromReviews" values={{ count: reviews.length }} />
            </span>
          </div>
        ) : null}
      </div>
      <div className={css.reviewGrid}>
        {shown.map(review => (
          <ReviewCard key={review.id.uuid} review={review} />
        ))}
      </div>
      {canExpand ? (
        <button
          type="button"
          className={css.outlineButton}
          onClick={() => setShowAll(!showAll)}
          aria-expanded={showAll}
        >
          <FormattedMessage
            id={showAll ? 'SessionPage.showFewerReviews' : 'SessionPage.seeAllReviews'}
            values={{ count: reviews.length }}
          />
        </button>
      ) : null}
    </section>
  );
};

export default SessionReviews;
