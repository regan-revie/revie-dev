import { renderHook } from '@testing-library/react';

import { isConfirmingCalendarBooking, useConfirmingBookingPoll } from './useConfirmingBookingPoll';

const tx = (lastTransition, calendarBookingEnabled = true) => ({
  attributes: { lastTransition },
  listing: { attributes: { publicData: { calendarBookingEnabled } } },
});

describe('isConfirmingCalendarBooking()', () => {
  it('is true for a customer whose calendar booking is paid but unconfirmed', () => {
    expect(isConfirmingCalendarBooking(tx('transition/confirm-payment'), 'customer')).toBe(true);
  });

  it.each([
    ['accepted', 'transition/operator-accept'],
    ['declined because the booking failed', 'transition/operator-decline'],
    ['expired', 'transition/expire'],
    ['still pending payment', 'transition/request-payment'],
  ])('is false once %s', (_label, lastTransition) => {
    expect(isConfirmingCalendarBooking(tx(lastTransition), 'customer')).toBe(false);
  });

  it('is false for the coach', () => {
    expect(isConfirmingCalendarBooking(tx('transition/confirm-payment'), 'provider')).toBe(false);
  });

  it('is false for a listing that does not use calendar booking', () => {
    expect(isConfirmingCalendarBooking(tx('transition/confirm-payment', false), 'customer')).toBe(
      false
    );
  });

  it('copes with no transaction yet', () => {
    expect(isConfirmingCalendarBooking(null, 'customer')).toBe(false);
  });
});

describe('useConfirmingBookingPoll()', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('re-fetches every few seconds while the booking is being confirmed', () => {
    const refetch = jest.fn();
    renderHook(() =>
      useConfirmingBookingPoll({
        transaction: tx('transition/confirm-payment'),
        transactionRole: 'customer',
        refetch,
      })
    );
    expect(refetch).not.toHaveBeenCalled();
    jest.advanceTimersByTime(4000);
    expect(refetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(8000);
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it('stops as soon as the transaction moves on', () => {
    const refetch = jest.fn();
    const { rerender } = renderHook(
      ({ transaction }) =>
        useConfirmingBookingPoll({ transaction, transactionRole: 'customer', refetch }),
      { initialProps: { transaction: tx('transition/confirm-payment') } }
    );
    jest.advanceTimersByTime(4000);
    expect(refetch).toHaveBeenCalledTimes(1);

    rerender({ transaction: tx('transition/operator-accept') });
    jest.advanceTimersByTime(60000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after a few minutes rather than polling forever', () => {
    const refetch = jest.fn();
    renderHook(() =>
      useConfirmingBookingPoll({
        transaction: tx('transition/confirm-payment'),
        transactionRole: 'customer',
        refetch,
      })
    );
    jest.advanceTimersByTime(5 * 60 * 1000);
    const callsAtLimit = refetch.mock.calls.length;
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(refetch.mock.calls.length).toBe(callsAtLimit);
  });

  it('never polls for a provider or a non-calendar listing', () => {
    const refetch = jest.fn();
    renderHook(() =>
      useConfirmingBookingPoll({
        transaction: tx('transition/confirm-payment'),
        transactionRole: 'provider',
        refetch,
      })
    );
    jest.advanceTimersByTime(60000);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('cleans up its timer on unmount', () => {
    const refetch = jest.fn();
    const { unmount } = renderHook(() =>
      useConfirmingBookingPoll({
        transaction: tx('transition/confirm-payment'),
        transactionRole: 'customer',
        refetch,
      })
    );
    unmount();
    jest.advanceTimersByTime(60000);
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('useConfirmingBookingPoll(): asking the server to create the booking again', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const withId = lastTransition => ({ ...tx(lastTransition), id: { uuid: 'tx-1' } });

  it('asks once, ten seconds in, while the booking is still unconfirmed', async () => {
    const retry = jest.fn().mockResolvedValue({});
    renderHook(() =>
      useConfirmingBookingPoll({
        transaction: withId('transition/confirm-payment'),
        transactionRole: 'customer',
        refetch: jest.fn(),
        retryCreateBooking: retry,
      })
    );
    jest.advanceTimersByTime(9000);
    expect(retry).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1500);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith({ transactionId: 'tx-1' });

    // Only once, however long the page stays open.
    jest.advanceTimersByTime(120000);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('does not ask if the booking is confirmed before the ten seconds are up', () => {
    const retry = jest.fn().mockResolvedValue({});
    const { rerender } = renderHook(
      ({ transaction }) =>
        useConfirmingBookingPoll({
          transaction,
          transactionRole: 'customer',
          refetch: jest.fn(),
          retryCreateBooking: retry,
        }),
      { initialProps: { transaction: withId('transition/confirm-payment') } }
    );
    jest.advanceTimersByTime(6000);
    rerender({ transaction: withId('transition/operator-accept') });
    jest.advanceTimersByTime(60000);
    expect(retry).not.toHaveBeenCalled();
  });

  it('does not ask for the coach, or when the failure of the retry itself is swallowed', async () => {
    const retry = jest.fn().mockRejectedValue(new Error('403'));
    renderHook(() =>
      useConfirmingBookingPoll({
        transaction: withId('transition/confirm-payment'),
        transactionRole: 'provider',
        refetch: jest.fn(),
        retryCreateBooking: retry,
      })
    );
    jest.advanceTimersByTime(30000);
    expect(retry).not.toHaveBeenCalled();
  });

  it('survives a failing retry and refreshes the page afterwards', async () => {
    const retry = jest.fn().mockRejectedValue(new Error('403'));
    const refetch = jest.fn();
    renderHook(() =>
      useConfirmingBookingPoll({
        transaction: withId('transition/confirm-payment'),
        transactionRole: 'customer',
        refetch,
        retryCreateBooking: retry,
      })
    );
    jest.advanceTimersByTime(10500);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalled();
  });
});
