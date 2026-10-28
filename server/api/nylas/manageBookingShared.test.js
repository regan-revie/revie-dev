const { resolveBookingTarget } = require('./manageBookingShared');

const listing = publicData => ({ attributes: { publicData } });
const booking = (start, end) => ({ attributes: { start, end } });

describe('resolveBookingTarget()', () => {
  const data = {
    calendarBookingEnabled: true,
    nylasConfigurationIds: { 60: 'cfg-60', 90: 'cfg-90' },
  };

  it("picks the configuration that matches the booking's own length", () => {
    const target = resolveBookingTarget({
      tx: {},
      listing: listing(data),
      booking: booking('2026-11-02T10:00:00Z', '2026-11-02T11:30:00Z'),
    });
    expect(target).toMatchObject({ configurationId: 'cfg-90', lengthMinutes: 90 });
  });

  it("returns null, not another length's configuration, when the length has none", () => {
    const target = resolveBookingTarget({
      tx: {},
      listing: listing(data),
      booking: booking('2026-11-02T10:00:00Z', '2026-11-02T10:45:00Z'),
    });
    expect(target.configurationId).toBeNull();
  });

  it('still resolves a listing enabled before lengths existed (single id = 60 minutes)', () => {
    const target = resolveBookingTarget({
      tx: {},
      listing: listing({ calendarBookingEnabled: true, nylasConfigurationId: 'cfg-old' }),
      booking: booking('2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z'),
    });
    expect(target.configurationId).toBe('cfg-old');
  });

  it('is null for a listing that is not a calendar listing', () => {
    const target = resolveBookingTarget({
      tx: {},
      listing: listing({ nylasConfigurationIds: { 60: 'x' } }),
      booking: booking('2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z'),
    });
    expect(target.configurationId).toBeNull();
  });
});
