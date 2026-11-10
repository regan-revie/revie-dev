/**
 * POST /api/nylas/enable-listing
 *
 * A coach opting one of their listings into calendar booking. Requirement #4: Revie defines the
 * event types, the coach chooses which to sell, so this takes an event type key rather than letting
 * a coach describe their own.
 *
 * Body: { listingId, eventTypeKey, calendarId?, minBookingNoticeMinutes? }
 *
 * Now a thin wrapper: the work (configurations per session length, calendar, hours, notice, process
 * alias, availability plan) is ensureBookable.js, which the server also runs automatically for every
 * coach (reconcile.js), so this is only needed to choose a calendar or notice period explicitly.
 * It always forces a sync and always writes the configured process alias. Refused up front if
 * BOOKING_PROCESS_ALIAS is missing.
 */

const { createCookieTokenStore, getSdk, handleError, serialize } = require('../../api-util/sdk');
const { getEventType } = require('./scheduler');
const { isConfigured } = require('./config');
const { resolveBookingProcessAlias } = require('./listingSync');
const { ensureListingBookable } = require('./ensureBookable');
const { WEEKDAYS, permissiveAvailabilityPlan } = require('./availabilityPlan');

module.exports = async (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Calendar integration is not configured' });
    return;
  }

  const { listingId, eventTypeKey, calendarId, minBookingNoticeMinutes } = req.body || {};

  if (!listingId || !eventTypeKey) {
    res.status(400).json({ error: 'listingId and eventTypeKey are required' });
    return;
  }
  if (!getEventType(eventTypeKey)) {
    res.status(400).json({ error: 'Unknown event type' });
    return;
  }

  // Checked before anything is written anywhere: without the alias the listing would be left on the
  // process that waits for a coach to accept a booking the calendar has already confirmed.
  const processAlias = resolveBookingProcessAlias();
  if (processAlias.error) {
    console.error(`[nylas] Cannot enable calendar booking: ${processAlias.error}`);
    res.status(503).json({ error: processAlias.error, code: 'no-process-alias' });
    return;
  }

  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);

  try {
    // Identifies the caller and proves they are logged in. There is no CSRF protection in this
    // codebase, so every state-changing endpoint has to establish who is calling before acting.
    const userResponse = await sdk.currentUser.show();
    const profile = userResponse.data.data.attributes.profile || {};

    // ownListings rather than listings: this refuses a listing the caller does not own, so a coach
    // cannot enable booking on somebody else's listing and point it at their own calendar.
    const listingResponse = await sdk.ownListings.show({ id: listingId });
    const listing = listingResponse.data.data;

    const result = await ensureListingBookable({
      listing,
      profile,
      updateListing: ({ publicData, availabilityPlan }) =>
        sdk.ownListings.update({ id: listingId, publicData, availabilityPlan }),
      siteUrl: process.env.REACT_APP_MARKETPLACE_ROOT_URL,
      overrides: { eventTypeKey, calendarId, minBookingNoticeMinutes, useEnvAlias: true },
      force: true,
    });

    if (result.status === 'no-grant') {
      res
        .status(409)
        .json({ error: 'Connect a calendar before enabling booking', code: 'no-grant' });
      return;
    }
    if (result.status === 'no-calendar') {
      res.status(409).json({
        error: result.explicit
          ? 'That calendar cannot be written to'
          : 'No writable calendar found',
        code: 'no-calendar',
      });
      return;
    }
    if (result.status !== 'synced') {
      res.status(409).json({ error: 'Could not enable calendar booking', code: result.status });
      return;
    }

    res
      .status(200)
      .set('Content-Type', 'application/transit+json')
      .send(
        serialize({
          status: 200,
          statusText: 'OK',
          data: {
            configurationIds: result.configurationIds,
            calendarId: result.calendarId,
            timezone: result.timeZone,
            minBookingNoticeMinutes: result.minBookingNoticeMinutes,
            listingId: result.updated.data.data.id,
          },
        })
      );
  } catch (e) {
    if (e.status) {
      handleError(res, e);
      return;
    }
    console.error(`[nylas] Enabling calendar booking failed: ${e.message}`);
    res.status(502).json({ error: 'Could not enable calendar booking' });
  }
};

module.exports.permissiveAvailabilityPlan = permissiveAvailabilityPlan;
module.exports.WEEKDAYS = WEEKDAYS;
