/**
 * A coach's weekly booking hours, as the Calendar page edits them.
 *
 * Stored on the coach's own user as `privateData.bookingHours` = `{timeZone, days, start, end}`,
 * where `days` are ISO weekday numbers (1 = Monday ... 7 = Sunday) and times are 'HH:MM' in that
 * timezone. One schedule per coach, applied to all their session listings. The server reads it in
 * server/api/nylas/hours.js, which is the authority on what is valid; the checks here only keep the
 * form honest, and the two must be kept in step.
 */

/** Mon-Fri 9:00-17:00: what a coach who has never chosen has (the server uses the same). */
export const DEFAULT_BOOKING_HOURS = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const toMinutes = value => {
  const match = TIME_PATTERN.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** Every half hour of the day, 00:00 to 23:30. */
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hours = String(Math.floor(i / 2)).padStart(2, '0');
  return `${hours}:${i % 2 ? '30' : '00'}`;
});

/**
 * The hours saved on the coach's user, or null if they have none (or they are unusable).
 *
 * @returns {{days: number[], start: string, end: string, timeZone: string|null}|null}
 */
export const getSavedBookingHours = currentUser => {
  const saved = currentUser?.attributes?.profile?.privateData?.bookingHours;
  if (!saved || validateBookingHours(saved)) return null;
  return {
    days: [...saved.days].sort((a, b) => a - b),
    start: saved.start,
    end: saved.end,
    timeZone: typeof saved.timeZone === 'string' ? saved.timeZone : null,
  };
};

/**
 * @returns {string|null} the key of the problem (a translation suffix), or null when it is usable
 */
export const validateBookingHours = hours => {
  const { days, start, end } = hours || {};
  if (
    !Array.isArray(days) ||
    days.length === 0 ||
    !days.every(d => Number.isInteger(d) && d >= 1 && d <= 7)
  ) {
    return 'noDays';
  }
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null || from >= to) return 'endBeforeStart';
  return null;
};

/** IANA timezones the browser knows, always including `selected`. */
export const timeZoneOptions = selected => {
  const known =
    typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
  return selected && !known.includes(selected) ? [selected, ...known] : known;
};
