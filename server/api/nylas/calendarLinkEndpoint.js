/**
 * GET /api/nylas/calendar/:token/revie-session.ics
 *
 * The "Add to calendar" link in the client's "You're booked" email. It serves the same calendar file
 * as the attachment, as it stands now: a session that has been moved shows its new time (same UID, a
 * higher SEQUENCE, so a calendar updates the event it has instead of adding a second).
 *
 * There is no login, because it is opened from an email on any device, so the token is the only
 * credential: 24 random bytes per booking (db.getOrCreateCalendarToken), never the transaction id,
 * since the file holds the Meet link. Every reason for refusing (unknown token, cancelled booking,
 * more than 7 days after the session) answers the same plain 404, so the response says nothing
 * about which bookings exist.
 */

const db = require('./db');
const integration = require('./integration');
const { buildBookingCalendar } = require('./sessionEmails');

const EXPIRES_AFTER_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

const notFound = res => {
  res
    .status(404)
    .type('text/plain')
    .send('Not found');
};

/** Is the link still good for this booking? Not once it is cancelled, nor a week after the session. */
const isLinkLive = (mapping, now = Date.now()) => {
  if (!mapping || !['created', 'rescheduled'].includes(mapping.status)) return false;
  const end = new Date(mapping.booking_end || mapping.booking_start).getTime();
  return Number.isFinite(end) && now <= end + EXPIRES_AFTER_SESSION_MS;
};

module.exports = async (req, res) => {
  const { token } = req.params || {};
  if (!TOKEN_PATTERN.test(String(token || ''))) return notFound(res);
  if (!db.isAvailable() || !integration.isConfigured()) return notFound(res);

  try {
    const mapping = await db.findBookingByCalendarToken(token);
    if (!isLinkLive(mapping)) return notFound(res);

    const ics = await buildBookingCalendar({ mapping });
    res
      .status(200)
      // A calendar file, shown by the phone's own "add event" sheet or downloaded as revie-session.ics.
      .set({
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="revie-session.ics"',
        // The time can change (a reschedule) and the file holds the Meet link: never stored.
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      })
      .send(ics);
  } catch (e) {
    console.error(`[nylas] Calendar link failed: ${e.message}`);
    res
      .status(500)
      .type('text/plain')
      .send('Could not load the calendar file');
  }
  return undefined;
};

module.exports.isLinkLive = isLinkLive;
module.exports.EXPIRES_AFTER_SESSION_MS = EXPIRES_AFTER_SESSION_MS;
