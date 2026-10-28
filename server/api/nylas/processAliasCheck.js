/**
 * Refuse to start a booking on a calendar listing under a process other than the listing's own.
 *
 * The browser sends the process alias it wants for the new transaction (bodyParams.processAlias),
 * and Sharetribe obeys it. For a calendar listing that is dangerous in one specific way: the alias
 * decides whether a paid booking waits for a coach to accept it. A request naming release-1 would
 * start a transaction nobody confirms and nothing declines. The listing's own alias is the one
 * enableListing wrote, so that is the only value accepted.
 *
 * Only calendar listings are checked; other listings keep the template's behaviour untouched.
 */

/**
 * @param {object} listing a Sharetribe listing resource
 * @param {object} bodyParams the initiate request's bodyParams
 * @returns {string|null} a reason to refuse, or null
 */
const getProcessAliasProblem = (listing, bodyParams) => {
  const publicData = listing?.attributes?.publicData || {};
  if (!publicData.calendarBookingEnabled) return null;

  const listingAlias = publicData.transactionProcessAlias;
  if (!listingAlias) return 'This calendar listing has no transaction process set.';

  if (bodyParams?.processAlias !== listingAlias) {
    return `This listing is booked under ${listingAlias}, not ${bodyParams?.processAlias ||
      'nothing'}.`;
  }
  return null;
};

/** Throws a 400 in the shape handleError expects, as bookingVariantCheck.js does. */
const assertProcessAliasMatchesListing = (listing, bodyParams) => {
  const problem = getProcessAliasProblem(listing, bodyParams);
  if (problem) {
    const error = new Error(problem);
    error.status = 400;
    error.statusText = problem;
    error.data = {};
    throw error;
  }
};

module.exports = { getProcessAliasProblem, assertProcessAliasMatchesListing };
