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

describe('inbox state data for a late-cancelled session', () => {
  const late = by => ({
    attributes: { metadata: { lateCancelledAt: '2026-11-05T23:49:33.000Z', cancelledBy: by } },
  });
  const lateDataFor = (processState, transactionRole, by = 'client') =>
    getStateDataForBookingProcess(
      { transactionRole, transaction: late(by) },
      { processName: 'default-booking', processState, states }
    );

  it('is a finished cancelled session, not "Booked", while Sharetribe still says accepted', () => {
    expect(lateDataFor(states.ACCEPTED, 'customer')).toEqual({
      processName: 'default-booking',
      processState: 'late-cancelled',
      isFinal: true,
    });
  });

  it('never asks the client to review it, or makes the coach wait for a review, once it auto-completes', () => {
    const client = lateDataFor(states.DELIVERED, 'customer');
    const coach = lateDataFor(states.DELIVERED, 'provider');
    [client, coach].forEach(d => {
      expect(d.processState).toBe('late-cancelled');
      expect(d.actionNeeded).toBeFalsy();
      expect(d.isWaiting).toBeFalsy();
    });
  });

  it('shows the real release-4 states the same way, with nothing to do in either', () => {
    [states.LATE_CANCELLED, states.LATE_CANCELLED_COMPLETED].forEach(state => {
      ['customer', 'provider'].forEach(role => {
        const data = getStateDataForBookingProcess(
          { transactionRole: role, transaction: { attributes: { metadata: {} } } },
          { processName: 'default-booking', processState: state, states }
        );
        expect(data).toEqual({
          processName: 'default-booking',
          processState: 'late-cancelled',
          isFinal: true,
        });
      });
    });
  });

  it('leaves an ordinary booking alone', () => {
    const data = getStateDataForBookingProcess(
      { transactionRole: 'customer', transaction: { attributes: { metadata: {} } } },
      { processName: 'default-booking', processState: states.DELIVERED, states }
    );
    expect(data.actionNeeded).toBe(true);
  });
});
