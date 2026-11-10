/**
 * Make one session listing bookable through its coach's calendar, and keep it that way.
 *
 * This is the logic enableListing.js used to run once, on request, made safe to run again and again.
 * It is called by the reconcile loop (every minute, for every coach), by the "sync me" route (the
 * Calendar page, after saving hours), by the Nylas callback (after a coach connects) and by
 * enableListing.js (an explicit enable). All four give the same result for the same inputs.
 *
 * What "bookable" means, all written onto the listing in one update:
 *  - one Nylas configuration per session length (price variant) the listing sells;
 *  - the calendar they are booked on, the working hours, the notice period;
 *  - the transaction process alias (BOOKING_PROCESS_ALIAS) a new listing needs, because Console
 *    cannot pin a listing type to a process version;
 *  - a Sharetribe availability plan carrying the hours' timezone (without it no booking form renders).
 *
 * Idempotent by signature. Everything the result depends on (grant, lengths, title, hours, notice,
 * alias, the coach's name) is hashed into `publicData.nylasSyncSignature`; if the listing already
 * carries the hash of the current inputs, nothing is called at all - not Nylas, not Sharetribe - so
 * the loop can visit every listing every minute for free. A listing enabled before signatures
 * existed whose stored state already matches is "adopted": the signature is stamped and nothing
 * else changes, so deploying this never alters a listing that is working.
 *
 * Never touches a coach with no connected calendar, and never invents a transaction process for a
 * listing that already has one working.
 */

const crypto = require('crypto');

const {
  listCalendars,
  defaultCalendarFor,
  getEventType,
  SCHEDULING_DEFAULTS,
} = require('./scheduler');
const {
  resolveBookingProcessAlias,
  grantProvider,
  syncListingConfigurations,
} = require('./listingSync');
const { offeredLengths, configurationIdsOf } = require('./bookingConfig');
const { permissiveAvailabilityPlan } = require('./availabilityPlan');
const { resolveHours, normalizeBookingHours, sameSchedule } = require('./hours');

// Bump to make every listing re-sync once, e.g. after changing what a configuration contains.
const SYNC_VERSION = 1;

const signatureOf = inputs =>
  crypto
    .createHash('sha1')
    .update(JSON.stringify(inputs))
    .digest('hex')
    .slice(0, 16);

/**
 * @param {object} params
 * @param {object} params.listing a Sharetribe listing resource (from either API)
 * @param {object} params.profile the coach's profile: `displayName` and `privateData`
 * @param {Function} params.updateListing `({id, publicData, availabilityPlan}) => Promise`, bound to
 *   whichever SDK the caller has (the coach's own, or the Integration API)
 * @param {string} params.siteUrl public site URL for the links in calendar invites
 * @param {object} [params.env]
 * @param {object} [params.overrides] `eventTypeKey`, `calendarId`, `minBookingNoticeMinutes`,
 *   `useEnvAlias`: what an explicit enable may choose that the loop never does
 * @param {boolean} [params.force] skip the signature check and always sync
 * @returns {Promise<{status: string}>} one of: ineligible, no-grant, no-process-alias, no-calendar,
 *   unchanged, adopted, synced
 */
const ensureListingBookable = async ({
  listing,
  profile,
  updateListing,
  siteUrl,
  env = process.env,
  overrides = {},
  force = false,
}) => {
  const publicData = listing.attributes.publicData || {};
  const privateData = (profile && profile.privateData) || {};

  const eventTypeKey =
    overrides.eventTypeKey || publicData.nylasEventTypeKey || publicData.listingType;
  if (!getEventType(eventTypeKey)) return { status: 'ineligible' };

  const grantId = privateData.nylasGrantId;
  if (!grantId) return { status: 'no-grant' };

  const enabled = !!publicData.calendarBookingEnabled;

  // An already-enabled listing keeps the process it is on. A new one gets the configured alias, and
  // is refused rather than defaulted if there is none: falling back to release-1 would put the
  // coach's Accept button back on a booking the calendar has already confirmed.
  let alias;
  if (enabled && publicData.transactionProcessAlias && !overrides.useEnvAlias) {
    alias = publicData.transactionProcessAlias;
  } else {
    const resolved = resolveBookingProcessAlias(env);
    if (resolved.error) return { status: 'no-process-alias', error: resolved.error };
    alias = resolved.alias;
  }

  const notice = Number.isFinite(Number(overrides.minBookingNoticeMinutes))
    ? Number(overrides.minBookingNoticeMinutes)
    : Number.isFinite(Number(publicData.nylasMinBookingNoticeMinutes))
    ? Number(publicData.nylasMinBookingNoticeMinutes)
    : SCHEDULING_DEFAULTS.minBookingNoticeMinutes;

  const existingTimeZone = listing.attributes.availabilityPlan?.timezone;
  const hours = resolveHours({
    bookingHours: privateData.bookingHours,
    existingOpenHours: publicData.nylasOpenHours,
    existingTimeZone,
  });
  const openHours = { days: hours.days, start: hours.start, end: hours.end };
  const lengths = offeredLengths(publicData);

  const signature = signatureOf({
    v: SYNC_VERSION,
    grantId,
    eventTypeKey,
    lengths,
    title: listing.attributes.title,
    coachName: (profile && profile.displayName) || null,
    notice,
    alias,
    hours: openHours,
    // Only the coach's own choice of zone. The zone a sync falls back to is written onto the listing's
    // availability plan, and reading that back into the signature would make every sync change it.
    timeZone: (normalizeBookingHours(privateData.bookingHours) || {}).timeZone || null,
    calendarId: overrides.calendarId || null,
  });

  if (!force && enabled && publicData.nylasSyncSignature === signature) {
    return { status: 'unchanged' };
  }

  // Enabled before signatures existed, and what is stored already is what a sync would write:
  // record the signature and change nothing else.
  const ids = configurationIdsOf(publicData);
  const alreadyComplete =
    enabled &&
    !publicData.nylasSyncSignature &&
    !overrides.calendarId &&
    publicData.nylasCalendarId &&
    existingTimeZone &&
    lengths.every(length => ids[String(length)]) &&
    sameSchedule(publicData.nylasOpenHours, openHours) &&
    publicData.transactionProcessAlias === alias;
  if (!force && alreadyComplete) {
    await updateListing({
      id: listing.id,
      publicData: { nylasSyncSignature: signature },
    });
    return { status: 'adopted' };
  }

  const calendars = await listCalendars(grantId);
  const wanted = overrides.calendarId || publicData.nylasCalendarId;
  const chosen =
    (wanted && calendars.find(c => c.id === wanted && !c.read_only)) ||
    (overrides.calendarId ? null : defaultCalendarFor(calendars));
  if (!chosen) return { status: 'no-calendar', explicit: !!overrides.calendarId };

  const timeZone = hours.timeZone || chosen.timezone;

  const { publicData: synced, configurationIds } = await syncListingConfigurations({
    listing,
    grantId,
    provider: await grantProvider(grantId),
    coachName: profile && profile.displayName,
    coachEmail: privateData.nylasGrantEmail || chosen.id,
    calendarId: chosen.id,
    eventTypeKey,
    minBookingNoticeMinutes: notice,
    siteUrl,
    processAlias: alias,
  });

  const updated = await updateListing({
    id: listing.id,
    publicData: { ...synced, nylasOpenHours: openHours, nylasSyncSignature: signature },
    availabilityPlan: permissiveAvailabilityPlan(timeZone),
  });

  return {
    status: 'synced',
    configurationIds,
    calendarId: chosen.id,
    timeZone,
    minBookingNoticeMinutes: notice,
    updated,
  };
};

module.exports = { ensureListingBookable, signatureOf, SYNC_VERSION };
