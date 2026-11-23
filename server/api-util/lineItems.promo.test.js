const { types } = require('sharetribe-flex-sdk');
const { Money } = types;
const { transactionLineItems } = require('./lineItems');
const {
  constructValidLineItems,
  calculateTotalForCustomer,
  calculateTotalForProvider,
} = require('./lineItemHelpers');

const session = (priceInSubunits = 10000, currency = 'GBP') => ({
  attributes: {
    price: new Money(priceInSubunits, currency),
    publicData: { unitType: 'fixed', priceVariationsEnabled: false },
  },
});
const orderData = { currency: 'GBP' };
const commission = { percentage: 20 };
const build = (listing, promo, providerCommission = commission) =>
  constructValidLineItems(
    transactionLineItems(listing, orderData, providerCommission, undefined, promo)
  );
const byCode = (items, code) => items.find(i => i.code === code);

describe('a £100 session with 15% off (the case from the plan)', () => {
  const items = build(session(), { code: 'NEWYEAR15', percentOff: 15 });

  it('has the session, a customer-only discount and the unchanged provider commission', () => {
    expect(byCode(items, 'line-item/fixed').lineTotal.amount).toBe(10000);
    const discount = byCode(items, 'line-item/promo-discount');
    expect(discount.lineTotal.amount).toBe(-1500);
    expect(discount.includeFor).toEqual(['customer']);
    const commissionItem = byCode(items, 'line-item/provider-commission');
    expect(commissionItem.lineTotal.amount).toBe(-2000);
    expect(commissionItem.includeFor).toEqual(['provider']);
  });

  it('the client pays £85, the coach is paid £80, Revie keeps £5', () => {
    const payin = calculateTotalForCustomer(items).amount;
    const payout = calculateTotalForProvider(items).amount;
    expect(payin).toBe(8500);
    expect(payout).toBe(8000);
    expect(payin - payout).toBe(500);
  });

  it('is in the sums as Sharetribe will compute them: only the customer sees the discount', () => {
    const customerLines = items.filter(i => i.includeFor.includes('customer')).map(i => i.code);
    const providerLines = items.filter(i => i.includeFor.includes('provider')).map(i => i.code);
    expect(customerLines).toContain('line-item/promo-discount');
    expect(providerLines).not.toContain('line-item/promo-discount');
  });
});

describe('the coach is always paid on the full price', () => {
  it.each([0, 5, 10, 15])(
    'whatever the discount (%s%%), the payout is 80%% of the full price',
    percentOff => {
      const items = build(session(12345), percentOff ? { code: 'X', percentOff } : undefined);
      expect(calculateTotalForProvider(items).amount).toBe(12345 - Math.round(12345 * 0.2));
    }
  );

  it('is the same payout with or without a code', () => {
    const without = calculateTotalForProvider(build(session(), undefined)).amount;
    const withCode = calculateTotalForProvider(build(session(), { code: 'X', percentOff: 15 }))
      .amount;
    expect(withCode).toBe(without);
  });
});

describe('without a code nothing changes', () => {
  it('has no discount line and the usual totals', () => {
    const items = build(session(), undefined);
    expect(byCode(items, 'line-item/promo-discount')).toBeUndefined();
    expect(calculateTotalForCustomer(items).amount).toBe(10000);
    expect(calculateTotalForProvider(items).amount).toBe(8000);
  });
});

describe('what it refuses', () => {
  const refused = fn => {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return null;
  };

  it('more than the 15% ceiling, even though the commission is 20%', () => {
    const e = refused(() => build(session(), { code: 'X', percentOff: 16 }));
    expect(e.statusText).toBe('promo-invalid');
    expect(e.status).toBe(400);
  });

  it('more than the commission when the commission is below the ceiling', () => {
    expect(
      refused(() => build(session(), { code: 'X', percentOff: 12 }, { percentage: 10 }))
    ).not.toBe(null);
    expect(refused(() => build(session(), { code: 'X', percentOff: 10 }, { percentage: 10 }))).toBe(
      null
    );
  });

  it('zero or negative percentages', () => {
    expect(refused(() => build(session(), { code: 'X', percentOff: 0 }))).not.toBe(null);
    expect(refused(() => build(session(), { code: 'X', percentOff: -5 }))).not.toBe(null);
  });

  it('a discount larger than a minimum-amount commission', () => {
    // A £30 minimum commission on a £100 session: a 15% (£15) discount fits; on a £20 commission it would not.
    expect(
      refused(() => build(session(), { code: 'X', percentOff: 15 }, { minimum_amount: 3000 }))
    ).toBe(null);
    expect(
      refused(() => build(session(), { code: 'X', percentOff: 15 }, { minimum_amount: 1000 }))
    ).not.toBe(null);
  });
});

describe('rounding never lets payin fall below payout', () => {
  it.each([1, 3, 99, 101, 333, 3333, 9999, 12345, 100001])(
    'price %s subunits at 15%% and 20%% commission',
    price => {
      const items = build(session(price), { code: 'X', percentOff: 15 });
      const payin = calculateTotalForCustomer(items).amount;
      const payout = calculateTotalForProvider(items).amount;
      expect(payin).toBeGreaterThanOrEqual(payout);
      expect(payout).toBeGreaterThanOrEqual(0);
    }
  );
});
