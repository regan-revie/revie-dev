const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems } = require('../api-util/lineItems');
const {
  assertProcessAliasMatchesListing,
  assertCalendarListingBookable,
} = require('./nylas/processAliasCheck');
const { resolvePromo } = require('./promo/resolve');
const promoStore = require('./promo/store');
const { isIntentionToMakeOffer } = require('../api-util/negotiation');
const {
  createCookieTokenStore,
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');

const { Money } = sharetribeSdk.types;

const listingPromise = (sdk, id) => sdk.listings.show({ id });

const getFullOrderData = (orderData, bodyParams, currency) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;

  return isIntentionToMakeOffer(offerInSubunits, transitionName)
    ? {
        ...orderData,
        ...bodyParams.params,
        currency,
        offer: new Money(offerInSubunits, currency),
      }
    : { ...orderData, ...bodyParams.params };
};

const getMetadata = (orderData, transition) => {
  const { actor, offerInSubunits } = orderData || {};
  // NOTE: for now, the actor is always "provider".
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  return isIntentionToMakeOffer(offerInSubunits, transition)
    ? {
        metadata: {
          offers: [
            {
              offerInSubunits,
              by,
              transition,
            },
          ],
        },
      }
    : {};
};

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body || {};
  const transitionName = bodyParams.transition;
  // Share one cookie token store so a refresh during listings.show is reused for exchangeToken.
  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);
  let lineItems = null;
  let metadataMaybe = {};
  // Revie: a promo code, if the client applied one. `redemptionId` is set only for a real booking
  // (a price preview reserves nothing); `initiated` says whether Sharetribe took the booking, so a
  // failure before that gives the reserved use back.
  let promo = null;
  let initiated = false;

  Promise.all([listingPromise(sdk, bodyParams?.params?.listingId), fetchCommission(sdk)])
    .then(async ([showListingResponse, fetchAssetsResponse]) => {
      const listing = showListingResponse.data.data;
      // Revie: a calendar listing may only be booked under its own process alias. See
      // nylas/processAliasCheck.js.
      assertProcessAliasMatchesListing(listing, bodyParams);
      // Revie: a calendar session that has been switched off (its coach's Google connection broke)
      // takes no new booking, however old the page the client is on.
      assertCalendarListingBookable(listing);
      const commissionAsset = fetchAssetsResponse.data.data[0];

      const currency = listing.attributes.price?.currency || orderData.currency;
      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      // The customer is identified from their own session, never from the request.
      if (orderData?.promoCode) {
        const userResponse = await sdk.currentUser.show();
        promo = await resolvePromo({
          sdk,
          customerId: userResponse.data.data.id.uuid,
          rawCode: orderData.promoCode,
          commissionPercent: providerCommission?.percentage,
          reserve: !isSpeculative,
        });
      }

      lineItems = transactionLineItems(
        listing,
        getFullOrderData(orderData, bodyParams, currency),
        providerCommission,
        customerCommission,
        promo
      );
      metadataMaybe = getMetadata(orderData, transitionName);
      if (promo) {
        // Readable in Console and by the order page; the discount itself is the line item.
        metadataMaybe = {
          metadata: {
            ...(metadataMaybe.metadata || {}),
            promo: { code: promo.code, percentOff: promo.percentOff },
          },
        };
      }

      return getTrustedSdk(req, res, tokenStore);
    })
    .then(trustedSdk => {
      const { params } = bodyParams;

      // Add lineItems to the body params
      const body = {
        ...bodyParams,
        params: {
          ...params,
          lineItems,
          ...metadataMaybe,
        },
      };

      if (isSpeculative) {
        return trustedSdk.transactions.initiateSpeculative(body, queryParams);
      }
      return trustedSdk.transactions.initiate(body, queryParams).then(response => {
        initiated = true;
        return response;
      });
    })
    .then(async apiResponse => {
      if (promo && promo.redemptionId) {
        // Tie the reserved use to its booking. If this fails the reconcile job still finds the
        // booking from the code on the transaction's metadata being absent from the row: it
        // releases a reservation with no booking after 30 minutes, so nothing is counted wrongly.
        try {
          await promoStore.attachTransaction(promo.redemptionId, apiResponse.data.data.id.uuid);
        } catch (e) {
          console.error(`[promo] could not attach a booking to its code use: ${e.message}`); // eslint-disable-line no-console
        }
      }
      const { status, statusText, data } = apiResponse;
      res
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status,
            statusText,
            data,
          })
        )
        .end();
    })
    .catch(async e => {
      // The booking was never created, so the use set aside for it goes back.
      if (promo && promo.redemptionId && !initiated) {
        await promoStore.release(promo.redemptionId).catch(() => null);
      }
      // A refused code, or a session switched off while a client had its page open, is an expected
      // answer, not a fault worth alerting on.
      const status = String(e.statusText || '');
      const isExpectedRefusal = status.startsWith('promo-') || status === 'calendar-not-bookable';
      handleError(res, e, { skipErrorLogging: isExpectedRefusal });
    });
};
