/**
 * Leaves out of the availability endpoint any time that Sharetribe would refuse.
 *
 * Why this exists: availability comes from the coach's calendar (Nylas). Sharetribe separately holds
 * each booking's slot on the listing until the booking is cancelled, declined or expired, and
 * refuses a new booking that overlaps one (a 409 at checkout). The two disagree whenever a slot is
 * held in Sharetribe but free in the calendar: a late-cancelled session (it keeps its slot by
 * design: the coach is paid), the five-minute wait after a coach deletes an event, a client who is
 * part-way through checkout, an old release-5 reschedule (docs/tech-constraints.md). Offering such a
 * time only sends the client to an error, so it is not offered.
 *
 * How: one Marketplace API call, `timeslots.query` for the listing over the window. Sharetribe
 * computes time slots from the availability plan, exceptions and every pending or accepted booking,
 * so what comes back is what it would accept. A Nylas slot is kept only if it fits inside one of them.
 *
 * Fails open. If the call fails, is rate limited, or says nothing useful, every Nylas slot is kept:
 * the friendly 409 at checkout is the backstop, and an outage here must never empty the calendar.
 *
 * Cached for a few seconds per listing and day-rounded window, with concurrent requests sharing one
 * call: the booking form and the reschedule card both ask, a page load can ask more than once, and
 * Sharetribe rate limits queries per IP. The price of the cache is that a slot taken in the last few
 * seconds may still be offered once; the backstop covers that too.
 */

const log = require('../../log');

const DAY_MS = 24 * 60 * 60 * 1000;
// The largest page the timeslots endpoint allows. A permissive plan gives about one time slot per day
// plus one more per booking, so a window of at most MAX_WINDOW_DAYS fits in one page.
const PER_PAGE = 500;
const CACHE_TTL_MS = 15 * 1000;
const CACHE_MAX_ENTRIES = 200;

const cache = new Map(); // key -> { at, promise }

/**
 * Join time slots that touch or overlap, so a session that runs across a day boundary (each day is
 * its own slot in a day-by-day plan) is not mistaken for being outside them.
 *
 * @param {Array<{start: number, end: number}>} intervals epoch milliseconds
 */
const mergeIntervals = intervals => {
  const sorted = intervals
    .filter(i => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .map(i => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach(i => {
    const last = merged[merged.length - 1];
    if (last && i.start <= last.end) {
      last.end = Math.max(last.end, i.end);
    } else {
      merged.push(i);
    }
  });
  return merged;
};

/**
 * Keep the Nylas slots that fit entirely inside a Sharetribe time slot.
 *
 * @param {Array<{start_time: number, end_time: number}>} slots Nylas slots, epoch seconds
 * @param {Array<{start: number, end: number}>|null} intervals Sharetribe's, epoch ms; null = unknown
 */
const filterSlotsBySharetribe = (slots, intervals) => {
  // Unknown, or nothing at all (a plan we cannot read would otherwise hide everything): keep all.
  if (!intervals || intervals.length === 0) return slots;
  const merged = mergeIntervals(intervals);
  return (slots || []).filter(slot => {
    const start = Number(slot.start_time) * 1000;
    const end = Number(slot.end_time) * 1000;
    return merged.some(i => i.start <= start && end <= i.end);
  });
};

const toInterval = timeslot => ({
  start: new Date(timeslot.attributes.start).getTime(),
  end: new Date(timeslot.attributes.end).getTime(),
});

/**
 * Sharetribe's free time for the listing over [from, to], as merged intervals; null when it could not
 * be read. One call per cache miss.
 *
 * @param {object} params
 * @param {object} params.sdk a Marketplace SDK instance (the caller's own session)
 * @param {string} params.listingId
 * @param {Date} params.from
 * @param {Date} params.to
 * @param {number} [params.now] injectable clock
 */
const fetchSharetribeIntervals = ({ sdk, listingId, from, to, now = Date.now() }) => {
  // Rounded out to whole days so requests that differ by a millisecond share one cache entry.
  const start = new Date(Math.floor(from.getTime() / DAY_MS) * DAY_MS);
  const end = new Date(Math.ceil(to.getTime() / DAY_MS) * DAY_MS);
  const key = `${listingId}|${start.getTime()}|${end.getTime()}`;

  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.promise;

  // Started inside a promise so that anything that goes wrong, even synchronously, fails open.
  const promise = Promise.resolve()
    .then(() => sdk.timeslots.query({ listingId, start, end, perPage: PER_PAGE, page: 1 }))
    .then(response => {
      const meta = response.data.meta || {};
      if ((meta.totalPages || 1) > 1) {
        // More than one page would need more calls than we allow ourselves; do not guess from part.
        log.error(
          new Error('Sharetribe time slots span more than one page'),
          'nylas-timeslots-paged',
          {
            listingId,
          }
        );
        return null;
      }
      return mergeIntervals((response.data.data || []).map(toInterval));
    })
    .catch(e => {
      // Failing open is the design, but it is worth knowing about.
      log.error(e, 'nylas-timeslots-failed', { listingId, status: e && e.status });
      cache.delete(key); // a failure is not remembered: the next request tries again
      return null;
    });

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, promise });
  return promise;
};

const clearCache = () => cache.clear();

module.exports = {
  mergeIntervals,
  filterSlotsBySharetribe,
  fetchSharetribeIntervals,
  clearCache,
  CACHE_TTL_MS,
};
