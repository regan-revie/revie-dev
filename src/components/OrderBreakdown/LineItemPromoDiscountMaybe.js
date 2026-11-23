import React from 'react';

import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { LINE_ITEM_PROMO_DISCOUNT, propTypes } from '../../util/types';

import css from './OrderBreakdown.module.css';

/**
 * Revie: the promo code's discount as its own line, e.g. "Promo discount (NEWYEAR15)  -$15.00".
 *
 * It is a negative line item for the customer only, so the coach never sees it: their breakdown
 * shows the full price and their usual commission. The code's name is read from the transaction's
 * metadata when it is there (the booking was started with it); the line still shows without it.
 *
 * @component
 * @param {Object} props
 * @param {Array<propTypes.lineItem>} props.lineItems - The line items to render
 * @param {Object} [props.metadata] - The transaction's metadata, which may name the promo code
 * @param {intlShape} props.intl - The intl object
 * @returns {JSX.Element}
 */
const LineItemPromoDiscountMaybe = props => {
  const { lineItems, metadata, intl } = props;

  const items = lineItems.filter(item => item.code === LINE_ITEM_PROMO_DISCOUNT && !item.reversal);
  const code = metadata?.promo?.code;

  return items.length > 0 ? (
    <>
      {items.map((item, i) => (
        <div key={`${i}-promo-discount`} className={css.lineItem}>
          <span className={css.itemLabel}>
            {code ? (
              <FormattedMessage id="OrderBreakdown.promoDiscountWithCode" values={{ code }} />
            ) : (
              <FormattedMessage id="OrderBreakdown.promoDiscount" />
            )}
          </span>
          <span className={css.itemValue}>{formatMoney(intl, item.lineTotal)}</span>
        </div>
      ))}
    </>
  ) : null;
};

export default LineItemPromoDiscountMaybe;
