/**
 * The values a session email's Postmark template is filled in with. Pure: no I/O.
 *
 * Times are shown in the recipient's own timezone. The coach's is their working-hours zone. The
 * client's is the one their browser reported when they booked (`clientTimeZone` on the transaction),
 * and when there is none (a booking made before that was recorded) the coach's timezone is used
 * instead and the email says so, in `timeZoneNote`, rather than quietly showing a time that may be
 * wrong for them.
 *
 * Every name here is a variable in the templates (server/email/templates.js); a test checks the two
 * stay in step.
 */

const { isValidTimeZone } = require('./hours');

const LOCALE = 'en-GB';

const part = (date, timeZone, options) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone, ...options }).format(date);

/** "Thursday 14 November" */
const formatDate = (date, timeZone) =>
  part(date, timeZone, { weekday: 'long', day: 'numeric', month: 'long' });

/** "3:00 pm" */
const formatTime = (date, timeZone) =>
  part(date, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true });

/** "GMT", "BST", "GMT-8": how the zone is abbreviated on that date (daylight saving included). */
const formatZoneName = (date, timeZone) => {
  const found = new Intl.DateTimeFormat(LOCALE, { timeZone, timeZoneName: 'short' })
    .formatToParts(date)
    .find(p => p.type === 'timeZoneName');
  return found ? found.value : timeZone;
};

/** The first word of a display name. */
const firstNameOf = name =>
  String(name || '')
    .trim()
    .split(/\s+/)[0] || 'there';

/** "London" from "Europe/London", for sentences. */
const placeOf = timeZone =>
  String(timeZone)
    .split('/')
    .pop()
    .replace(/_/g, ' ');

/**
 * Which timezone to show a recipient, and whether to explain it.
 *
 * @returns {{timeZone: string, isFallback: boolean}}
 */
const zoneFor = ({ recipient, coachTimeZone, clientTimeZone }) => {
  const coachZone = isValidTimeZone(coachTimeZone) ? coachTimeZone : 'UTC';
  if (recipient === 'coach') return { timeZone: coachZone, isFallback: false };
  if (isValidTimeZone(clientTimeZone)) return { timeZone: clientTimeZone, isFallback: false };
  return { timeZone: coachZone, isFallback: true };
};

/**
 * @param {object} params
 * @param {'client'|'coach'} params.recipient
 * @param {string} params.sessionName the listing's title
 * @param {string} params.coachName
 * @param {string} params.clientName
 * @param {Date|string|number} params.start
 * @param {Date|string|number} params.end
 * @param {Date|string|number} [params.oldStart] reschedule confirmations only
 * @param {Date|string|number} [params.oldEnd]
 * @param {string} [params.coachTimeZone]
 * @param {string} [params.clientTimeZone]
 * @param {string} [params.meetLink]
 * @param {string} params.manageUrl the booking page for this recipient
 * @returns {object} the template model
 */
const buildSessionEmailModel = ({
  recipient,
  sessionName,
  coachName,
  clientName,
  start,
  end,
  oldStart,
  oldEnd,
  coachTimeZone,
  clientTimeZone,
  meetLink,
  manageUrl,
}) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const { timeZone, isFallback } = zoneFor({ recipient, coachTimeZone, clientTimeZone });
  const zoneName = formatZoneName(startDate, timeZone);

  const range = (from, to) => `${formatTime(from, timeZone)} to ${formatTime(to, timeZone)}`;

  const model = {
    // First name only, for the greeting ("Hi Alex,"); the other person is named in full.
    recipientName: firstNameOf(recipient === 'coach' ? coachName : clientName),
    coachName,
    clientName,
    sessionName,
    sessionDate: formatDate(startDate, timeZone),
    sessionTime: range(startDate, endDate),
    timeZoneName: zoneName,
    timeZoneNote: isFallback
      ? `We don't have your timezone, so these times are in ${coachName}'s timezone: ${placeOf(
          timeZone
        )} time (${zoneName}).`
      : '',
    meetLink: meetLink || '',
    hasMeetLink: Boolean(meetLink),
    manageUrl,
  };

  if (oldStart && oldEnd) {
    const was = new Date(oldStart);
    model.oldSessionDate = formatDate(was, timeZone);
    model.oldSessionTime = range(was, new Date(oldEnd));
  }
  return model;
};

module.exports = {
  buildSessionEmailModel,
  zoneFor,
  formatDate,
  formatTime,
  formatZoneName,
  placeOf,
};
