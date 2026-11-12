/**
 * Background timers that run inside the web service. Deliberately plain setInterval rather than a
 * separate Render cron service: one deploy, one set of secrets, and the work is idempotent and
 * guarded by a Postgres claim, so a missed tick (a deploy, a restart) only delays recovery.
 *
 * Set DISABLE_BACKGROUND_JOBS=true to turn them off.
 */

const { runBookingSweep } = require('./bookingSweeper');
const { runReconcile } = require('../api/nylas/reconcile');
const { resolveMissingEventIds } = require('../api/nylas/eventIdBackfill');
const { processDueEventCancellations } = require('../api/nylas/calendarEventSync');
const { processDueSessionEmails, backfillReminders } = require('../api/nylas/sessionEmails');
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
      // Calendar deletions whose five-minute wait is over (server/api/nylas/calendarEventSync.js).
      const deletions = await processDueEventCancellations();
      if (deletions.checked > 0) {
        console.log('[jobs] calendar deletions', JSON.stringify(deletions)); // eslint-disable-line no-console
      }
      // Session reminders and reschedule confirmations that are due (server/api/nylas/sessionEmails.js).
      const sessionEmails = await processDueSessionEmails();
      if (sessionEmails.checked > 0) {
        console.log('[jobs] session emails', JSON.stringify(sessionEmails)); // eslint-disable-line no-console
      }
      // Confirmed upcoming sessions that never got reminders queued.
      const reminders = await backfillReminders();
      if (reminders.queued > 0) {
        console.log('[jobs] reminders queued', JSON.stringify(reminders)); // eslint-disable-line no-console
      }
      // Bookings with no calendar event recorded yet, so the coach deleting one is recognised.
      const backfill = await resolveMissingEventIds();
      if (backfill.checked > 0) {
        console.log('[jobs] event id backfill', JSON.stringify(backfill)); // eslint-disable-line no-console
      }
    } catch (e) {
      log.error(e, 'nylas-booking-sweep-failed', {});
    } finally {
      running = false;
    }
  };

  // The reconcile loop (server/api/nylas/reconcile.js): puts every coach's session listings on their
  // calendar, and keeps them there. Its own flag, so a slow booking sweep never delays it or the
  // other way round.
  let reconciling = false;
  const reconcileTick = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      const result = await runReconcile();
      const changed = Object.entries(result.statuses || {}).filter(
        ([status]) => !['unchanged', 'ineligible'].includes(status)
      );
      if (changed.length > 0) {
        console.log('[jobs] reconcile', JSON.stringify(result)); // eslint-disable-line no-console
      }
    } catch (e) {
      log.error(e, 'nylas-reconcile-failed', {});
    } finally {
      reconciling = false;
    }
  };

  // unref(): these timers must never be the reason the process stays alive.
  setTimeout(tick, FIRST_SWEEP_AFTER_MS).unref();
  setInterval(tick, SWEEP_EVERY_MS).unref();
  setTimeout(reconcileTick, FIRST_SWEEP_AFTER_MS + 15 * 1000).unref();
  setInterval(reconcileTick, SWEEP_EVERY_MS).unref();
};

module.exports = { start };
