import { getProcess } from '../../transactions/transaction';
import { getStateDataForBookingProcess } from './InboxPage.stateDataBooking';

const { states } = getProcess('default-booking');
const dataFor = (processState, transactionRole) =>
  getStateDataForBookingProcess(
    { transactionRole },
    { processName: 'default-booking', processState, states }
  );

describe('inbox state data for calendar bookings', () => {
  it('asks the client to review after the session (an orange tag) but only makes the coach wait', () => {
    expect(dataFor(states.DELIVERED, 'customer')).toMatchObject({ actionNeeded: true });
    const coach = dataFor(states.DELIVERED, 'provider');
    expect(coach.actionNeeded).toBeFalsy();
    expect(coach.isWaiting).toBe(true);
  });

  it('follows the same pattern once one side has reviewed', () => {
    expect(dataFor(states.REVIEWED_BY_PROVIDER, 'customer').actionNeeded).toBe(true);
    expect(dataFor(states.REVIEWED_BY_PROVIDER, 'provider').isWaiting).toBe(true);
    expect(dataFor(states.REVIEWED_BY_CUSTOMER, 'provider').actionNeeded).toBe(true);
    expect(dataFor(states.REVIEWED_BY_CUSTOMER, 'customer').isWaiting).toBe(true);
  });

  it('does not tag a confirmed booking as something to act on', () => {
    expect(dataFor(states.ACCEPTED, 'customer').actionNeeded).toBeFalsy();
    expect(dataFor(states.ACCEPTED, 'provider').actionNeeded).toBeFalsy();
  });
});
