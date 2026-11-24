import React from 'react';
import classNames from 'classnames';
import { useField } from 'react-final-form';

import { useIntl } from '../../../util/reactIntl';
import { convertMoneyToNumber } from '../../../util/currency';
import { types as sdkTypes } from '../../../util/sdkLoader';

import { StepTitle } from '../BookingPanelParts';

import css from './PriceVariantRadios.module.css';

const { Money } = sdkTypes;

/**
 * A price as the booking panel writes it: whole amounts without decimals ("$110"), others with two
 * ("$110.50"). Null when there is no amount or currency to show.
 */
export const formatPanelPrice = (intl, amountInSubunits, currency) => {
  if (typeof amountInSubunits !== 'number' || !currency) {
    return null;
  }
  try {
    const value = convertMoneyToNumber(new Money(amountInSubunits, currency));
    const whole = Number.isInteger(value);
    return intl.formatNumber(value, {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    });
  } catch (e) {
    return null;
  }
};

/**
 * "Choose your session": one full-width radio row per price variant, its name and its price. The
 * chosen variant's name is the form's `priceVariantName`, as the select it replaces set it; the form
 * watches that value to fetch that length's times.
 */
const PriceVariantRadios = ({ priceVariants, currency, stepNumber }) => {
  const intl = useIntl();
  const { input } = useField('priceVariantName');

  return (
    <div className={css.root}>
      <StepTitle number={stepNumber} id="booking-session-title">
        {intl.formatMessage({ id: 'BookingPanel.chooseSession' })}
      </StepTitle>
      <div role="radiogroup" aria-labelledby="booking-session-title" className={css.rows}>
        {priceVariants.map(variant => {
          const checked = input.value === variant.name;
          const price = formatPanelPrice(intl, variant.priceInSubunits, currency);
          return (
            <button
              key={variant.name}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => input.onChange(variant.name)}
              className={classNames(css.row, { [css.rowChecked]: checked })}
            >
              <span className={css.dot} />
              <span className={css.name}>{variant.name}</span>
              {price ? <span className={css.price}>{price}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PriceVariantRadios;
