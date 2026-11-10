/**
 * The Sharetribe availability plan every calendar listing carries. Lives in its own file because
 * both enableListing.js (a coach, explicitly) and ensureBookable.js (the server, automatically)
 * need it, and one requiring the other would be circular.
 */

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * A deliberately wide-open Sharetribe availability plan.
 *
 * Two separate problems are solved by this, and each would be a silent failure on its own:
 *
 *  - `:action/create-pending-booking` validates the requested time against Sharetribe's own
 *    availability plan. Nylas is the real authority on when a coach is free, so Sharetribe must not
 *    second-guess it: an empty plan would reject every booking Nylas had just offered, surfacing as
 *    a confusing "not available" at checkout.
 *  - `OrderPanel` derives `timeZone` from `availabilityPlan.timezone` and renders **no booking form
 *    at all** without it. So the plan also carries the coach's working-hours timezone, which is also
 *    the zone the availability endpoint reads their hours in.
 */
const permissiveAvailabilityPlan = timezone => ({
  type: 'availability-plan/time',
  timezone,
  entries: WEEKDAYS.map(dayOfWeek => ({
    dayOfWeek,
    startTime: '00:00',
    // End of day is '00:00', not '24:00'. The Marketplace API rejects '24:00' outright with "End
    // time must be in hh:mm format", and '23:59' with "End time must be a multiple of 5 minutes".
    // '24:00' is only the template's *internal* representation - see EditListingAvailabilityPanel.js,
    // which converts it to '00:00' on the way to the API and back again on the way out.
    endTime: '00:00',
    seats: 1,
  })),
});

module.exports = { WEEKDAYS, permissiveAvailabilityPlan };
