// The server's 48-hour rule and the client's helper must answer the same, everywhere, including at
// the boundary: the booking panel, the checkout and the email say "inside 48 hours" by the one, the
// refund is decided by the other.
const { isFreeCancellation, isInsideFreeWindow } = require('./scheduler');
const client = require('../../../src/util/freeCancellationWindow');
const en = require('../../../src/translations/en.json');
const { buildSessionEmailModel } = require('./sessionEmailModel');

const HOUR = 3600000;
const NOW = Date.UTC(2026, 11, 1, 12, 0, 0);

describe('the 48-hour rule, server and client', () => {
  const offsets = [-5, 0, 1, 24, 30, 47, 47.99, 48, 48.01, 49, 72, 120];

  it.each(offsets)('agrees at %s hours out', hours => {
    const start = NOW + hours * HOUR;
    const refunded = isFreeCancellation({ bookingStart: start, cancelledAt: NOW });
    expect(isInsideFreeWindow(start, NOW)).toBe(!refunded);
    expect(client.isInsideFreeWindow(start, NOW)).toBe(!refunded);
  });

  it('is 48 hours on both sides', () => {
    expect(client.FREE_CANCELLATION_HOURS).toBe(48);
  });

  it('the server helper does not throw on a start it cannot read', () => {
    expect(isInsideFreeWindow(undefined, NOW)).toBe(false);
    expect(isInsideFreeWindow('not a date', NOW)).toBe(false);
  });

  it("the email says it in the checkout summary's words", () => {
    const now = Date.UTC(2026, 11, 1, 12, 0, 0);
    const model = buildSessionEmailModel({
      recipient: 'client',
      sessionName: 'S',
      coachName: 'Maya R.',
      clientName: 'Jess',
      start: new Date(now + 30 * HOUR).toISOString(),
      end: new Date(now + 31 * HOUR).toISOString(),
      coachTimeZone: 'Europe/London',
      clientTimeZone: 'America/Los_Angeles',
      manageUrl: 'u',
      now,
    });
    // CheckoutPage.insideWindow: "<b>Less than 48 hours away.</b> ... If {name} cancels, ..."
    const checkout = en['CheckoutPage.insideWindow']
      .replace(/<\/?b>/g, '')
      .replace('{name}', 'Maya');
    expect(model.freeWindowClosedText).toBe(checkout);
  });
});
