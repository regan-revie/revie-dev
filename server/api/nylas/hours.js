/**
 * A coach's weekly booking hours: which days, one start and end time, and the timezone they are
 * read in. One schedule per coach, applied to all their session listings.
 *
 * Stored by the Calendar page on the coach's own user as `privateData.bookingHours`
 * (`{timeZone, days, start, end}`) and copied by ensureBookable.js onto each listing as
 * `publicData.nylasOpenHours` (`{days, start, end}`), which is what the availability endpoint
 * reads. `days` are ISO weekday numbers, 1 = Monday ... 7 = Sunday, the same numbers
 * filterSlotsByOpenHours compares against.
 *
 * Pure: no I/O.
 */

/** Mon-Fri 9:00-17:00. What nobody who has not chosen otherwise ever goes beyond: never 24/7. */
const DEFAULT_HOURS = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = value => {
  const match = TIME_PATTERN.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const isValidTimeZone = timeZone => {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch (e) {
    return false;
  }
};

/** `{days, start, end}` if it is a usable schedule, otherwise null. Order of days is normalised. */
const normalizeSchedule = raw => {
  if (!raw || typeof raw !== 'object') return null;
  const { days, start, end } = raw;
  if (!Array.isArray(days) || days.length === 0) return null;
  if (!days.every(d => Number.isInteger(d) && d >= 1 && d <= 7)) return null;
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null || from >= to) return null;
  return { days: Array.from(new Set(days)).sort((a, b) => a - b), start, end };
};

/** A coach's saved `bookingHours`, or null if absent or unusable. The timezone is optional here. */
const normalizeBookingHours = raw => {
  const schedule = normalizeSchedule(raw);
  if (!schedule) return null;
  return { ...schedule, timeZone: isValidTimeZone(raw.timeZone) ? raw.timeZone : null };
};

/**
 * The hours a listing should carry, and where they came from.
 *
 *   1. the coach's saved hours, if they have any;
 *   2. otherwise the hours the listing already has (a listing enabled before coaches could set
 *      hours keeps working exactly as it was);
 *   3. otherwise Mon-Fri 9:00-17:00.
 *
 * The timezone is the coach's, else the listing's current one, else the calendar's (which the caller
 * may not know yet, hence null).
 *
 * @returns {{days: number[], start: string, end: string, timeZone: string|null, source: string}}
 */
const resolveHours = ({ bookingHours, existingOpenHours, existingTimeZone, calendarTimeZone }) => {
  const coach = normalizeBookingHours(bookingHours);
  const existing = normalizeSchedule(existingOpenHours);
  const fallbackZone = isValidTimeZone(existingTimeZone)
    ? existingTimeZone
    : isValidTimeZone(calendarTimeZone)
    ? calendarTimeZone
    : null;

  if (coach) {
    const { timeZone, ...schedule } = coach;
    return { ...schedule, timeZone: timeZone || fallbackZone, source: 'coach' };
  }
  if (existing) return { ...existing, timeZone: fallbackZone, source: 'listing' };
  return { ...DEFAULT_HOURS, timeZone: fallbackZone, source: 'default' };
};

const sameSchedule = (a, b) => {
  const x = normalizeSchedule(a);
  const y = normalizeSchedule(b);
  return (
    !!x &&
    !!y &&
    x.start === y.start &&
    x.end === y.end &&
    x.days.length === y.days.length &&
    x.days.every((d, i) => d === y.days[i])
  );
};

module.exports = {
  DEFAULT_HOURS,
  isValidTimeZone,
  normalizeSchedule,
  normalizeBookingHours,
  resolveHours,
  sameSchedule,
};
