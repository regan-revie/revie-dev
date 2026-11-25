import React from 'react';

import { FormattedMessage } from '../../../util/reactIntl';
import { CoachPhoto } from '../../../components';

import { heroDateParts } from './bookingFormat';

import css from './BookingHero.module.css';

/**
 * The maroon hero of the client's booking page (docs/design/booking-confirmation/ Main and Phone):
 * the coach's photo and the client's own, each with a name pill, joined by dashed lines to a
 * chartreuse date card, then "You're **booked.**" and the session's title with the coach's name.
 * The date card is left out when there is no time to show.
 *
 * @param {Object} props
 * @param {Object} [props.coachImage] the coach's profile image entity
 * @param {string} props.coachName "Maya R."
 * @param {string} props.coachFirstName "Maya"
 * @param {Object} [props.clientImage] the client's own profile image entity
 * @param {string} props.clientName the client's own name (for the initials when there is no photo)
 * @param {number} [props.startMs] when the session starts
 * @param {string} props.timeZone the client's own timezone
 * @param {React.ReactNode} props.heading the big words ("You're <b>booked.</b>")
 * @param {string} props.sessionTitle the session's title
 */
const BookingHero = props => {
  const {
    coachImage,
    coachName,
    coachFirstName,
    clientImage,
    clientName,
    startMs,
    timeZone,
    heading,
    sessionTitle,
  } = props;
  const date = Number.isFinite(startMs) ? heroDateParts(startMs, timeZone) : null;

  return (
    <section className={css.root} data-testid="booking-hero">
      <div className={css.inner}>
        <div className={css.trio}>
          <div className={css.person}>
            <CoachPhoto
              className={css.coachPhoto}
              image={coachImage}
              name={coachName}
              sizes="120px"
            />
            <span className={css.pill}>{coachFirstName}</span>
          </div>
          {date ? (
            <>
              <span aria-hidden="true" className={css.dash} />
              <div className={css.dateCard} data-testid="hero-date">
                <span className={css.dateTop}>{date.top}</span>
                <span className={css.dateDay}>{date.day}</span>
                <span className={css.dateTime}>{date.time}</span>
              </div>
              <span aria-hidden="true" className={css.dash} />
            </>
          ) : (
            <span aria-hidden="true" className={css.dash} />
          )}
          <div className={css.person}>
            <CoachPhoto
              className={css.clientPhoto}
              image={clientImage}
              name={clientName}
              tone="periwinkle"
              sizes="120px"
            />
            <span className={css.pill}>
              <FormattedMessage id="BookingConfirmation.you" />
            </span>
          </div>
        </div>

        <div className={css.titleBlock}>
          <h1 className={css.heading}>{heading}</h1>
          <div className={css.subtitle}>
            {sessionTitle ? `${sessionTitle.replace(/[.\s]+$/, '')} · ` : ''}
            <FormattedMessage id="BookingConfirmation.withCoach" values={{ name: coachName }} />
          </div>
        </div>
      </div>
    </section>
  );
};

export default BookingHero;
