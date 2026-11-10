const {
  DEFAULT_HOURS,
  normalizeSchedule,
  normalizeBookingHours,
  resolveHours,
  sameSchedule,
  isValidTimeZone,
} = require('./hours');

describe('normalizeSchedule()', () => {
  it('accepts days, a start and an end, and sorts and de-duplicates the days', () => {
    expect(normalizeSchedule({ days: [3, 1, 3, 2], start: '08:30', end: '16:00' })).toEqual({
      days: [1, 2, 3],
      start: '08:30',
      end: '16:00',
    });
  });

  it.each([
    ['no days', { days: [], start: '09:00', end: '17:00' }],
    ['day 0', { days: [0], start: '09:00', end: '17:00' }],
    ['day 8', { days: [8], start: '09:00', end: '17:00' }],
    ['a weekday name', { days: ['mon'], start: '09:00', end: '17:00' }],
    ['a bad time', { days: [1], start: '9am', end: '17:00' }],
    ['24:00', { days: [1], start: '09:00', end: '24:00' }],
    ['start after end', { days: [1], start: '17:00', end: '09:00' }],
    ['start equal to end', { days: [1], start: '09:00', end: '09:00' }],
  ])('rejects %s', (name, raw) => {
    expect(normalizeSchedule(raw)).toBeNull();
  });

  it('rejects things that are not a schedule', () => {
    expect(normalizeSchedule(undefined)).toBeNull();
    expect(normalizeSchedule('9-5')).toBeNull();
  });
});

describe('normalizeBookingHours()', () => {
  it('keeps a valid timezone and drops an invalid one', () => {
    const base = { days: [1], start: '09:00', end: '17:00' };
    expect(normalizeBookingHours({ ...base, timeZone: 'Europe/London' }).timeZone).toBe(
      'Europe/London'
    );
    expect(normalizeBookingHours({ ...base, timeZone: 'Mars/Phobos' }).timeZone).toBeNull();
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('resolveHours()', () => {
  const coach = { days: [2, 4], start: '10:00', end: '14:00', timeZone: 'Europe/Paris' };

  it("uses the coach's saved hours and timezone first", () => {
    expect(
      resolveHours({
        bookingHours: coach,
        existingOpenHours: { days: [1], start: '08:00', end: '12:00' },
        existingTimeZone: 'America/New_York',
      })
    ).toEqual({
      days: [2, 4],
      start: '10:00',
      end: '14:00',
      timeZone: 'Europe/Paris',
      source: 'coach',
    });
  });

  it("keeps a listing's existing hours when the coach has saved none, so nothing changes on deploy", () => {
    const existing = { days: [1, 2, 3, 4, 5], start: '09:00', end: '16:00' };
    expect(
      resolveHours({
        existingOpenHours: existing,
        existingTimeZone: 'America/Los_Angeles',
      })
    ).toEqual({ ...existing, timeZone: 'America/Los_Angeles', source: 'listing' });
  });

  it('defaults to Mon-Fri 9:00-17:00 when there is nothing, and never to 24/7', () => {
    const result = resolveHours({ calendarTimeZone: 'Europe/London' });
    expect(result).toMatchObject({
      ...DEFAULT_HOURS,
      timeZone: 'Europe/London',
      source: 'default',
    });
    expect(DEFAULT_HOURS).toEqual({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' });
  });

  it('ignores unusable saved hours rather than trusting them', () => {
    expect(resolveHours({ bookingHours: { days: [], start: '09:00', end: '17:00' } }).source).toBe(
      'default'
    );
  });

  it("falls back to the listing's zone, then the calendar's, for a coach who gave hours but no zone", () => {
    const hours = { days: [1], start: '09:00', end: '17:00' };
    expect(
      resolveHours({
        bookingHours: hours,
        existingTimeZone: 'Asia/Tokyo',
        calendarTimeZone: 'Europe/London',
      }).timeZone
    ).toBe('Asia/Tokyo');
    expect(resolveHours({ bookingHours: hours, calendarTimeZone: 'Europe/London' }).timeZone).toBe(
      'Europe/London'
    );
  });
});

describe('sameSchedule()', () => {
  it('compares days, start and end, ignoring order', () => {
    expect(
      sameSchedule(
        { days: [2, 1], start: '09:00', end: '17:00' },
        { days: [1, 2], start: '09:00', end: '17:00' }
      )
    ).toBe(true);
    expect(
      sameSchedule(
        { days: [1], start: '09:00', end: '17:00' },
        { days: [1], start: '09:00', end: '18:00' }
      )
    ).toBe(false);
    expect(sameSchedule(undefined, DEFAULT_HOURS)).toBe(false);
  });
});
