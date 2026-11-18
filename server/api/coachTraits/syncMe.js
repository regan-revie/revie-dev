/**
 * POST /api/coach-traits/sync-me
 *
 * "Copy my profile's traits onto my session listings now." Called by the profile page right after a
 * coach saves, so a change reaches search in seconds rather than at the next loop tick
 * (reconcileTraits.js, which also catches anything this misses).
 *
 * Takes no input: it acts on the logged-in coach's own published listings, with their own session,
 * so there is nothing to forge and no way to touch anyone else's. Safe to call repeatedly.
 */

const { createCookieTokenStore, getSdk, handleError } = require('../../api-util/sdk');
const { syncListingsFromProfile } = require('./sync');

module.exports = async (req, res) => {
  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);

  try {
    // Identifies the caller. There is no CSRF protection in this codebase, so every state-changing
    // endpoint establishes who is calling before acting.
    const userResponse = await sdk.currentUser.show();
    const user = userResponse.data.data;

    const listingsResponse = await sdk.ownListings.query({ states: 'published', perPage: 100 });
    const { changes, errors } = await syncListingsFromProfile({
      userPublicData: user.attributes.profile?.publicData,
      listings: listingsResponse.data.data,
      updateListing: args => sdk.ownListings.update(args),
    });

    errors.forEach(
      ({ listingId, error }) =>
        console.error(`[coach-traits] sync-me: listing ${listingId} failed: ${error.message}`) // eslint-disable-line no-console
    );
    res.status(200).json({ ok: errors.length === 0, updated: changes.length - errors.length });
  } catch (e) {
    if (e.status) {
      handleError(res, e);
      return;
    }
    console.error(`[coach-traits] sync-me failed: ${e.message}`); // eslint-disable-line no-console
    res.status(502).json({ error: 'Could not update your listings' });
  }
};
