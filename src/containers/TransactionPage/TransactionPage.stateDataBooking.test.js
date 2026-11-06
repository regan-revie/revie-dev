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

describe('a late-cancelled session on the transaction page', () => {
  const late = by => ({
    attributes: { metadata: { lateCancelledAt: '2026-11-05T23:49:33.000Z', cancelledBy: by } },
  });
  const dataFor = (processState, transactionRole, by = 'client') =>
    getStateDataForBookingProcess(
      { transaction: late(by), transactionRole, nextTransitions: [] },
      { ...processInfo, processState }
    );

  it('shows as cancelled, with the charge explained, instead of "You\'re booked"', () => {
    const data = dataFor(states.ACCEPTED, 'customer');
    expect(data.processState).toBe('late-cancelled');
    expect(data.showExtraInfo).toBe(true);
  });

  it('offers no review, link or button, once Sharetribe has auto-completed it', () => {
    ['customer', 'provider'].forEach(role => {
      const data = dataFor(states.DELIVERED, role);
      expect(data.processState).toBe('late-cancelled');
      expect(data.showActionButtons).toBeUndefined();
      expect(data.primaryButtonProps).toBeUndefined();
      expect(data.showReviewAsFirstLink).toBeUndefined();
    });
  });

  it('words the later completion as a charge and a payout, not a completed booking', () => {
    expect(dataFor(states.DELIVERED, 'customer').transitionMessages).toEqual([
      {
        transition: transitions.COMPLETE,
        translationId: 'TransactionPage.ActivityFeed.default-booking.late-cancelled-completed',
      },
    ]);
  });

  it('uses the coach-cancelled state when the coach cancelled', () => {
    expect(dataFor(states.ACCEPTED, 'provider', 'coach').processState).toBe(
      'late-cancelled-by-coach'
    );
  });

  it('is not triggered for an ordinary delivered booking', () => {
    const data = getStateDataForBookingProcess(
      { transaction: { attributes: { metadata: {} } }, transactionRole: 'customer' },
      { ...processInfo, processState: states.DELIVERED }
    );
    expect(data.processState).toBe(states.DELIVERED);
    expect(data.showActionButtons).toBe(true);
  });
});
