import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { tagColourAt } from './sessionPageHelpers';

import css from './SessionHero.module.css';

const DIALOG_ID = 'SessionPage.livedExperience';

/**
 * The centred "{First name}'s been there." dialog listing all of a coach's lived-experience tags.
 *
 * Rendered into document.body, not in place: the hero it is opened from clips its own drawing
 * (that is how its colour reaches the screen edges), and a clip would cut the dialog off too.
 * Escape, the close button and a click on the dimmed background all close it; focus moves into it
 * on open and back to the button that opened it on close.
 */
const TagsDialog = props => {
  const { isOpen, onClose, firstName, tags, onManageDisableScrolling, returnFocusRef } = props;
  const intl = useIntl();
  const closeRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    onManageDisableScrolling?.(DIALOG_ID, true);
    closeRef.current?.focus();
    const onKeyDown = e => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const returnTo = returnFocusRef?.current;
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      onManageDisableScrolling?.(DIALOG_ID, false);
      returnTo?.focus();
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return ReactDOM.createPortal(
    <div
      className={css.dialogOverlay}
      data-testid="tags-dialog"
      onMouseDown={e => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tags-dialog-title"
        className={css.dialog}
      >
        <div className={css.dialogHeader}>
          <div className={css.dialogTitleGroup}>
            <h2 id="tags-dialog-title" className={css.dialogTitle}>
              <FormattedMessage id="SessionPage.beenThereLead" values={{ name: firstName }} />
              <b>
                <FormattedMessage id="SessionPage.beenThereBold" />
              </b>
            </h2>
            <span className={css.dialogSubtitle}>
              <FormattedMessage id="SessionPage.beenThereSubtitle" values={{ name: firstName }} />
            </span>
          </div>
          <button
            type="button"
            ref={closeRef}
            className={css.dialogClose}
            onClick={onClose}
            aria-label={intl.formatMessage({ id: 'Modal.close' })}
          >
            ×
          </button>
        </div>
        <ul className={css.dialogTags}>
          {tags.map((tag, i) => (
            <li
              key={`${tag}-${i}`}
              className={classNames(css.dialogTag, css[`tag_${tagColourAt(i)}`])}
            >
              {tag}
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body
  );
};

export default TagsDialog;
