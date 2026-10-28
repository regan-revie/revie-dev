/**
 * Turning a listing into a bookable calendar listing: the part of "enable booking" that does not
 * depend on who is asking. enableListing.js (a coach, through the Marketplace API) and
 * scripts/dev-resync-listing.js (an operator, through the Integration API) both call this, so the
 * two cannot drift apart.
 *
 * It does three things in one go, because a listing that has one without the others is broken:
 *  1. Syncs one Nylas configuration per session length the listing sells.
 *  2. Works out the publicData that records them, beside the process alias new transactions use.
 *  3. Does neither if the alias setting is missing.
 */

const { nylasRequest } = require('./client');
const { syncConfiguration, conferencingFor, SCHEDULING_DEFAULTS } = require('./scheduler');
const { offeredLengths, configurationIdsOf } = require('./bookingConfig');

const ALIAS_PATTERN = /^default-booking\/[a-z0-9][a-z0-9-]*$/;

/**
 * The transaction process alias calendar listings must use, from BOOKING_PROCESS_ALIAS.
 *
 * Sharetribe's Console cannot pin a listing type to a process version, so the alias is written onto
 * each listing instead (a transaction uses its listing's own alias, not the listing type's). Tying
 * that to enabling calendar booking keeps the two in step: a calendar listing is exactly a listing
 * that needs the process where the calendar, not the coach, confirms a booking.
 *
 * Missing or malformed is an error, never a default: silently falling back to release-1 would put
 * the coach's Accept button back on bookings that are already on their calendar.
 *
 * @param {object} [env]
 * @returns {{alias: string}|{error: string}}
 */
const resolveBookingProcessAlias = (env = process.env) => {
  const alias = (env.BOOKING_PROCESS_ALIAS || '').trim();
  if (!alias) return { error: 'BOOKING_PROCESS_ALIAS is not set' };
  if (!ALIAS_PATTERN.test(alias)) {
    return { error: 'BOOKING_PROCESS_ALIAS must look like default-booking/release-2' };
  }
  return { alias };
};

/** The Revie page a client changes or cancels a session on, without a transaction id. */
const manageUrlFor = (siteUrl, transactionId) => {
  const root = String(siteUrl || '').replace(/\/+$/, '');
  return transactionId ? `${root}/order/${transactionId}` : `${root}/inbox/orders`;
};

/** The provider Nylas holds for a grant ('google', 'microsoft', ...), or null if it cannot say. */
const grantProvider = async grantId => {
  try {
    const grant = await nylasRequest(`/v3/grants/${grantId}`);
    return grant?.provider || null;
  } catch (e) {
    return null;
  }
};

/**
 * Sync every configuration a listing needs and return the publicData that records them.
 *
 * Does not write to Sharetribe: the caller does, with whichever SDK it has.
 *
 * Configurations for lengths the listing no longer sells are kept in the map rather than dropped,
 * because a session already booked at that length can only be cancelled or rescheduled through its
 * own configuration.
 *
 * @returns {Promise<{publicData: object, configurationIds: object}>}
 */
const syncListingConfigurations = async ({
  listing,
  grantId,
  provider,
  coachName,
  coachEmail,
  calendarId,
  eventTypeKey,
  minBookingNoticeMinutes,
  siteUrl,
  processAlias,
  sync = syncConfiguration,
}) => {
  if (!/^https?:\/\//.test(String(siteUrl || ''))) {
    // Nylas needs an absolute URL for the links it puts in the calendar invite.
    throw new Error('A site URL is needed to write the Revie links into the calendar event');
  }

  const current = listing.attributes.publicData || {};
  const existing = configurationIdsOf(current);
  const configurationIds = { ...existing };

  for (const length of offeredLengths(current)) {
    // eslint-disable-next-line no-await-in-loop
    const { configuration } = await sync({
      grantId,
      configurationId: existing[String(length)],
      eventTypeKey,
      listingTitle: listing.attributes.title,
      durationMinutes: length,
      manageUrl: manageUrlFor(siteUrl),
      conferencing: conferencingFor(provider),
      coachName,
      coachEmail,
      calendarId,
      minBookingNoticeMinutes,
    });
    configurationIds[String(length)] = configuration.id;
  }

  const publicData = {
    nylasConfigurationIds: configurationIds,
    // Kept for anything still reading the single id: always the 60-minute configuration.
    ...(configurationIds['60'] ? { nylasConfigurationId: configurationIds['60'] } : {}),
    // Stored beside the ids by this same call, so the two cannot drift apart.
    nylasMinBookingNoticeMinutes:
      minBookingNoticeMinutes === undefined
        ? SCHEDULING_DEFAULTS.minBookingNoticeMinutes
        : minBookingNoticeMinutes,
    nylasEventTypeKey: eventTypeKey,
    // The booking event is edited after creation (client name, order link), which needs the
    // calendar it lives on.
    nylasCalendarId: calendarId,
    calendarBookingEnabled: true,
    transactionProcessAlias: processAlias,
  };

  return { publicData, configurationIds };
};

module.exports = {
  resolveBookingProcessAlias,
  manageUrlFor,
  grantProvider,
  syncListingConfigurations,
};
