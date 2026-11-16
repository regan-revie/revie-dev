import * as booking from './transactionProcessBooking';
import { getProcess } from './transaction';

describe('release-6 transition/update-booking in the client graph', () => {
  const { transitions, states } = booking;
  const process = getProcess('default-booking');

  it('keeps the transaction in the accepted state: a moved session is still an accepted one', () => {
    // Without this the page cannot tell what state a transaction is in once update-booking is its
    // last transition, and the cancel/reschedule card and the order page stop working.
    expect(process.getStateAfterTransition(transitions.UPDATE_BOOKING)).toBe(states.ACCEPTED);
    const tx = { attributes: { lastTransition: transitions.UPDATE_BOOKING, transitions: [] } };
    expect(process.getState(tx)).toBe(states.ACCEPTED);
  });

  it('is not listed in the Activity feed as a transition of its own (the move has its own line)', () => {
    expect(booking.isRelevantPastTransition(transitions.UPDATE_BOOKING)).toBe(false);
  });

  it('is not a customer-run or privileged transition: the server runs it', () => {
    expect(booking.isPrivileged(transitions.UPDATE_BOOKING)).toBe(false);
  });
});
