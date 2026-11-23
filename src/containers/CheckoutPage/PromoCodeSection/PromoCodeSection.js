import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { InlineTextButton, PrimaryButton } from '../../../components';

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
 * "Have a code?" at checkout: a link that opens a field, an Apply button, and once a code is on, a
 * line saying so with a Remove button. The price itself is shown by the order breakdown, which the
 * page asks the server to recalculate; this component only collects, checks and removes the code.
 *
 * The server judges every code (server/api/promo/); the answer arrives as a reason, never a price.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.appliedCode] the code that is on, if any
 * @param {number} [props.appliedPercent] its percentage, for the sentence ("15% off")
 * @param {Function} props.onApply (code) => Promise<{reason?: string}>; a reason means refused
 * @param {Function} props.onRemove () => void
 * @param {string} [props.refusedReason] the server refused the applied code while pricing or
 *   booking (it expired in the meantime, say); shown with a way to carry on without it
 * @returns {JSX.Element}
 */
const PromoCodeSection = props => {
  const { appliedCode, appliedPercent, onApply, onRemove, refusedReason } = props;
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
        <p className={css.error} role="alert">
          <FormattedMessage id={errorId(refusedReason)} />
        </p>
        <InlineTextButton type="button" className={css.linkButton} onClick={onRemove}>
          <FormattedMessage id="CheckoutPage.promo.continueWithoutCode" />
        </InlineTextButton>
      </div>
    );
  }

  if (appliedCode) {
    return (
      <div className={classNames(css.root, css.appliedRow)} data-testid="promoApplied">
        <span className={css.appliedText}>
          <FormattedMessage
            id="CheckoutPage.promo.applied"
            values={{ code: appliedCode, percent: appliedPercent }}
          />
        </span>
        <InlineTextButton type="button" className={css.linkButton} onClick={onRemove}>
          <FormattedMessage id="CheckoutPage.promo.remove" />
        </InlineTextButton>
      </div>
    );
  }

  if (!open) {
    return (
      <div className={css.root}>
        <InlineTextButton type="button" className={css.linkButton} onClick={() => setOpen(true)}>
          <FormattedMessage id="CheckoutPage.promo.haveCode" />
        </InlineTextButton>
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
          className={css.input}
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
        <PrimaryButton
          type="submit"
          className={css.applyButton}
          disabled={!value.trim() || busy}
          inProgress={busy}
        >
          <FormattedMessage id="CheckoutPage.promo.apply" />
        </PrimaryButton>
      </div>
      {reason ? (
        <p id="promoCodeError" className={css.error} role="alert">
          <FormattedMessage id={errorId(reason)} />
        </p>
      ) : null}
    </form>
  );
};

export default PromoCodeSection;
