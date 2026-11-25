import React, { createContext, useContext } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { IconInbox } from '../../containers/ListingPage/SessionPage/SessionIcons';

import css from './BookingPanelParts.module.css';

/**
 * Small pieces the session's booking panel and its states share (docs/design/session-page/ Main,
 * PhoneSheet and States). The same booking steps appear in the desktop panel and in the phone sheet;
 * the layout context tells them which one they are in, because the sizes differ.
 */

export const LAYOUT_PANEL = 'panel';
export const LAYOUT_SHEET = 'sheet';
export const BookingLayoutContext = createContext(LAYOUT_PANEL);
export const useBookingLayout = () => useContext(BookingLayoutContext);

/**
 * The coach's pronouns as the booking panel's sentences need them ("She's setting up her
 * calendar"). she/her and he/him are used as set; anything else (they/them, she/they, he/they,
 * other, or none set) reads "They're ... them".
 *
 * @param {string} [pronounsKey] the user field's option key (`she-her`, `he-him`, ...)
 * @returns {{subjectIs: string, object: string, possessive: string}}
 */
export const pronounWords = pronounsKey =>
  pronounsKey === 'she-her'
    ? { subjectIs: "She's", object: 'her', possessive: 'her' }
    : pronounsKey === 'he-him'
    ? { subjectIs: "He's", object: 'him', possessive: 'his' }
    : { subjectIs: "They're", object: 'them', possessive: 'their' };

/** "Book with **Maya**" */
export const PanelHeading = ({ name, className, as: Tag = 'h2' }) => (
  <Tag className={classNames(css.heading, className)}>
    <FormattedMessage id="BookingPanel.headingLead" />
    <b>{name}</b>
  </Tag>
);

/** The card the panel and its states sit in. */
export const BookingCard = ({ className, children, ...rest }) => (
  <aside className={classNames(css.card, className)} {...rest}>
    <div className={css.cardInner}>{children}</div>
  </aside>
);

/** A numbered step title: "1  Choose your session". */
export const StepTitle = ({ number, id, children }) => (
  <div id={id} className={css.stepTitle}>
    <span aria-hidden="true" className={css.stepNumber}>
      {number}
    </span>
    {children}
  </div>
);

/**
 * "Message Maya": the existing inquiry flow (the parent's `onContactUser`). `variant` is the
 * outlined button (panel and states), or the small link in the phone sheet's footer.
 */
export const MessageCoach = ({ name, onClick, variant = 'button', className }) => (
  <button
    type="button"
    onClick={onClick}
    className={classNames(variant === 'link' ? css.messageLink : css.messageButton, className)}
  >
    <IconInbox size={variant === 'link' ? 18 : 20} />
    <FormattedMessage id="BookingPanel.message" values={{ name }} />
  </button>
);
