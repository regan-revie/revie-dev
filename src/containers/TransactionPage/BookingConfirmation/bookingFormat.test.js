import {
  formatClock,
  formatFreeUntil,
  formatSessionDay,
  formatSessionTimes,
  formatSessionWhen,
  heroDateParts,
  sessionMinutes,
  shortTimeZoneName,
} from './bookingFormat';

const at = iso => new Date(iso).getTime();
const START = at('2026-12-03T18:00:00Z'); // 10:00 in Los Angeles, 18:00 in London
const END = at('2026-12-03T19:00:00Z');

describe('bookingFormat', () => {
  it('shortTimeZoneName: PT in the Pacific, whatever the season; letters elsewhere', () => {
    expect(shortTimeZoneName('America/Los_Angeles', START)).toBe('PT');
    expect(shortTimeZoneName('America/Los_Angeles', at('2026-07-03T18:00:00Z'))).toBe('PT');
    expect(shortTimeZoneName('America/New_York', START)).toBe('ET');
    expect(shortTimeZoneName('Europe/London', START)).toBe('GMT');
    expect(shortTimeZoneName('Europe/London', at('2026-07-03T18:00:00Z'))).toBe('BST');
  });

  it('formatClock: "10:00 AM", with plain spaces', () => {
    expect(formatClock(START, 'America/Los_Angeles')).toBe('10:00 AM');
    expect(formatClock(at('2026-12-03T22:30:00Z'), 'America/Los_Angeles')).toBe('2:30 PM');
  });

  describe('formatSessionTimes', () => {
    it('says AM or PM once when both ends share it: "10:00–11:00 AM PT"', () => {
      expect(formatSessionTimes(START, END, 'America/Los_Angeles')).toBe('10:00–11:00 AM PT');
    });

    it('says it twice when the session crosses noon: "11:30 AM–12:30 PM PT"', () => {
      expect(
        formatSessionTimes(
          at('2026-12-03T19:30:00Z'),
          at('2026-12-03T20:30:00Z'),
          'America/Los_Angeles'
        )
      ).toBe('11:30 AM–12:30 PM PT');
    });

    it("reads in the viewer's own zone", () => {
      expect(formatSessionTimes(START, END, 'Europe/London')).toBe('6:00–7:00 PM GMT');
    });
  });

  it('formatSessionDay and formatSessionWhen: "Thu, Dec 3 · 10:00–11:00 AM PT"', () => {
    expect(formatSessionDay(START, 'America/Los_Angeles')).toBe('Thu, Dec 3');
    expect(formatSessionWhen(START, END, 'America/Los_Angeles')).toBe(
      'Thu, Dec 3 · 10:00–11:00 AM PT'
    );
  });

  it('heroDateParts: the date card', () => {
    expect(heroDateParts(START, 'America/Los_Angeles')).toEqual({
      top: 'Thu · Dec',
      day: '3',
      time: '10:00 AM PT',
    });
  });

  it('formatFreeUntil: 48 hours before the start, in the same zone', () => {
    expect(formatFreeUntil(START, 'America/Los_Angeles')).toBe('Tue, Dec 1, 10:00 AM');
  });

  it('sessionMinutes', () => {
    expect(sessionMinutes(START, END)).toBe(60);
  });
});
