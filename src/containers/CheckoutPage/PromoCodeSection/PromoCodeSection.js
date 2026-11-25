import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import ErrorNote from '../RevieCheckout/ErrorNote';

import css from './PromoCodeSection.module.css';

// The refusals the page has wording for (CheckoutPage.promo.error.* in en.json). Anything else is
// shown as "unavailable".
const KNOWN_REASONS = [
  'invalid',
  'expired',
  'used-up',
  'first-session-only',
  'already-used',
  'in-progress',
  'too-many-attempts',
  'unavailable',
  'not-supported',
];

const errorId = reason =>
  `CheckoutPage.promo.error.${KNOWN_REASONS.includes(reason) ? reason : 'unavailable'}`;

/**
 * "Have a code?" at checkout: a link that opens a field, an Apply button, and once a code is on, the
 * summary's "Promo discount (CODE)" line with its amount and a Remove button. It sits in the
 * checkout summary (the maroon card, docs/design/checkout/), so its text is cream and the field
 * stays cream. The price itself is shown by the summary, which the page asks the server to
 * recalculate; this component only collects, checks and removes the code.
 *
 * The server judges every code (server/api/promo/); the answer arrives as a reason, never a price.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.appliedCode] the code that is on, if any
 * @param {number} [props.appliedPercent] its percentage (kept for the wording; the summary shows the amount)
 * @param {string} [props.discountText] the discount as money, "−$16.50", for the applied line
 * @param {Function} props.onApply (code) => Promise<{reason?: string}>; a reason means refused
 * @param {Function} [props.onRemove] () => void; left out once the booking is started, when the price is fixed and the line is only shown
 * @param {string} [props.refusedReason] the server refused the applied code while pricing or
 *   booking (it expired in the meantime, say); shown with a way to carry on without it
 * @returns {JSX.Element}
 */
const PromoCodeSection = props => {
  const { appliedCode, appliedPercent, discountText, onApply, onRemove, refusedReason } = props;
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(null);

  const apply = async event => {
    if (event) event.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setReason(null);
    const result = await onApply(value);
    setBusy(false);
    if (result && result.reason) setReason(result.reason);
  };

  if (refusedReason) {
    return (
      <div className={css.root} data-testid="promoRefused">
        <ErrorNote className={css.error}>
          <FormattedMessage id={errorId(refusedReason)} />
        </ErrorNote>
        <button type="button" className={css.linkButton} onClick={onRemove}>
          <FormattedMessage id="CheckoutPage.promo.continueWithoutCode" />
        </button>
      </div>
    );
  }

  if (appliedCode) {
    return (
      <div className={classNames(css.root, css.appliedRow)} data-testid="promoApplied">
        <span>
          <FormattedMessage
            id="CheckoutPage.promo.applied"
            values={{ code: appliedCode, percent: appliedPercent }}
          />
          {onRemove ? (
            <>
              {' · '}
              <button type="button" className={css.removeButton} onClick={onRemove}>
                <FormattedMessage id="CheckoutPage.promo.remove" />
              </button>
            </>
          ) : null}
        </span>
        {discountText ? (
          <b className={css.discount} data-testid="promoDiscount">
            {discountText}
          </b>
        ) : null}
      </div>
    );
  }

  if (!open) {
    return (
      <div className={css.root}>
        <button type="button" className={css.linkButton} onClick={() => setOpen(true)}>
          <FormattedMessage id="CheckoutPage.promo.haveCode" />
        </button>
      </div>
    );
  }

  return (
    <form className={css.root} onSubmit={apply} noValidate>
      <label className={css.label} htmlFor="promoCode">
        <FormattedMessage id="CheckoutPage.promo.inputLabel" />
      </label>
      <div className={css.inputRow}>
        <input
          id="promoCode"
          className={classNames(css.input, { [css.inputError]: !!reason })}
          type="text"
          value={value}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={intl.formatMessage({ id: 'CheckoutPage.promo.inputPlaceholder' })}
          onChange={e => setValue(e.target.value)}
          aria-invalid={reason ? 'true' : 'false'}
          aria-describedby={reason ? 'promoCodeError' : undefined}
        />
        <button type="submit" className={css.applyButton} disabled={!value.trim() || busy}>
          <FormattedMessage
            id={busy ? 'CheckoutPage.promo.checking' : 'CheckoutPage.promo.apply'}
          />
        </button>
      </div>
      {reason ? (
        <ErrorNote id="promoCodeError" className={css.error}>
          <FormattedMessage id={errorId(reason)} />
        </ErrorNote>
      ) : null}
    </form>
  );
};

export default PromoCodeSection;
