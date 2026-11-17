/**
 * The calendar file (.ics) and calendar links attached to a client's session emails.
 *
 * Why: the client's own calendar is the only place a session is certain to be found, and clients use
 * every calendar app. The email carries a file Apple Calendar, Outlook and the rest can import, and
 * an "Add to Outlook" link; Google Calendar users already have the event.
 *
 * The file is a plain event (METHOD:PUBLISH: nothing to accept or decline). Its UID is the same for
 * every email about one booking, and SEQUENCE goes up with each move, which is how an app that has
 * the first copy knows the later file is the same event moved and updates it instead of adding a
 * second. That is reliable in Apple Calendar and most others; it is not guaranteed everywhere.
 *
 * Pure: no I/O. Written to the iCalendar rules (RFC 5545): CRLF line ends, text escaped, lines
 * folded at 75 octets, times in UTC.
 */

const PRODID = '-//Revie//Session//EN';

/** "20261120T193000Z" */
const icsTime = value =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Text values: backslash, semicolon, comma and line breaks are escaped. */
const escapeText = value =>
  String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, ';')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** Fold a line at 75 octets, continuing on lines that start with one space (never mid-character). */
const fold = line => {
  const out = [];
  let current = '';
  let bytes = 0;
  // A continuation line starts with a space, which counts toward its 75 octets.
  let limit = 75;
  Array.from(line).forEach(char => {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > limit) {
      out.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += char;
    bytes += size;
  });
  out.push(current);
  return out.join('\r\n');
};

/**
 * @param {object} params
 * @param {string} params.uid the same for every file about one booking
 * @param {number} [params.sequence] 0 for the first file, then one more for each move
 * @param {Date|string|number} params.start
 * @param {Date|string|number} params.end
 * @param {string} params.summary the event's title
 * @param {string} [params.description]
 * @param {string} [params.location] the Meet link, when there is one
 * @param {string} [params.url] the booking page
 * @param {Date|string|number} [params.now] DTSTAMP, injectable for tests
 * @returns {string}
 */
const buildIcs = ({ uid, sequence = 0, start, end, summary, description, location, url, now }) => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsTime(now || Date.now())}`,
    `SEQUENCE:${Math.max(0, Math.floor(sequence))}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
};

/** The shape Postmark takes an attachment in. */
const icsAttachment = (ics, name = 'revie-session.ics') => ({
  name,
  content: Buffer.from(ics, 'utf8').toString('base64'),
  contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
});

/**
 * "Add to Outlook" (outlook.live.com's compose-event link; Microsoft 365 accounts are asked to sign
 * in there and reach the same form).
 */
const outlookCalendarUrl = ({ start, end, summary, description, location }) => {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: summary,
    startdt: new Date(start).toISOString(),
    enddt: new Date(end).toISOString(),
    ...(description ? { body: description } : {}),
    ...(location ? { location } : {}),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
};

module.exports = { buildIcs, icsAttachment, outlookCalendarUrl, icsTime, escapeText, fold };
