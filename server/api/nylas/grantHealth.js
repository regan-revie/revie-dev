/**
 * The daily check of every coach's grant, in case a `grant.expired` or `grant.deleted` webhook never
 * arrived (Nylas retries, but a deploy, a wrong URL or a switched-off trigger would lose one).
 *
 * Asks Nylas about each coach's stored grant. A grant Nylas says is invalid or gone is marked
 * reconnect_needed (grantStatus.markReconnectNeeded, which stops bookings, tells the coach once and
 * reports to Sentry). A grant it cannot answer for (an outage, a rate limit, a rejected key) is left
 * alone.
 *
 * One safeguard: if it finds EVERY checked grant broken (with at least three), that is almost
 * certainly something wrong on our side (the wrong Nylas region or API key answers 404 for all of
 * them) and not a coach problem, so it flags nobody and reports that instead.
 */

const log = require('../../log');
const integration = require('./integration');
const status = require('./grantStatus');

const SUSPICIOUS_MIN = 3;

const runGrantHealthCheck = async ({ now = Date.now(), request, send } = {}) => {
  const sdk = integration.getIntegrationSdk();
  if (!sdk) return { skipped: true };

  const summary = { checked: 0, valid: 0, broken: 0, unknown: 0, marked: 0, cleared: 0, failed: 0 };
  const broken = [];

  for await (const user of status.usersWithGrants(sdk)) {
    const userId = user.id.uuid;
    const privateData = status.privateDataOf(user);
    summary.checked += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const health = await status.fetchGrantHealth(privateData.nylasGrantId, { request });
      summary[health.state] += 1;
      const alreadyMarked = status.statusOf(privateData) === status.RECONNECT_NEEDED;

      if (health.state === 'broken' && !alreadyMarked) {
        broken.push({
          userId,
          grantId: privateData.nylasGrantId,
          reason: `daily-check-${health.reason}`,
        });
      } else if (health.state === 'valid' && alreadyMarked) {
        // eslint-disable-next-line no-await-in-loop
        await status.clearReconnectNeeded({ sdk, userId });
        summary.cleared += 1;
      }
    } catch (e) {
      summary.failed += 1;
      log.error(e, 'nylas-grant-check-failed', { coachId: userId });
    }
  }

  const everyGrantBroken = summary.checked >= SUSPICIOUS_MIN && summary.broken === summary.checked;
  if (everyGrantBroken) {
    log.error(
      new Error(
        'Every connected calendar looks broken, which points at our Nylas setup, not at coaches'
      ),
      'nylas-grant-check-suspicious',
      { checked: summary.checked }
    );
    return { ...summary, suspicious: true };
  }

  for (const { userId, grantId, reason } of broken) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await status.markReconnectNeeded({ sdk, userId, grantId, reason, now, send });
      if (result.changed) summary.marked += 1;
    } catch (e) {
      summary.failed += 1;
      log.error(e, 'nylas-grant-check-failed', { coachId: userId });
    }
  }
  return summary;
};

module.exports = { runGrantHealthCheck };
