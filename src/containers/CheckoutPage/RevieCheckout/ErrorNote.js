import React from 'react';
import classNames from 'classnames';

import css from './ErrorNote.module.css';

/**
 * An error on the checkout page: the error red, bold, with an icon, so it does not depend on colour
 * alone (docs/design/checkout/ States). `boxed` is the bordered note for what happens to the whole
 * payment (a declined card, no connection); the plain one sits under a single field (the promo
 * code, the card number).
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children the message
 * @param {boolean} [props.boxed] the bordered version
 * @param {string} [props.className]
 * @param {string} [props.id] so a field can point at it with `aria-describedby`
 */
const ErrorNote = ({ children, boxed = false, className, id }) => (
  <p
    id={id}
    role="alert"
    className={classNames(css.root, { [css.boxed]: boxed }, className)}
    data-testid="checkout-error"
  >
    <svg
      aria-hidden="true"
      focusable="false"
      className={css.icon}
      width={boxed ? 22 : 16}
      height={boxed ? 22 : 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </svg>
    <span>{children}</span>
  </p>
);

export default ErrorNote;
