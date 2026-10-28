/**
 * Shared setup for the endpoints that manage a Nylas booking tied to a Sharetribe transaction:
 * create, cancel, reschedule. Factored out so the same checks (who is this, is this listing even
 * calendar-booking-enabled) cannot quietly drift apart between the three.
 */

const { configurationIdFor } = require('./bookingConfig');

/** Sharetribe's own pattern for reading a relationship out of an `include`d response (see
 * server/api/transition-privileged.js's getListingRelationShip) - relationships only carry a
 * {id, type} reference, and the real resource lives alongside it in `included`. */
const findIncluded = (included, ref) =>
  ref ? (included || []).find(i => i.id.uuid === ref.id.uuid && i.type === ref.type) : null;

/**
 * Where, and for how long, a transaction's calendar booking should be made. The ONE place that
 * decides which Nylas configuration a booking belongs to: create, cancel, reschedule and the
 * payment-failure recovery all go through it, so nothing else reads
 * publicData.nylasConfigurationId directly.
 *
 * A listing has one configuration per session length (see bookingConfig.js), so the booking's own
 * length picks the configuration. A length with no configuration resolves to null, which callers
 * treat as "this listing is not set up for that session" rather than guessing another length's.
 *
 * Pure: takes already-loaded resources, so it works with a Marketplace SDK response (a customer's
 * own session) and an Integration SDK response (the sweeper, which has no user) alike.
 *
 * @param {{tx: object, listing: object, booking: object}} resources
 * @returns {{configurationId: string|null, start: string|null, end: string|null,
 *            lengthMinutes: number|null, variantName: string|null}}
 */
const resolveBookingTarget = ({ tx, listing, booking }) => {
  const publicData = listing?.attributes?.publicData || {};
  const start = booking?.attributes?.start || null;
  const end = booking?.attributes?.end || null;
  const lengthMinutes =
    start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000) : null;

  return {
    configurationId: publicData.calendarBookingEnabled
      ? configurationIdFor(publicData, lengthMinutes)
      : null,
    start,
    end,
    lengthMinutes,
    variantName: tx?.attributes?.protectedData?.priceVariantName || null,
  };
};

/**
 * Fetch a transaction together with its listing and booking, and resolve the listing's Nylas
 * configuration id if it has one.
 *
 * sdk.transactions.show already refuses (403) a transaction the caller is not a party to, so
 * calling this at all proves they are the customer or provider on it. OrderPanel already refuses
 * to let a provider book their own listing, so in practice this is always the customer.
 *
 * @param {object} sdk a request-scoped Marketplace SDK instance (from getSdk)
 * @param {string} transactionId
 */
const loadCalendarBookingTransaction = async (sdk, transactionId) => {
  const response = await sdk.transactions.show({
    id: transactionId,
    include: ['listing', 'booking'],
  });
  const tx = response.data.data;
  const included = response.data.included;
  const listing = findIncluded(included, tx.relationships?.listing?.data);
  const booking = findIncluded(included, tx.relationships?.booking?.data);

  const { configurationId, lengthMinutes } = resolveBookingTarget({ tx, listing, booking });

  return { tx, listing, booking, configurationId, lengthMinutes };
};

module.exports = { findIncluded, resolveBookingTarget, loadCalendarBookingTransaction };
