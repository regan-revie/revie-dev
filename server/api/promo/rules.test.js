const {
  MAX_PERCENT_OFF,
  normaliseCode,
  isWellFormedCode,
  isAllowedPercent,
  judgeCode,
  promoError,
} = require('./rules');

const NOW = Date.parse('2026-12-01T12:00:00Z');
const noUses = { total: 0, customerPaid: 0, customerReserved: 0, customerFirstSession: 0 };
const promo = (extra = {}) => ({
  code: 'NEWYEAR15',
  percent_off: '15.00',
  expires_at: null,
  max_total_uses: null,
  max_uses_per_customer: 1,
  first_session_only: false,
  active: true,
  ...extra,
});
const judge = (p, counts = noUses, extra = {}) =>
  judgeCode({
    promo: p,
    now: NOW,
    counts,
    hasEarlierPaidBooking: false,
    commissionPercent: 20,
    ...extra,
  });

describe('the ceiling', () => {
  it('is 15', () => expect(MAX_PERCENT_OFF).toBe(15));

  it('allows up to 15% and refuses above it, whatever the commission', () => {
    expect(isAllowedPercent(15, 20)).toBe(true);
    expect(isAllowedPercent(15.01, 20)).toBe(false);
    expect(isAllowedPercent(20, 20)).toBe(false);
  });

  it('never allows more than the commission, even under the ceiling', () => {
    expect(isAllowedPercent(10, 10)).toBe(true);
    expect(isAllowedPercent(10.5, 10)).toBe(false);
    expect(isAllowedPercent(15, 12)).toBe(false);
  });

  it('refuses zero, negative and nonsense', () => {
    [0, -5, NaN, Infinity, undefined].forEach(p => expect(isAllowedPercent(p, 20)).toBe(false));
  });

  it('treats a stored code above the ceiling as not existing', () => {
    expect(judge(promo({ percent_off: '20.00' }))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('typed codes', () => {
  it('ignores case and spaces', () => {
    expect(normaliseCode('  newyear 15 ')).toBe('NEWYEAR15');
    expect(normaliseCode('')).toBe('');
    expect(normaliseCode(null)).toBe('');
    expect(normaliseCode(['A', 'B'])).toBe('');
  });

  it('accepts only letters, digits, dash and underscore, 3 to 32 long', () => {
    expect(isWellFormedCode('NEWYEAR15')).toBe(true);
    expect(isWellFormedCode('A-B_9')).toBe(true);
    ['AB', 'A'.repeat(33), 'NEW YEAR', "X'; DROP", 'ÅÄÖ1'].forEach(c =>
      expect(isWellFormedCode(c)).toBe(false)
    );
  });
});

describe('judging a code', () => {
  it('accepts a good code and returns its percentage as a number', () => {
    expect(judge(promo())).toEqual({ ok: true, percentOff: 15 });
  });

  it('refuses a missing or switched-off code the same way', () => {
    expect(judge(null)).toEqual({ ok: false, reason: 'invalid' });
    expect(judge(promo({ active: false }))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('expires at the exact expiry moment', () => {
    const at = new Date(NOW).toISOString();
    expect(judge(promo({ expires_at: at })).reason).toBe('expired');
    expect(judge(promo({ expires_at: new Date(NOW + 1).toISOString() })).ok).toBe(true);
    expect(judge(promo({ expires_at: new Date(NOW - 1).toISOString() })).reason).toBe('expired');
  });

  it('stops at the total cap, counting reserved uses too', () => {
    const capped = promo({ max_total_uses: 50 });
    expect(judge(capped, { ...noUses, total: 49 }).ok).toBe(true);
    expect(judge(capped, { ...noUses, total: 50 }).reason).toBe('used-up');
    expect(judge(promo(), { ...noUses, total: 100000 }).ok).toBe(true); // no cap
  });

  it('allows each client as many uses as the code says, default one', () => {
    expect(judge(promo(), { ...noUses, customerPaid: 1 }).reason).toBe('already-used');
    expect(judge(promo({ max_uses_per_customer: 2 }), { ...noUses, customerPaid: 1 }).ok).toBe(
      true
    );
    expect(judge(promo({ max_uses_per_customer: 2 }), { ...noUses, customerPaid: 2 }).reason).toBe(
      'already-used'
    );
  });

  it('says "in progress", not "already used", when only an unfinished booking is in the way', () => {
    expect(judge(promo(), { ...noUses, customerReserved: 1 }).reason).toBe('in-progress');
  });

  it('first-session-only needs no earlier paid booking and no other live first-session use', () => {
    const first = promo({ first_session_only: true });
    expect(judge(first).ok).toBe(true);
    expect(judge(first, noUses, { hasEarlierPaidBooking: true }).reason).toBe('first-session-only');
    expect(judge(first, { ...noUses, customerFirstSession: 1 }).reason).toBe('first-session-only');
    // A code that is not first-session-only does not care.
    expect(judge(promo(), noUses, { hasEarlierPaidBooking: true }).ok).toBe(true);
  });
});

describe('the error a refusal becomes', () => {
  it('carries promo-<reason> in the shape handleError sends to the browser', () => {
    const e = promoError('expired');
    expect(e.status).toBe(400);
    expect(e.statusText).toBe('promo-expired');
    expect(e.data.errors[0].code).toBe('promo-expired');
    expect(promoError('too-many-attempts', 429).status).toBe(429);
  });
});
