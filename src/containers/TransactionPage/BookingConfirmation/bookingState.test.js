import { getBookingPageState } from './bookingState';

describe('getBookingPageState', () => {
  it.each([
    ['preauthorized', 'confirming'],
    ['declined', 'declined'],
    ['expired', 'declined'],
    ['payment-expired', 'declined'],
    ['accepted', 'live'],
    ['delivered', 'done'],
    ['reviewed', 'done'],
    ['reviewed-by-customer', 'done'],
  ])('%s is %s', (processState, kind) => {
    expect(getBookingPageState({ processState })).toEqual({ kind });
  });

  it('leaves what it has no design for (an inquiry, an unconfirmed payment) to the template page', () => {
    expect(getBookingPageState({ processState: 'inquiry' }).kind).toBeNull();
    expect(getBookingPageState({ processState: 'pending-payment' }).kind).toBeNull();
  });

  describe('cancelled', () => {
    it('a late cancellation is "late"', () => {
      expect(getBookingPageState({ processState: 'late-cancelled' })).toEqual({
        kind: 'cancelled',
        cancel: 'late',
      });
    });

    it('a cancellation the coach made is "coach"; the client\'s own is "refunded"', () => {
      expect(
        getBookingPageState({ processState: 'canceled', metadata: { cancelledBy: 'provider' } })
      ).toEqual({ kind: 'cancelled', cancel: 'coach' });
      expect(
        getBookingPageState({ processState: 'canceled', metadata: { cancelledBy: 'client' } })
      ).toEqual({ kind: 'cancelled', cancel: 'refunded' });
      // No note on an older transaction: refunded either way.
      expect(getBookingPageState({ processState: 'canceled', metadata: {} }).cancel).toBe(
        'refunded'
      );
    });

    it('right after cancelling here, the card knows before the transaction does', () => {
      const state = calendarView => getBookingPageState({ processState: 'accepted', calendarView });
      expect(state({ isCancelled: true, cancelFree: true }).cancel).toBe('refunded');
      expect(state({ isCancelled: true, cancelFree: false }).cancel).toBe('late');
      expect(state({ isCancelled: true, cancelFree: null }).cancel).toBe('unknown');
      expect(state({ isCancelled: false })).toEqual({ kind: 'live' });
    });
  });
});
