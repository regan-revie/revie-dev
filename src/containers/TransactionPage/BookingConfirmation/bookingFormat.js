/**
 * Pure helpers for the client's booking page: how a session's day and time read, always in the
 * client's own timezone ("Thu, Dec 3 · 10:00–11:00 AM PT"), and when free cancellation ends. Apart
 * from the components so the date arithmetic is testable without rendering anything.
 */

const FREE_CANCELLATION_HOURS = 48;
const HOUR_MS = 60 * 60 * 1000;
const NARROW_SPACES = /[\s  ]+/g;

// The page is in English; the AM/PM and month names follow US usage ("10:00 AM", "Dec 3").
const LOCALE = 'en-US';

const partsOf = (ms, timeZone, options) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone, ...options }).formatToParts(new Date(ms));
const pick = (parts, type) => parts.find(p => p.type === type)?.value || '';

/** "10:00 AM": one moment's clock time. */
export const formatClock = (ms, timeZone) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(ms))
    .replace(NARROW_SPACES, ' ');

/**
 * The zone as people write it after a time: "PT", "ET", "GMT", "BST", "CET". US zones come as the
 * generic short name (PT, not PST or PDT, so it does not change with daylight saving); elsewhere
 * the letters Intl has (GMT, BST, CET), and failing those the offset ("GMT+5:30").
 */
export const shortTimeZoneName = (timeZone, ms = Date.now()) => {
  const name = (locale, timeZoneName) => {
    try {
      return pick(
        new Intl.DateTimeFormat(locale, { timeZone, timeZoneName }).formatToParts(new Date(ms)),
        'timeZoneName'
      );
    } catch (e) {
      return '';
    }
  };
  const letters = /^[A-Z]{2,5}$/;
  const generic = name('en-US', 'shortGeneric');
  if (letters.test(generic)) return generic;
  const british = name('en-GB', 'short');
  if (letters.test(british)) return british;
  return name('en-US', 'short') || timeZone;
};

/** "10:00–11:00 AM PT"; "11:30 AM–12:30 PM PT" when the session crosses noon. */
export const formatSessionTimes = (startMs, endMs, timeZone) => {
  const start = formatClock(startMs, timeZone);
  const end = formatClock(endMs, timeZone);
  const startPeriod = start.split(' ')[1];
  const endPeriod = end.split(' ')[1];
  const startShown = startPeriod === endPeriod ? start.replace(` ${startPeriod}`, '') : start;
  return `${startShown}–${end} ${shortTimeZoneName(timeZone, startMs)}`;
};

/** "Thu, Dec 3" */
export const formatSessionDay = (ms, timeZone) => {
  const parts = partsOf(ms, timeZone, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${pick(parts, 'weekday')}, ${pick(parts, 'month')} ${pick(parts, 'day')}`;
};

/** "Thu, Dec 3 · 10:00–11:00 AM PT" */
export const formatSessionWhen = (startMs, endMs, timeZone) =>
  `${formatSessionDay(startMs, timeZone)} · ${formatSessionTimes(startMs, endMs, timeZone)}`;

/** The date card in the hero: "Thu · Dec", "3" and "10:00 AM PT". */
export const heroDateParts = (startMs, timeZone) => {
  const parts = partsOf(startMs, timeZone, { weekday: 'short', month: 'short', day: 'numeric' });
  return {
    top: `${pick(parts, 'weekday')} · ${pick(parts, 'month')}`,
    day: pick(parts, 'day'),
    time: `${formatClock(startMs, timeZone)} ${shortTimeZoneName(timeZone, startMs)}`,
  };
};

/** When free cancelling and moving end, "Tue, Dec 1, 10:00 AM": 48 hours before the start. */
export const formatFreeUntil = (startMs, timeZone) => {
  const until = startMs - FREE_CANCELLATION_HOURS * HOUR_MS;
  return `${formatSessionDay(until, timeZone)}, ${formatClock(until, timeZone)}`;
};

/** The session's length in whole minutes. */
export const sessionMinutes = (startMs, endMs) => Math.round((endMs - startMs) / 60000);
