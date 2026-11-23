/**
 * POST /api/promo/check   body: { code }
 *
 * "Is this code good for me?", asked by the checkout page when the client presses Apply, so the
 * answer (or the friendly reason) appears at once without starting a booking. Reserves nothing; the
 * real booking checks everything again and reserves (initiate-privileged.js).
 *
 * Answers 200 with { ok: true, code, percentOff } or { ok: false, reason }. The caller is identified
 * from their own session, never from the request.
 */

const { createCookieTokenStore, getSdk, fetchCommission } = require('../../api-util/sdk');
const { resolvePromo } = require('./resolve');

module.exports = async (req, res) => {
  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);

  try {
    const userResponse = await sdk.currentUser.show();
    const customerId = userResponse.data.data.id.uuid;

    const commissionResponse = await fetchCommission(sdk);
    const asset = commissionResponse.data.data[0];
    const commissionPercent =
      asset && asset.type === 'jsonAsset'
        ? asset.attributes.data?.providerCommission?.percentage
        : undefined;

    const { code } = req.body || {};
    const promo = await resolvePromo({
      sdk,
      customerId,
      rawCode: code,
      commissionPercent,
      reserve: false,
    });
    if (!promo) {
      res.status(200).json({ ok: false, reason: 'invalid' });
      return;
    }
    res.status(200).json({ ok: true, code: promo.code, percentOff: promo.percentOff });
  } catch (e) {
    // A refusal carries `promo-<reason>`; anything else (no login, Sharetribe down) is a plain failure.
    if (e.statusText && e.statusText.startsWith('promo-')) {
      res.status(200).json({ ok: false, reason: e.statusText.replace(/^promo-/, '') });
      return;
    }
    console.error(`[promo] check failed: ${e.message}`); // eslint-disable-line no-console
    res.status(e.status === 401 ? 401 : 502).json({ ok: false, reason: 'unavailable' });
  }
};
