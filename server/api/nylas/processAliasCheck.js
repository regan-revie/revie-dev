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

/**
 * Refuse to start a booking on a calendar session that has been switched off.
 *
 * A session the server has set up on a coach's calendar (it carries Nylas configurations) but that is
 * now not bookable (the coach's Google connection broke, or they lost their payout details) must not
 * take a new booking, even from a booking page a client opened earlier. The booking page already
 * hides the form, and availability returns no times; this is the check no page can skip. A listing
 * that was never set up on a calendar is not covered here, and bookings already made are untouched.
 *
 * @param {object} listing a Sharetribe listing resource
 * @returns {boolean} true when this listing must not take a new booking
 */
const isCalendarListingSwitchedOff = listing => {
  const publicData = listing?.attributes?.publicData || {};
  const hasCalendarSetup = Boolean(
    publicData.nylasConfigurationId || publicData.nylasConfigurationIds
  );
  return hasCalendarSetup && !publicData.calendarBookingEnabled;
};

/** Throws a 400 the checkout can name: "This coach isn't taking bookings right now." */
const assertCalendarListingBookable = listing => {
  if (isCalendarListingSwitchedOff(listing)) {
    const error = new Error('calendar-not-bookable');
    // Not a 409: the checkout reads a 409 as "that time was just taken".
    error.status = 400;
    error.statusText = 'calendar-not-bookable';
    error.data = {
      errors: [{ status: 400, code: 'calendar-not-bookable', title: 'calendar-not-bookable' }],
    };
    throw error;
  }
};

module.exports = {
  getProcessAliasProblem,
  assertProcessAliasMatchesListing,
  isCalendarListingSwitchedOff,
  assertCalendarListingBookable,
};
