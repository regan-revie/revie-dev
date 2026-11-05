import { withStubbedFetch } from '../../../util/stubFetchForExamples';
import ManageCalendarBooking from './ManageCalendarBooking';

const hours = h => new Date(Date.now() + h * 3600000).toISOString();
const status = body => ({
  source: 'database',
  status: 'created',
  bookingStart: hours(72),
  bookingEnd: hours(73),
  freeCancellationNow: true,
  ...body,
});

const preview = body =>
  withStubbedFetch(ManageCalendarBooking, {
    '/api/nylas/booking-status': status(body),
    '/api/nylas/cancel-booking': { ok: true },
    '/api/nylas/availability': { slots: [], connected: true },
  });

const props = { transactionId: 'tx-preview', listingId: 'listing-preview' };

// "Your session" panel on the customer's order page, in each state it can be in.
export const MoreThan48HoursAway = { component: preview({}), props, group: 'booking' };
export const InsideTheFreeWindow = {
  component: preview({
    bookingStart: hours(12),
    bookingEnd: hours(13),
    freeCancellationNow: false,
  }),
  props,
  group: 'booking',
};
export const Cancelled = {
  component: preview({ status: 'cancelled', freeCancellation: true }),
  props,
  group: 'booking',
};
