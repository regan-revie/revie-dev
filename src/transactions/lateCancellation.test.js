import { getLateCancellation, isLateCancelled, lateCancelledState } from './lateCancellation';

const tx = metadata => ({ attributes: { metadata } });

describe('getLateCancellation()', () => {
  it('reads when and by whom from the transaction metadata', () => {
    const result = getLateCancellation(
      tx({ lateCancelledAt: '2026-11-05T23:49:33.000Z', cancelledBy: 'client' })
    );
    expect(result.by).toBe('client');
    expect(result.at.toISOString()).toBe('2026-11-05T23:49:33.000Z');
  });

  it('treats anything but "client" as the coach, since only the coach can cancel from a calendar', () => {
    expect(getLateCancellation(tx({ lateCancelledAt: '2026-11-05T23:49:33.000Z' })).by).toBe(
      'coach'
    );
  });

  it('is null for ordinary transactions, missing metadata and unreadable dates', () => {
    expect(getLateCancellation(tx({}))).toBeNull();
    expect(getLateCancellation(tx({ cancelRequestedBy: 'customer' }))).toBeNull();
    expect(getLateCancellation({})).toBeNull();
    expect(getLateCancellation(null)).toBeNull();
    expect(isLateCancelled(tx({ lateCancelledAt: 'not a date' }))).toBe(false);
  });
});

describe('lateCancelledState()', () => {
  it('picks the state by who cancelled', () => {
    expect(
      lateCancelledState(tx({ lateCancelledAt: '2026-11-05T23:49:33.000Z', cancelledBy: 'client' }))
    ).toBe('late-cancelled');
    expect(
      lateCancelledState(tx({ lateCancelledAt: '2026-11-05T23:49:33.000Z', cancelledBy: 'coach' }))
    ).toBe('late-cancelled-by-coach');
  });
});
