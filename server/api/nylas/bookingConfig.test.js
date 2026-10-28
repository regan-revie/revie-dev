const {
  lengthForVariant,
  offeredLengths,
  defaultLength,
  configurationIdsOf,
  configurationIdFor,
} = require('./bookingConfig');

const withVariants = (variants, extra = {}) => ({
  unitType: 'fixed',
  priceVariationsEnabled: true,
  priceVariants: variants,
  ...extra,
});

const VARIANTS = [
  { name: 'Quick', bookingLengthInMinutes: 30 },
  { name: 'Standard', bookingLengthInMinutes: 60 },
  { name: 'Deep', bookingLengthInMinutes: 90 },
];

describe('offeredLengths()', () => {
  it('lists each distinct variant length, ascending', () => {
    const data = withVariants([
      VARIANTS[2],
      VARIANTS[0],
      { name: 'Also 30', bookingLengthInMinutes: 30 },
    ]);
    expect(offeredLengths(data)).toEqual([30, 90]);
  });

  it('is one 60-minute session when the listing has no variants', () => {
    expect(offeredLengths({})).toEqual([60]);
    expect(offeredLengths(withVariants([]))).toEqual([60]);
    expect(offeredLengths({ ...withVariants(VARIANTS), priceVariationsEnabled: false })).toEqual([
      60,
    ]);
  });

  it('gives a variant with no length the template default of 60', () => {
    expect(offeredLengths(withVariants([{ name: 'No length' }]))).toEqual([60]);
  });
});

describe('lengthForVariant()', () => {
  it('returns the length a named variant is sold at', () => {
    expect(lengthForVariant(withVariants(VARIANTS), 'Deep')).toBe(90);
  });

  it('returns null for a name the listing does not have, rather than a default length', () => {
    expect(lengthForVariant(withVariants(VARIANTS), 'Nope')).toBeNull();
    expect(lengthForVariant({}, 'Deep')).toBeNull();
  });
});

describe('defaultLength()', () => {
  it("is the first variant's length, which the booking form preselects", () => {
    expect(defaultLength(withVariants([VARIANTS[2], VARIANTS[0]]))).toBe(90);
  });

  it('is 60 with no variants', () => {
    expect(defaultLength({})).toBe(60);
  });
});

describe('configurationIdFor()', () => {
  it('finds the configuration for a length', () => {
    const data = { nylasConfigurationIds: { 30: 'cfg-30', 90: 'cfg-90' } };
    expect(configurationIdFor(data, 90)).toBe('cfg-90');
    expect(configurationIdFor(data, 30)).toBe('cfg-30');
  });

  it("returns null for a length with no configuration, never another length's", () => {
    expect(configurationIdFor({ nylasConfigurationIds: { 30: 'cfg-30' } }, 90)).toBeNull();
    expect(configurationIdFor({}, 60)).toBeNull();
  });

  it('treats the older single id as the 60-minute configuration', () => {
    expect(configurationIdFor({ nylasConfigurationId: 'cfg-old' }, 60)).toBe('cfg-old');
    expect(configurationIdFor({ nylasConfigurationId: 'cfg-old' }, 90)).toBeNull();
  });

  it('prefers the keyed entry over the legacy id for 60', () => {
    const data = { nylasConfigurationId: 'cfg-old', nylasConfigurationIds: { 60: 'cfg-new' } };
    expect(configurationIdFor(data, 60)).toBe('cfg-new');
  });
});

describe('configurationIdsOf()', () => {
  it('folds the legacy id in and ignores empty entries', () => {
    expect(
      configurationIdsOf({ nylasConfigurationId: 'a', nylasConfigurationIds: { 90: 'b', 30: '' } })
    ).toEqual({ 60: 'a', 90: 'b' });
  });
});
