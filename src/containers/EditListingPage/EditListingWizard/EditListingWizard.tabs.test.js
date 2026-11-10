import { tabsForListingType } from './EditListingWizard';
import { AVAILABILITY, DETAILS, PRICING } from './EditListingWizardTab';

const session = { unitType: 'fixed', defaultListingFields: { location: false } };

describe('wizard tabs for a booking listing', () => {
  it("leave out the availability step for a fixed-length session, which is booked through the coach's calendar", () => {
    const tabs = tabsForListingType('default-booking', session);
    expect(tabs).not.toContain(AVAILABILITY);
    expect(tabs[0]).toBe(DETAILS);
    expect(tabs).toContain(PRICING);
  });

  it('keep it for the other kinds of booking, which still use an availability plan', () => {
    ['day', 'night', 'hour'].forEach(unitType => {
      expect(tabsForListingType('default-booking', { unitType })).toContain(AVAILABILITY);
    });
  });

  it('do not change anything for the other processes', () => {
    expect(tabsForListingType('default-purchase', { unitType: 'item' })).not.toContain(
      AVAILABILITY
    );
  });
});
