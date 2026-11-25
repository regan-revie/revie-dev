import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

import { FormattedMessage, useIntl } from '../../util/reactIntl';

import { BookingLayoutContext, LAYOUT_SHEET } from './BookingPanelParts';

import css from './BookingSheet.module.css';

const SHEET_ID = 'BookingSheet';

/**
 * The phone's booking sheet (docs/design/session-page/ PhoneSheet): rises over the page with a
 * handle, "Book with {name}" and a close button, holds the booking steps, and keeps the total and
 * the book button at the bottom. Renders nothing while closed, so the steps start fresh each time.
 *
 * It lives in document.body, not in place: the page's coloured bands clip what they hold. Escape,
 * the close button and a tap on the dimmed page all close it; focus moves in on open and back to the
 * button that opened it on close. The open state is the page's own (`?orderOpen=true`), so the
 * phone's back button closes the sheet.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {Function} props.onClose
 * @param {string} props.name the coach's first name, for the title
 * @param {string} [props.returnFocusId] id of the element to focus when the sheet closes
 * @param {Function} props.onManageDisableScrolling
 */
const BookingSheet = ({
  isOpen,
  onClose,
  name,
  returnFocusId,
  onManageDisableScrolling,
  children,
}) => {
  const intl = useIntl();
  const closeRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    onManageDisableScrolling?.(SHEET_ID, true);
    closeRef.current?.focus();
    const onKeyDown = e => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      onManageDisableScrolling?.(SHEET_ID, false);
      if (returnFocusId) {
        document.getElementById(returnFocusId)?.focus();
      }
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return ReactDOM.createPortal(
    <div
      className={css.overlay}
      data-testid="booking-sheet-overlay"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-sheet-title"
        className={css.sheet}
      >
        <div className={css.header}>
          <div aria-hidden="true" className={css.handle} />
          <div className={css.titleRow}>
            <h2 id="booking-sheet-title" className={css.title}>
              <FormattedMessage id="BookingPanel.headingLead" />
              <b>{name}</b>
            </h2>
            <button
              type="button"
              ref={closeRef}
              className={css.close}
              onClick={onClose}
              aria-label={intl.formatMessage({ id: 'Modal.close' })}
            >
              ×
            </button>
          </div>
        </div>
        <BookingLayoutContext.Provider value={LAYOUT_SHEET}>
          <div className={css.body}>{children}</div>
        </BookingLayoutContext.Provider>
      </section>
    </div>,
    document.body
  );
};

export default BookingSheet;
