import { getStateDataForBookingProcess } from './TransactionPage.stateDataBooking';
import { getStateDataForBookingProcess as getInboxStateData } from '../InboxPage/InboxPage.stateDataBooking';
import * as bookingProcess from '../../transactions/transactionProcessBooking';

const { states, transitions } = bookingProcess;

const processInfo = {
  processName: 'default-booking',
  processState: states.PREAUTHORIZED,
  states,
  transitions,
  isCustomer: false,
  actionButtonProps: (name, role) => ({ transitionName: name, role }),
  leaveReviewProps: {},
};

const next = (...names) => names.map(name => ({ attributes: { name } }));

describe('a coach looking at a paid-but-unconfirmed booking', () => {
  it('is offered no Accept or Decline on a release-2 transaction (no provider transitions)', () => {
    const data = getStateDataForBookingProcess(
      { transaction: {}, transactionRole: 'provider', nextTransitions: [] },
      processInfo
    );
    expect(data.showActionButtons).toBeUndefined();
    expect(data.primaryButtonProps).toBeUndefined();
    expect(data.secondaryButtonProps).toBeUndefined();
  });

  it('still sees the buttons on an older release-1 transaction that allows them', () => {
    const data = getStateDataForBookingProcess(
      {
        transaction: {},
        transactionRole: 'provider',
        nextTransitions: next(transitions.ACCEPT, transitions.DECLINE),
      },
      processInfo
    );
    expect(data.showActionButtons).toBe(true);
    expect(data.primaryButtonProps.transitionName).toBe(transitions.ACCEPT);
    expect(data.secondaryButtonProps.transitionName).toBe(transitions.DECLINE);
  });
});

describe("what raises a coach's inbox badge", () => {
  it("no state needs the coach's attention any more", () => {
    expect(bookingProcess.statesNeedingProviderAttention).toEqual([]);
  });

  it('a paid-but-unconfirmed booking is not an action-needed sale notification', () => {
    const data = getInboxStateData(
      { transactionRole: 'provider' },
      { processName: 'default-booking', processState: states.PREAUTHORIZED, states }
    );
    expect(data.actionNeeded).toBeUndefined();
    expect(data.isSaleNotification).toBeUndefined();
  });
});
