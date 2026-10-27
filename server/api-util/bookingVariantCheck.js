/**
 * Server-side check that a fixed-length booking names a real price variant AND is the length that
 * variant is sold at.
 *
 * Without it, lineItems.js quietly charges the listing's base price - which is the *lowest* variant
 * - when priceVariantName is missing or does not match, and nothing compares the booking's length to
 * the variant's. So a 120-minute session could be bought at the 30-minute price just by leaving the
 * name out or sending a 30-minute variant name with a 120-minute slot. The browser is not a
 * safeguard: the request that creates the transaction can be sent by anyone.
 *
 * Applies only where it is meaningful: fixed unit type, with price variations switched on and at
 * least one variant defined.
 */

/** The template's own default when a variant carries no length (see BookingPriceVariants.js). */
const DEFAULT_BOOKING_LENGTH_MINUTES = 60;

const toMs = value => (value ? new Date(value).getTime() : NaN);

/**
 * @param {object} listing a Sharetribe listing resource
 * @param {object} orderData needs priceVariantName, bookingStart and bookingEnd
 * @returns {string|null} a reason the booking must be refused, or null if it is fine
 */
const getBookingVariantProblem = (listing, orderData) => {
  const publicData = listing?.attributes?.publicData || {};
  const { unitType, priceVariationsEnabled, priceVariants } = publicData;

  const applies =
    unitType === 'fixed' &&
    priceVariationsEnabled &&
    Array.isArray(priceVariants) &&
    priceVariants.length > 0;
  if (!applies) return null;

  const { priceVariantName, bookingStart, bookingEnd } = orderData || {};

  if (!priceVariantName) {
    return 'A price variant is required for this listing.';
  }

  const variant = priceVariants.find(v => v.name === priceVariantName);
  if (!variant) {
    return `Unknown price variant "${priceVariantName}" for this listing.`;
  }

  const startMs = toMs(bookingStart);
  const endMs = toMs(bookingEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 'The booking needs a valid start and end time.';
  }

  const expected = Number.isFinite(variant.bookingLengthInMinutes)
    ? variant.bookingLengthInMinutes
    : DEFAULT_BOOKING_LENGTH_MINUTES;
  const actual = Math.round((endMs - startMs) / 60000);
  if (actual !== expected) {
    return `The booking is ${actual} minutes but "${priceVariantName}" is a ${expected}-minute session.`;
  }

  return null;
};

/** Throws the same 400 shape lineItems.js already uses, so every endpoint reports it cleanly. */
const assertValidBookingVariant = (listing, orderData) => {
  const problem = getBookingVariantProblem(listing, orderData);
  if (problem) {
    const error = new Error(problem);
    error.status = 400;
    error.statusText = problem;
    error.data = {};
    throw error;
  }
};

module.exports = { getBookingVariantProblem, assertValidBookingVariant };
