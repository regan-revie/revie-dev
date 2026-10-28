const { parseWindow, MAX_WINDOW_DAYS } = require('./availabilityEndpoint');

const iso = d => new Date(d).toISOString();

describe('parseWindow()', () => {
  it('defaults to the next 30 days when given nothing', () => {
    const { start, end, error } = parseWindow(undefined, undefined);
    expect(error).toBeUndefined();
    expect((end - start) / 86400000).toBeCloseTo(30, 0);
  });

  it('never offers slots in the past, however the window was framed', () => {
    // A stale client, or a hand-edited URL, must not be able to ask for yesterday.
    const { start } = parseWindow(iso(Date.now() - 10 * 86400000), iso(Date.now() + 86400000));
    expect(start.getTime()).toBeGreaterThanOrEqual(Date.now() - 2000);
  });

  it('rejects an unparseable date rather than silently defaulting', () => {
    expect(parseWindow('not-a-date', iso(Date.now() + 86400000)).error).toMatch(/Invalid/);
    expect(parseWindow(iso(Date.now()), 'nonsense').error).toMatch(/Invalid/);
  });

  it('rejects a backwards window', () => {
    expect(parseWindow(iso(Date.now() + 86400000), iso(Date.now())).error).toMatch(/after start/);
  });

  it('rejects an absurdly long window', () => {
    const start = iso(Date.now());
    const end = iso(Date.now() + (MAX_WINDOW_DAYS + 5) * 86400000);
    expect(parseWindow(start, end).error).toMatch(/may not exceed/);
  });

  it('accepts a normal month-long window', () => {
    const start = iso(Date.now());
    const end = iso(Date.now() + 30 * 86400000);
    expect(parseWindow(start, end).error).toBeUndefined();
  });
});

describe('resolveRequestedLength()', () => {
  const { resolveRequestedLength } = require('./availabilityEndpoint');
  const listing = {
    unitType: 'fixed',
    priceVariationsEnabled: true,
    priceVariants: [
      { name: 'Quick', bookingLengthInMinutes: 30 },
      { name: 'Deep', bookingLengthInMinutes: 90 },
    ],
  };

  it("uses the named variant's length", () => {
    expect(resolveRequestedLength(listing, { priceVariantName: 'Deep' })).toEqual({ length: 90 });
  });

  it('refuses an unknown variant rather than falling back to some other length', () => {
    expect(resolveRequestedLength(listing, { priceVariantName: 'Nope' }).error).toMatch(/Unknown/);
  });

  it('accepts a bare length only if the listing sells it (used when rescheduling)', () => {
    expect(resolveRequestedLength(listing, { lengthMinutes: '30' })).toEqual({ length: 30 });
    expect(resolveRequestedLength(listing, { lengthMinutes: '45' }).error).toMatch(/not sold/);
  });

  it("defaults to the first variant's length, which the form preselects", () => {
    expect(resolveRequestedLength(listing, {})).toEqual({ length: 30 });
    expect(resolveRequestedLength({}, {})).toEqual({ length: 60 });
  });
});

describe('availability handler', () => {
  const call = async (query, publicData) => {
    jest.resetModules();
    const createSession = jest.fn(async id => `session-for-${id}`);
    const fetchAvailability = jest.fn(async () => []);
    jest.doMock('../../api-util/sdk', () => ({
      getSdk: () => ({
        listings: {
          show: async () => ({
            data: { data: { attributes: { publicData, availabilityPlan: {} } } },
          }),
        },
      }),
      handleError: jest.fn(),
    }));
    jest.doMock('./config', () => ({ isConfigured: () => true }));
    jest.doMock('./availability', () => ({
      createSession,
      fetchAvailability,
      filterSlotsByNotice: s => s,
      filterSlotsByOpenHours: s => s,
      toBookableSlot: s => s,
    }));
    const handler = require('./availabilityEndpoint');
    const res = {
      status(c) {
        this.code = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      },
    };
    await handler({ query }, res);
    return { res, createSession };
  };

  const data = {
    calendarBookingEnabled: true,
    unitType: 'fixed',
    priceVariationsEnabled: true,
    priceVariants: [
      { name: 'Quick', bookingLengthInMinutes: 30 },
      { name: 'Deep', bookingLengthInMinutes: 90 },
    ],
    nylasConfigurationIds: { 30: 'cfg-30', 90: 'cfg-90' },
  };

  it("asks Nylas through the chosen variant's own configuration", async () => {
    const { res, createSession } = await call({ listingId: 'l', priceVariantName: 'Deep' }, data);
    expect(res.code).toBe(200);
    expect(createSession).toHaveBeenCalledWith('cfg-90');
  });

  it('answers 400 for a variant the listing does not have', async () => {
    const { res, createSession } = await call({ listingId: 'l', priceVariantName: 'Nope' }, data);
    expect(res.code).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('offers no times for a length with no configuration, without calling Nylas', async () => {
    const { res, createSession } = await call(
      { listingId: 'l', priceVariantName: 'Deep' },
      { ...data, nylasConfigurationIds: { 30: 'cfg-30' } }
    );
    expect(res.body).toEqual({ slots: [], connected: true });
    expect(createSession).not.toHaveBeenCalled();
  });
});
