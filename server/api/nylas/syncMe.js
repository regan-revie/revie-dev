/**
 * POST /api/nylas/sync-me
 *
 * "Make my session listings bookable now." Called by the Calendar page right after a coach saves
 * their working hours, so the change reaches their listings in seconds rather than at the next
 * reconcile tick. Takes no input: it acts on the logged-in coach's own published listings, with
 * their own session, so there is nothing to forge and no way to touch anyone else's listing.
 *
 * Safe to call as often as you like (ensureBookable.js is idempotent) and never throws a coach into
 * an error for a Nylas hiccup: the reconcile loop will finish whatever this could not.
 */

const { createCookieTokenStore, getSdk, handleError } = require('../../api-util/sdk');
const { isConfigured } = require('./config');
const { ensureOwnListings } = require('./ensureCoach');

module.exports = async (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Calendar integration is not configured' });
    return;
  }

  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);

  try {
    // Identifies the caller. There is no CSRF protection in this codebase, so every state-changing
    // endpoint establishes who is calling before acting.
    const userResponse = await sdk.currentUser.show();
    const user = userResponse.data.data;

    const { locked, results } = await ensureOwnListings({
      sdk,
      userId: user.id.uuid,
      profile: user.attributes.profile || {},
      siteUrl: process.env.REACT_APP_MARKETPLACE_ROOT_URL,
    });

    const statuses = results.reduce(
      (counts, r) => ({ ...counts, [r.status]: (counts[r.status] || 0) + 1 }),
      {}
    );
    const failed = results.filter(r => r.status === 'error');
    failed.forEach(r =>
      console.error(`[nylas] sync-me: listing ${r.listingId} failed: ${r.error.message}`)
    );

    res.status(200).json({ ok: failed.length === 0, locked, statuses });
  } catch (e) {
    if (e.status) {
      handleError(res, e);
      return;
    }
    console.error(`[nylas] sync-me failed: ${e.message}`);
    res.status(502).json({ error: 'Could not update your listings' });
  }
};
