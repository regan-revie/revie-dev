/**
 * Check every coach's Google connection with Nylas right now, instead of waiting for the daily check
 * or for a grant.expired notice. Run on the Render Shell (it has the Nylas and Sharetribe Integration
 * credentials), or locally through `op run --env-file=.env --`.
 *
 *   node scripts/nylas-check-grants.js
 *
 * It does exactly what the daily check does (server/api/nylas/grantHealth.js): a grant Nylas says is
 * invalid or gone is marked reconnect_needed, the coach's sessions stop being bookable, and they get
 * the one reconnect email (if sending is on); a grant that works again is cleared. Prints counts only,
 * never names, emails or tokens. Whichever Sharetribe and Nylas credentials are set is the
 * environment it acts on: Dev only until cutover.
 */

const { runGrantHealthCheck } = require('../server/api/nylas/grantHealth');

runGrantHealthCheck()
  .then(summary => {
    console.log(JSON.stringify(summary)); // eslint-disable-line no-console
    process.exit(summary.failed > 0 ? 1 : 0);
  })
  .catch(e => {
    console.error(`Check failed: ${e.message}`); // eslint-disable-line no-console
    process.exit(1);
  });
