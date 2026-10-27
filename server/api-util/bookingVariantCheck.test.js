const sharetribeSdk = require('sharetribe-flex-sdk');
const { getBookingVariantProblem, assertValidBookingVariant } = require('./bookingVariantCheck');
const { transactionLineItems } = require('./lineItems');

const { Money } = sharetribeSdk.types;

const listing = (publicData = {}) => ({
  attributes: {
    price: new Money(3000, 'USD'), // the base price is the LOWEST variant, as the pricing panel sets it
    publicData: {
      unitType: 'fixed',
      priceVariationsEnabled: true,
      priceVariants: [
        { name: '30 min', priceInSubunits: 3000, bookingLengthInMinutes: 30 },
        { name: '60 min', priceInSubunits: 6000, bookingLengthInMinutes: 60 },
        { name: '120 min', priceInSubunits: 12000, bookingLengthInMinutes: 120 },
      ],
      ...publicData,
    },
  },
});

const at = (minutesFromStart = 0) => new Date(Date.UTC(2026, 10, 10, 10, minutesFromStart));
const order = (name, lengthMinutes) => ({
  priceVariantName: name,
  bookingStart: at(0),
  bookingEnd: at(lengthMinutes),
});

describe('getBookingVariantProblem()', () => {
  it('accepts a variant whose length matches the booking', () => {
    expect(getBookingVariantProblem(listing(), order('60 min', 60))).toBeNull();
    expect(getBookingVariantProblem(listing(), order('120 min', 120))).toBeNull();
  });

  it('accepts ISO strings as well as Dates', () => {
    const data = {
      priceVariantName: '30 min',
      bookingStart: at(0).toISOString(),
      bookingEnd: at(30).toISOString(),
    };
    expect(getBookingVariantProblem(listing(), data)).toBeNull();
  });

  it('refuses a missing price variant name (would silently charge the base price)', () => {
    const data = { bookingStart: at(0), bookingEnd: at(120) };
    expect(getBookingVariantProblem(listing(), data)).toMatch(/price variant is required/i);
  });

  it('refuses a name that matches no variant on the listing', () => {
    expect(getBookingVariantProblem(listing(), order('free session', 60))).toMatch(/unknown/i);
  });

  it("refuses a booking whose length is not the variant's (cheap name, long slot)", () => {
    expect(getBookingVariantProblem(listing(), order('30 min', 120))).toMatch(
      /120 minutes but "30 min" is a 30-minute/
    );
  });

  it('refuses a booking with no usable start and end', () => {
    expect(getBookingVariantProblem(listing(), { priceVariantName: '60 min' })).toMatch(
      /valid start and end/
    );
    expect(
      getBookingVariantProblem(listing(), {
        priceVariantName: '60 min',
        bookingStart: at(60),
        bookingEnd: at(0),
      })
    ).toMatch(/valid start and end/);
  });

  it('treats a variant with no stored length as the template default of 60 minutes', () => {
    const l = listing({ priceVariants: [{ name: 'legacy', priceInSubunits: 5000 }] });
    expect(getBookingVariantProblem(l, order('legacy', 60))).toBeNull();
    expect(getBookingVariantProblem(l, order('legacy', 90))).toMatch(/60-minute/);
  });

  it('does not apply to listings without price variations', () => {
    expect(getBookingVariantProblem(listing({ priceVariationsEnabled: false }), {})).toBeNull();
    expect(getBookingVariantProblem(listing({ priceVariants: [] }), {})).toBeNull();
    expect(getBookingVariantProblem(listing({ unitType: 'hour' }), {})).toBeNull();
  });
});

describe('assertValidBookingVariant()', () => {
  it('throws the 400 shape handleError turns into a clean response', () => {
    let error;
    try {
      assertValidBookingVariant(listing(), order('30 min', 120));
    } catch (e) {
      error = e;
    }
    expect(error.status).toBe(400);
    expect(error.statusText).toMatch(/120 minutes/);
    expect(error.data).toEqual({});
  });
});

describe('transactionLineItems() uses the check', () => {
  it('prices a valid booking at the chosen variant', () => {
    const items = transactionLineItems(listing(), order('120 min', 120), 20, 0);
    const base = items.find(i => i.code === 'line-item/fixed');
    expect(base.unitPrice.amount).toBe(12000);
  });

  it('no longer falls back to the base price when the name is missing', () => {
    expect(() =>
      transactionLineItems(listing(), { bookingStart: at(0), bookingEnd: at(120) }, 20, 0)
    ).toThrow(/price variant is required/i);
  });

  it('no longer lets a 120-minute slot be bought at the 30-minute price', () => {
    expect(() => transactionLineItems(listing(), order('30 min', 120), 20, 0)).toThrow(
      /30-minute session/
    );
  });
});
