/**
 * Which Nylas Scheduler configuration serves which session length, for one listing.
 *
 * Why this is a map and not one id: Nylas fixes a session's length on the configuration, and a
 * private configuration's availability endpoint rejects a duration parameter. So a listing that
 * sells a 45- and a 90-minute session needs one configuration per length, stored as
 * `publicData.nylasConfigurationIds` keyed by minutes: `{ "60": "...", "90": "..." }`.
 *
 * The older single `publicData.nylasConfigurationId` (always a 60-minute configuration) is still
 * honoured as the "60" entry, so listings enabled before session lengths existed keep working with
 * no migration. Every place that needs a configuration goes through `configurationIdFor`, so this
 * is the only file that knows both shapes exist.
 *
 * Pure: takes a listing's publicData, touches nothing.
 */

/** The length a listing sells when it has no price variants, and the template's own default for a
 * variant that carries no length (see bookingVariantCheck.js). */
const DEFAULT_LENGTH_MINUTES = 60;

const variantsOf = publicData => {
  const { unitType, priceVariationsEnabled, priceVariants } = publicData || {};
  const applies =
    unitType === 'fixed' &&
    priceVariationsEnabled &&
    Array.isArray(priceVariants) &&
    priceVariants.length > 0;
  return applies ? priceVariants : [];
};

const lengthOfVariant = variant =>
  Number.isFinite(variant?.bookingLengthInMinutes)
    ? variant.bookingLengthInMinutes
    : DEFAULT_LENGTH_MINUTES;

/** The session length (minutes) a named price variant is sold at, or null if there is no such one. */
const lengthForVariant = (publicData, variantName) => {
  const variant = variantsOf(publicData).find(v => v.name === variantName);
  return variant ? lengthOfVariant(variant) : null;
};

/** Every distinct length the listing sells, ascending. A listing with no variants sells one. */
const offeredLengths = publicData => {
  const variants = variantsOf(publicData);
  const lengths = variants.length > 0 ? variants.map(lengthOfVariant) : [DEFAULT_LENGTH_MINUTES];
  return Array.from(new Set(lengths)).sort((a, b) => a - b);
};

/** The length shown first: the first variant's, which is the one the booking form preselects. */
const defaultLength = publicData => {
  const first = variantsOf(publicData)[0];
  return first ? lengthOfVariant(first) : DEFAULT_LENGTH_MINUTES;
};

/** The listing's configurations as `{ "<minutes>": id }`, folding in the legacy single id. */
const configurationIdsOf = publicData => {
  const { nylasConfigurationIds, nylasConfigurationId } = publicData || {};
  const map = {};
  if (nylasConfigurationId) map[String(DEFAULT_LENGTH_MINUTES)] = nylasConfigurationId;
  if (nylasConfigurationIds && typeof nylasConfigurationIds === 'object') {
    Object.entries(nylasConfigurationIds).forEach(([minutes, id]) => {
      if (id) map[String(minutes)] = id;
    });
  }
  return map;
};

/** The configuration that serves `lengthMinutes`, or null when the listing has none for it. */
const configurationIdFor = (publicData, lengthMinutes) =>
  configurationIdsOf(publicData)[String(lengthMinutes)] || null;

module.exports = {
  DEFAULT_LENGTH_MINUTES,
  lengthForVariant,
  offeredLengths,
  defaultLength,
  configurationIdsOf,
  configurationIdFor,
};
