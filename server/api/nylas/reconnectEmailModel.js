/**
 * The model for the one "reconnect your calendar" email (Postmark template calendar-reconnect-coach,
 * server/email/templates.js).
 *
 * The button goes to the Calendar page rather than straight to Google: it works when the coach is
 * logged out too (they sign in, then see the button), where the connect flow itself needs a session.
 */

const CALENDAR_RECONNECT_ALIAS = 'calendar-reconnect-coach';

/** The first word of a name, for "Hi Sam,". */
const firstNameOf = name =>
  String(name || '')
    .trim()
    .split(/\s+/)[0] || '';

/**
 * @param {object} params
 * @param {string} [params.coachName]
 * @param {string} params.siteUrl the marketplace's public URL
 */
const buildReconnectEmailModel = ({ coachName, siteUrl }) => ({
  recipientName: firstNameOf(coachName) || 'there',
  reconnectUrl: `${String(siteUrl || 'https://heyrevie.com').replace(/\/$/, '')}/account/calendar`,
});

module.exports = { CALENDAR_RECONNECT_ALIAS, buildReconnectEmailModel };
