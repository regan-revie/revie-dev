import { mergeConfig } from '../../../util/configHelpers';
import { getDefaultConfiguration, getHostedConfiguration } from '../../../util/testHelpers';

import { hasValidListingFieldsInExtendedData, tabsForListingType } from './EditListingWizard';
import { AVAILABILITY, DETAILS, PHOTOS, PRICING } from './EditListingWizardTab';

// The listing type exactly as Console serves it for Dev (hosted asset listings/listing-types.json),
// not the shape the app uses after restructuring it. The first version of this check read `unitType`
// from the restructured shape's top level, where it does not exist, so it hid nothing on the
// deployed site while a hand-written test config said it did.
const HOSTED_SESSION_TYPE = {
  id: 'signature-session',
  label: 'Signature Session',
  availabilityType: 'oneSeat',
  unitType: 'fixed',
  transactionProcess: { name: 'default-booking', alias: 'default-booking/release-1' },
  priceVariations: { enabled: true },
  imageSettings: { limitImages: false },
  messagingOptions: { fileAttachments: true },
  transactionFields: [],
  defaultListingFields: {
    description: true,
    availability: true,
    payoutDetails: false,
    images: true,
    pickup: false,
    title: true,
    files: false,
    shipping: false,
    location: false,
    price: true,
    stock: false,
  },
};

const HOSTED_DAILY_BOOKING_TYPE = {
  ...HOSTED_SESSION_TYPE,
  id: 'rent-bicycles-daily',
  unitType: 'day',
};

// What the wizard receives: the hosted asset run through the app's own config pipeline.
const processedTypes = hostedTypes => {
  const hosted = getHostedConfiguration();
  const merged = mergeConfig(
    { ...hosted, listingTypes: { ...hosted.listingTypes, listingTypes: hostedTypes } },
    getDefaultConfiguration()
  );
  return merged.listing.listingTypes;
};

describe('wizard tabs for a booking listing, from the config Dev actually serves', () => {
  it('go Details, Pricing, Photos for a fixed-length session: no availability step', () => {
    const [session] = processedTypes([HOSTED_SESSION_TYPE]);
    // The shape the check has to read: unit type under transactionType, not at the top.
    expect(session.unitType).toBeUndefined();
    expect(session.transactionType.unitType).toBe('fixed');

    expect(tabsForListingType('default-booking', session)).toEqual([DETAILS, PRICING, PHOTOS]);
  });

  it('keep the availability step for the other kinds of booking, which still use a plan', () => {
    const [daily] = processedTypes([HOSTED_DAILY_BOOKING_TYPE]);
    expect(tabsForListingType('default-booking', daily)).toContain(AVAILABILITY);
  });

  it('do not change anything for the other processes', () => {
    const [session] = processedTypes([HOSTED_SESSION_TYPE]);
    expect(tabsForListingType('default-purchase', session)).not.toContain(AVAILABILITY);
  });
});

describe('Details tab completeness and the coach-level traits', () => {
  // Console has the four traits as required listing fields; the editor no longer asks for them and
  // the server fills them in only after publish, so they must never hold the Details tab open.
  const required = (key, schemaType) => ({
    key,
    scope: 'public',
    schemaType,
    enumOptions: [{ option: 'a', label: 'A' }],
    saveConfig: { isRequired: true },
  });
  const config = {
    categoryConfiguration: { key: 'categoryLevel', categories: [] },
    listing: {
      listingFields: [
        required('identity', 'multi-enum'),
        required('communication_style', 'multi-enum'),
        required('language', 'multi-enum'),
        required('coachlocation', 'enum'),
        required('structure', 'enum'),
      ],
    },
  };
  const publicData = { listingType: 'signature-session' };

  it('does not wait for identity, communication style, language or location', () => {
    expect(hasValidListingFieldsInExtendedData({ ...publicData, structure: 'a' }, {}, config)).toBe(
      true
    );
  });

  it('still waits for a required field that is asked per session', () => {
    expect(hasValidListingFieldsInExtendedData(publicData, {}, config)).toBe(false);
  });
});
