import { clientTimeZoneMaybe } from './CheckoutPageTransactionHelpers';

const calendarListing = { attributes: { publicData: { calendarBookingEnabled: true } } };

describe('clientTimeZoneMaybe()', () => {
  it("saves the browser's timezone with a calendar booking, for the reminder and reschedule emails", () => {
    const result = clientTimeZoneMaybe(calendarListing);
    expect(typeof result.clientTimeZone).toBe('string');
    expect(result.clientTimeZone.length).toBeGreaterThan(0);
  });

  it('saves nothing for any other kind of listing', () => {
    expect(clientTimeZoneMaybe({ attributes: { publicData: {} } })).toEqual({});
    expect(clientTimeZoneMaybe(undefined)).toEqual({});
  });

  it('saves nothing, rather than failing, when the browser cannot say', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no Intl');
    });
    expect(clientTimeZoneMaybe(calendarListing)).toEqual({});
    spy.mockRestore();
  });
});
