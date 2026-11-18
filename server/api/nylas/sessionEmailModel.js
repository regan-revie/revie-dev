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

// An unreadable date prints as nothing rather than throwing, so an email can still go out and the
// caller (sessionEmails.js) reports what is missing.
const part = (date, timeZone, options) => {
  try {
    return new Intl.DateTimeFormat(LOCALE, { timeZone, ...options }).format(date);
  } catch (e) {
    return '';
  }
};

/** "Thursday 14 November" */
const formatDate = (date, timeZone) =>
  part(date, timeZone, { weekday: 'long', day: 'numeric', month: 'long' });

/** "3:00 pm" */
const formatTime = (date, timeZone) =>
  part(date, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true });

// Where the standard name is not how people say it. The same list is in the page's own
// formatTimeZoneName (src/components/OrderPanel/NylasBookingForm/nylasSlots.js).
const FRIENDLY_ZONE_NAMES = { 'United Kingdom Time': 'UK time' };

/**
 * The zone as people say it on that date: "Pacific Time", "Eastern Time", "UK time".
 * `longGeneric` is exactly that form (no "Standard"/"Daylight", which would be wrong half the year);
 * it falls back to the long name, then to the zone id, where it cannot be produced.
 */
const formatZoneName = (date, timeZone) => {
  const nameOf = timeZoneName => {
    const found = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName })
      .formatToParts(date)
      .find(p => p.type === 'timeZoneName');
    return found && found.value;
  };
  let name;
  try {
    name = nameOf('longGeneric') || nameOf('long') || timeZone;
  } catch (e) {
    try {
      name = nameOf('long') || timeZone;
    } catch (e2) {
      name = timeZone;
    }
  }
  return FRIENDLY_ZONE_NAMES[name] || name;
};

const HOUR_MS = 3600000;
// The same 48 hours as the refund rule (server/api/nylas/scheduler.js): cancelling or moving is free
// until then.
const FREE_WINDOW_MS = 48 * HOUR_MS;

/** "1 hour", "45 minutes", "1 hour 30 minutes". */
const formatLength = (start, end) => {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (!(minutes > 0)) return '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '';
  const m = rest ? `${rest} ${rest === 1 ? 'minute' : 'minutes'}` : '';
  return [h, m].filter(Boolean).join(' ');
};

/** "$50.00" from {amount: 5000, currency: 'USD'}; '' when there is nothing sensible to show. */
const formatMoney = money => {
  if (!money || !(money.amount > 0) || !money.currency) return '';
  try {
    const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: money.currency });
    const digits = format.resolvedOptions().maximumFractionDigits;
    return format.format(money.amount / 10 ** digits);
  } catch (e) {
    return '';
  }
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
 * @param {{amount: number, currency: string}} [params.payinTotal] what the client paid (minor units)
 * @param {string} [params.calendarUrl] the "Add to calendar" link (the booking's calendar file)
 * @param {number} [params.now] injectable clock, for "free until"
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
  payinTotal,
  calendarUrl,
  now = Date.now(),
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
      ? `We don't have your timezone, so these times are in ${coachName}'s timezone: ${zoneName}.`
      : '',
    lengthText: formatLength(startDate, endDate),
    meetLink: meetLink || '',
    hasMeetLink: Boolean(meetLink),
    manageUrl,
    calendarUrl: calendarUrl || '',
    hasCalendarLink: Boolean(calendarUrl),
    totalPaid: formatMoney(payinTotal),
    hasTotalPaid: Boolean(formatMoney(payinTotal)),
  };

  // Free to cancel or move until 48 hours before the start, in the recipient's zone. Each value that
  // the templates print is the whole text itself (or '' when it does not apply), because a Postmark
  // section shows a value with {{.}} (see server/email/templates.js). `freeWindowOpen` and
  // `freeWindowClosed` are kept as plain flags; with an unreadable start neither is set, and the
  // caller reports it.
  const freeUntilDate = new Date(startDate.getTime() - FREE_WINDOW_MS);
  const hasStart = Number.isFinite(freeUntilDate.getTime());
  const open = hasStart && freeUntilDate.getTime() > now;
  model.freeUntil = hasStart
    ? `${formatDate(freeUntilDate, timeZone)}, ${formatTime(freeUntilDate, timeZone)} (${zoneName})`
    : '';
  model.freeWindowOpen = open;
  model.freeUntilOpen = open ? model.freeUntil : '';
  model.freeWindowClosed = hasStart && !open;

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
  formatLength,
  formatMoney,
  placeOf,
};
