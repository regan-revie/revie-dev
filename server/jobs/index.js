/**
 * Background timers that run inside the web service. Deliberately plain setInterval rather than a
 * separate Render cron service: one deploy, one set of secrets, and the work is idempotent and
 * guarded by a Postgres claim, so a missed tick (a deploy, a restart) only delays recovery.
 *
 * Set DISABLE_BACKGROUND_JOBS=true to turn them off.
 */

const { runBookingSweep } = require('./bookingSweeper');
const log = require('../log');

const SWEEP_EVERY_MS = 60 * 1000;
const FIRST_SWEEP_AFTER_MS = 30 * 1000;

const start = () => {
  if (process.env.DISABLE_BACKGROUND_JOBS === 'true') {
    console.log('[jobs] background jobs disabled'); // eslint-disable-line no-console
    return;
  }

  let running = false;
  const tick = async () => {
    // A slow sweep must not be overtaken by the next tick.
    if (running) return;
    running = true;
    try {
      const result = await runBookingSweep();
      if (result.checked > 0) {
        console.log('[jobs] booking sweep', JSON.stringify(result)); // eslint-disable-line no-console
      }
    } catch (e) {
      log.error(e, 'nylas-booking-sweep-failed', {});
    } finally {
      running = false;
    }
  };

  // unref(): these timers must never be the reason the process stays alive.
  setTimeout(tick, FIRST_SWEEP_AFTER_MS).unref();
  setInterval(tick, SWEEP_EVERY_MS).unref();
};

module.exports = { start };
