import React from 'react';
import classNames from 'classnames';

import css from './SessionParts.module.css';

/**
 * Small pieces the session page's sections share, so each section reads the same way: an all-caps
 * label with a hairline, a two-weight headline, a "Read more" toggle, and a band that runs the full
 * width of the screen behind a column that does not.
 */

/** The all-caps section label with a hairline after it ("THE SESSION ———"). */
export const SectionLabel = ({ children, className }) => (
  <div className={classNames(css.label, className)}>
    <span>{children}</span>
    <span aria-hidden="true" className={css.rule} />
  </div>
);

/**
 * A headline in two weights: `lead` Regular, `bold` Bold ("You'll **walk away with**"). The Bold
 * part is a <b>, so assistive tech reads the headline as one sentence.
 */
export const Headline = ({ as: Tag = 'h2', id, lead, bold, className }) => (
  <Tag id={id} className={classNames(css.headline, className)}>
    {lead}
    <b>{bold}</b>
  </Tag>
);

const Chevron = () => (
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
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** "Read more ⌄": a text button that opens and closes a block. */
export const ToggleButton = ({ expanded, onClick, controls, children }) => (
  <button
    type="button"
    className={css.toggle}
    onClick={onClick}
    aria-expanded={expanded}
    aria-controls={controls}
  >
    {children}
    <Chevron />
  </button>
);

/**
 * A band of colour that fills the screen's width while its content stays in the page column. The
 * colour is drawn outward past the column's edges (a shadow with no blur) and clipped to the
 * section's own top and bottom, so no wrapper has to break out of the column.
 */
export const Band = ({ tone, as: Tag = 'section', className, children, ...rest }) => (
  <Tag
    className={classNames(
      css.band,
      { [css.bandMaroon]: tone === 'maroon', [css.bandPeriwinkle]: tone === 'periwinkle' },
      className
    )}
    {...rest}
  >
    {children}
  </Tag>
);
