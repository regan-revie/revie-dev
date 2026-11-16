jest.mock('../../log', () => ({ error: jest.fn() }));

const log = require('../../log');
const {
  mergeIntervals,
  filterSlotsBySharetribe,
  fetchSharetribeIntervals,
  clearCache,
  CACHE_TTL_MS,
} = require('./sharetribeSlots');

const HOUR = 3600000;
const DAY0 = Math.floor(Date.now() / 86400000) * 86400000 + 10 * 86400000; // midnight, ten days out
const at = hours => DAY0 + hours * HOUR;
const secs = ms => Math.floor(ms / 1000);
const nylasSlot = (fromHour, toHour) => ({
  start_time: secs(at(fromHour)),
  end_time: secs(at(toHour)),
});
const interval = (fromHour, toHour) => ({ start: at(fromHour), end: at(toHour) });

describe('mergeIntervals()', () => {
  it('joins intervals that touch or overlap, and leaves a gap alone', () => {
    expect(
      mergeIntervals([interval(0, 10), interval(10, 24), interval(30, 34), interval(33, 40)])
    ).toEqual([interval(0, 24), interval(30, 40)]);
  });

  it('drops anything that is not a real interval', () => {
    expect(mergeIntervals([{ start: NaN, end: 5 }, interval(5, 5), interval(6, 2)])).toEqual([]);
  });
});

describe('filterSlotsBySharetribe()', () => {
  // A booking holds 10:00-11:00 on the listing, so Sharetribe's free time is everything around it.
  const aroundHeldTen = [interval(0, 10), interval(11, 24)];

  it('does not show a slot that Sharetribe holds but the calendar says is free', () => {
    const kept = filterSlotsBySharetribe([nylasSlot(10, 11)], aroundHeldTen);
    expect(kept).toEqual([]);
  });

  it('shows a normal free slot', () => {
    const slot = nylasSlot(12, 13);
    expect(filterSlotsBySharetribe([slot], aroundHeldTen)).toEqual([slot]);
  });

  it('keeps the free one and drops the held one when both are offered', () => {
    const held = nylasSlot(10, 11);
    const free = nylasSlot(14, 15);
    expect(filterSlotsBySharetribe([held, free], aroundHeldTen)).toEqual([free]);
  });

  it('drops a slot that only partly overlaps a held time', () => {
    expect(filterSlotsBySharetribe([nylasSlot(9.5, 10.5)], aroundHeldTen)).toEqual([]);
    expect(filterSlotsBySharetribe([nylasSlot(10.5, 11.5)], aroundHeldTen)).toEqual([]);
  });

  it('keeps a slot that ends exactly where a held time begins, and one that starts where it ends', () => {
    const before = nylasSlot(9, 10);
    const after = nylasSlot(11, 12);
    expect(filterSlotsBySharetribe([before, after], aroundHeldTen)).toEqual([before, after]);
  });

  it('keeps a session that runs across midnight when Sharetribe has one slot per day', () => {
    const overMidnight = nylasSlot(23.5, 24.5);
    expect(filterSlotsBySharetribe([overMidnight], [interval(0, 24), interval(24, 48)])).toEqual([
      overMidnight,
    ]);
  });

  it('keeps every slot when Sharetribe could not be read, or said nothing', () => {
    const slots = [nylasSlot(10, 11), nylasSlot(12, 13)];
    expect(filterSlotsBySharetribe(slots, null)).toEqual(slots);
    expect(filterSlotsBySharetribe(slots, [])).toEqual(slots);
  });
});

describe('fetchSharetribeIntervals()', () => {
  const from = new Date(at(2));
  const to = new Date(at(24 * 30));
  const timeslot = (fromHour, toHour) => ({
    attributes: { start: new Date(at(fromHour)), end: new Date(at(toHour)), seats: 1 },
  });
  const makeSdk = response => ({
    timeslots: { query: jest.fn(async () => response) },
  });
  const page = (data, meta = { totalPages: 1 }) => ({ data: { data, meta } });

  beforeEach(() => {
    clearCache();
    jest.clearAllMocks();
  });

  it('makes one Sharetribe call, for the listing over the window, and returns merged intervals', async () => {
    const sdk = makeSdk(page([timeslot(0, 10), timeslot(11, 24), timeslot(24, 48)]));
    const result = await fetchSharetribeIntervals({ sdk, listingId: 'l1', from, to });

    expect(sdk.timeslots.query).toHaveBeenCalledTimes(1);
    const params = sdk.timeslots.query.mock.calls[0][0];
    expect(params.listingId).toBe('l1');
    expect(params.start.getTime()).toBeLessThanOrEqual(from.getTime());
    expect(params.end.getTime()).toBeGreaterThanOrEqual(to.getTime());
    expect(params.perPage).toBe(500);
    expect(result).toEqual([interval(0, 10), interval(11, 48)]);
  });

  it('shares one call between requests that arrive together, and for a few seconds after', async () => {
    const sdk = makeSdk(page([timeslot(0, 24)]));
    const now = Date.now();
    await Promise.all([
      fetchSharetribeIntervals({ sdk, listingId: 'l1', from, to, now }),
      fetchSharetribeIntervals({
        sdk,
        listingId: 'l1',
        from: new Date(from.getTime() + 5),
        to,
        now,
      }),
    ]);
    await fetchSharetribeIntervals({ sdk, listingId: 'l1', from, to, now: now + CACHE_TTL_MS - 1 });
    expect(sdk.timeslots.query).toHaveBeenCalledTimes(1);

    await fetchSharetribeIntervals({ sdk, listingId: 'l1', from, to, now: now + CACHE_TTL_MS + 1 });
    expect(sdk.timeslots.query).toHaveBeenCalledTimes(2);
  });

  it('does not mix up two listings', async () => {
    const sdk = makeSdk(page([timeslot(0, 24)]));
    await fetchSharetribeIntervals({ sdk, listingId: 'l1', from, to });
    await fetchSharetribeIntervals({ sdk, listingId: 'l2', from, to });
    expect(sdk.timeslots.query).toHaveBeenCalledTimes(2);
  });

  it('fails open when Sharetribe errors: null, reported, and tried again next time', async () => {
    const sdk = {
      timeslots: {
        query: jest.fn().mockRejectedValueOnce(Object.assign(new Error('429'), { status: 429 })),
      },
    };
    expect(await fetchSharetribeIntervals({ sdk, listingId: 'l1', from, to })).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-timeslots-failed', {
      listingId: 'l1',
      status: 429,
    });

    sdk.timeslots.query.mockResolvedValueOnce(page([timeslot(0, 24)]));
    expect(await fetchSharetribeIntervals({ sdk, listingId: 'l1', from, to })).toEqual([
      interval(0, 24),
    ]);
    expect(sdk.timeslots.query).toHaveBeenCalledTimes(2);
  });

  it('fails open when the SDK has no time slots at all (it must never break availability)', async () => {
    expect(await fetchSharetribeIntervals({ sdk: {}, listingId: 'l1', from, to })).toBeNull();
  });

  it('fails open rather than guess from part of the answer when it spans more than one page', async () => {
    const sdk = makeSdk(page([timeslot(0, 24)], { totalPages: 2 }));
    expect(await fetchSharetribeIntervals({ sdk, listingId: 'l1', from, to })).toBeNull();
    expect(log.error.mock.calls[0][1]).toBe('nylas-timeslots-paged');
  });
});
