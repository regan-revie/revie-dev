import {
  FREE_CANCELLATION_HOURS,
  findNewTimeSearch,
  formatCancelUntil,
  formatDiscount,
  formatSessionWhen,
  formatTimeRange,
  sessionMinutes,
  subjectWillOf,
} from './checkoutFormat';

const at = iso => new Date(iso).getTime();

describe('checkoutFormat', () => {
  describe('formatTimeRange', () => {
    it('says am or pm once when both ends share it', () => {
      expect(
        formatTimeRange(at('2026-12-03T10:00:00Z'), at('2026-12-03T11:00:00Z'), 'Europe/London')
      ).toBe('10:00 to 11:00 am');
    });

    it('says it twice when the session crosses noon', () => {
      expect(
        formatTimeRange(at('2026-12-03T11:30:00Z'), at('2026-12-03T12:30:00Z'), 'Europe/London')
      ).toBe('11:30 am to 12:30 pm');
    });

    it("reads in the viewer's zone, not the coach's", () => {
      expect(
        formatTimeRange(at('2026-12-03T10:00:00Z'), at('2026-12-03T11:00:00Z'), 'America/New_York')
      ).toBe('5:00 to 6:00 am');
    });
  });

  it('formatSessionWhen: "Thu 3 Dec · 10:00 to 11:00 am"', () => {
    expect(
      formatSessionWhen(at('2026-12-03T10:00:00Z'), at('2026-12-03T11:00:00Z'), 'Europe/London')
    ).toBe('Thu 3 Dec · 10:00 to 11:00 am');
  });

  describe('formatCancelUntil', () => {
    it('is 48 hours before the start', () => {
      expect(FREE_CANCELLATION_HOURS).toBe(48);
      expect(formatCancelUntil(at('2026-12-03T10:00:00Z'), 'Europe/London')).toBe(
        'Tue 1 Dec, 10:00 am'
      );
    });

    it('follows the clock across a daylight-saving change (the viewer sees their own 48 hours)', () => {
      // London leaves BST on 25 Oct 2026 at 01:00 UTC: 48 hours before 10:00 GMT on the 26th is
      // 10:00 UTC on the 24th, which London reads as 11:00 BST.
      expect(formatCancelUntil(at('2026-10-26T10:00:00Z'), 'Europe/London')).toBe(
        'Sat 24 Oct, 11:00 am'
      );
    });
  });

  it('sessionMinutes: whole minutes', () => {
    expect(sessionMinutes(at('2026-12-03T10:00:00Z'), at('2026-12-03T11:00:00Z'))).toBe(60);
    expect(sessionMinutes(at('2026-12-03T10:00:00Z'), at('2026-12-03T10:30:00Z'))).toBe(30);
  });

  describe('findNewTimeSearch', () => {
    it("keeps the length's slug, the viewer's day and opens the phone sheet", () => {
      expect(
        findNewTimeSearch({
          priceVariantName: '60 minutes',
          startMs: at('2026-12-03T10:00:00Z'),
          timeZone: 'Europe/London',
        })
      ).toBe('?bookableOption=60-minutes&day=2026-12-03&orderOpen=true');
    });

    it("uses the day in the viewer's zone, which can differ from UTC", () => {
      expect(
        findNewTimeSearch({
          priceVariantName: '30 minutes',
          startMs: at('2026-12-03T23:30:00Z'),
          timeZone: 'Asia/Tokyo',
        })
      ).toContain('day=2026-12-04');
    });

    it('leaves out what it does not have', () => {
      expect(findNewTimeSearch({})).toBe('?orderOpen=true');
    });
  });

  it("subjectWillOf: She'll, He'll, and They'll for everyone else", () => {
    expect(subjectWillOf('she-her')).toBe("She'll");
    expect(subjectWillOf('he-him')).toBe("He'll");
    expect(subjectWillOf('they-them')).toBe("They'll");
    expect(subjectWillOf(undefined)).toBe("They'll");
  });

  it('formatDiscount: a real minus sign, whatever sign came in', () => {
    expect(formatDiscount('-$16.50')).toBe('−$16.50');
    expect(formatDiscount('$16.50')).toBe('−$16.50');
    expect(formatDiscount('−$16.50')).toBe('−$16.50');
  });
});
