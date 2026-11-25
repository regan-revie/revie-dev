import { FREE_CANCELLATION_HOURS, isInsideFreeWindow } from './freeCancellationWindow';

const HOUR = 3600000;
const NOW = Date.UTC(2026, 11, 1, 12, 0, 0);

describe('isInsideFreeWindow', () => {
  it('is the 48-hour rule', () => {
    expect(FREE_CANCELLATION_HOURS).toBe(48);
  });

  it('30 hours out is inside; 72 hours out is not', () => {
    expect(isInsideFreeWindow(NOW + 30 * HOUR, NOW)).toBe(true);
    expect(isInsideFreeWindow(NOW + 72 * HOUR, NOW)).toBe(false);
  });

  it('exactly 48 hours is still free (as on the server); a minute less is inside', () => {
    expect(isInsideFreeWindow(NOW + 48 * HOUR, NOW)).toBe(false);
    expect(isInsideFreeWindow(NOW + 48 * HOUR - 60000, NOW)).toBe(true);
  });

  it('a session already started is inside', () => {
    expect(isInsideFreeWindow(NOW - HOUR, NOW)).toBe(true);
  });

  it('takes a Date or an ISO string too', () => {
    expect(isInsideFreeWindow(new Date(NOW + 30 * HOUR), NOW)).toBe(true);
    expect(isInsideFreeWindow(new Date(NOW + 72 * HOUR).toISOString(), NOW)).toBe(false);
  });

  it('a start it cannot read is not "inside"', () => {
    expect(isInsideFreeWindow(undefined, NOW)).toBe(false);
    expect(isInsideFreeWindow(null, NOW)).toBe(false);
    expect(isInsideFreeWindow('', NOW)).toBe(false);
    expect(isInsideFreeWindow('not a date', NOW)).toBe(false);
  });
});
