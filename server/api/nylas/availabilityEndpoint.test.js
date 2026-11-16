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

describe('availability handler: only times both Nylas and Sharetribe accept', () => {
  let logSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  const HOUR = 3600000;
  const DAY0 = Math.floor(Date.now() / 86400000) * 86400000 + 10 * 86400000;
  const nylas = (fromHour, toHour) => ({
    start_time: Math.floor((DAY0 + fromHour * HOUR) / 1000),
    end_time: Math.floor((DAY0 + toHour * HOUR) / 1000),
  });
  const timeslot = (fromHour, toHour) => ({
    attributes: { start: new Date(DAY0 + fromHour * HOUR), end: new Date(DAY0 + toHour * HOUR) },
  });
  const publicData = {
    calendarBookingEnabled: true,
    unitType: 'fixed',
    nylasConfigurationId: 'cfg-60',
  };

  // `query` is what Sharetribe's time slots call does; `raw` is what the calendar offers.
  const call = async ({ raw, query }) => {
    jest.resetModules();
    const timeslotsQuery = jest.fn(query);
    jest.doMock('../../log', () => ({ error: jest.fn() }));
    jest.doMock('../../api-util/sdk', () => ({
      getSdk: () => ({
        listings: {
          show: async () => ({
            data: { data: { attributes: { publicData, availabilityPlan: {} } } },
          }),
        },
        timeslots: { query: timeslotsQuery },
      }),
      handleError: jest.fn(),
    }));
    jest.doMock('./config', () => ({ isConfigured: () => true }));
    jest.doMock('./availability', () => ({
      createSession: async () => 'session',
      fetchAvailability: async () => raw,
      filterSlotsByNotice: s => s,
      filterSlotsByOpenHours: s => s,
      toBookableSlot: s => ({ start: s.start_time * 1000, end: s.end_time * 1000 }),
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
    await handler(
      {
        query: {
          listingId: 'l',
          start: new Date(DAY0).toISOString(),
          end: new Date(DAY0 + 3 * 86400000).toISOString(),
        },
      },
      res
    );
    return { res, timeslotsQuery };
  };

  const page = data => ({ data: { data, meta: { totalPages: 1 } } });
  const startsOf = res => res.body.slots.map(s => (s.start - DAY0) / HOUR);

  it('does not show a slot that is held in Sharetribe but free in Nylas, and shows a normal free one', async () => {
    // Nylas offers 10:00 and 12:00; Sharetribe still holds 10:00-11:00 for an earlier booking.
    const { res } = await call({
      raw: [nylas(10, 11), nylas(12, 13)],
      query: async () => page([timeslot(0, 10), timeslot(11, 72)]),
    });
    expect(res.code).toBe(200);
    expect(startsOf(res)).toEqual([12]);
    expect(res.body.connected).toBe(true);
    expect(logSpy.mock.calls.flat().some(l => /left out 1 of 2 slot/.test(String(l)))).toBe(true);
  });

  it('shows every slot both accept', async () => {
    const { res } = await call({
      raw: [nylas(10, 11), nylas(12, 13)],
      query: async () => page([timeslot(0, 72)]),
    });
    expect(startsOf(res)).toEqual([10, 12]);
  });

  it('makes exactly one Sharetribe call per request', async () => {
    const { timeslotsQuery } = await call({
      raw: [nylas(10, 11)],
      query: async () => page([timeslot(0, 72)]),
    });
    expect(timeslotsQuery).toHaveBeenCalledTimes(1);
    expect(timeslotsQuery.mock.calls[0][0].listingId).toBe('l');
  });

  it("still shows the calendar's times when Sharetribe cannot be asked (the checkout message is the backstop)", async () => {
    const { res } = await call({
      raw: [nylas(10, 11), nylas(12, 13)],
      query: async () => {
        throw Object.assign(new Error('rate limited'), { status: 429 });
      },
    });
    expect(res.code).toBe(200);
    expect(startsOf(res)).toEqual([10, 12]);
  });
});
