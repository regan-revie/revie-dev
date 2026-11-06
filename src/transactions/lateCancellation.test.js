import { getLateCancellation, isLateCancelled } from './lateCancellation';

const tx = metadata => ({ attributes: { metadata } });

describe('getLateCancellation()', () => {
  it('reads when and by whom from the transaction metadata', () => {
    const result = getLateCancellation(
      tx({ lateCancelledAt: '2026-11-05T23:49:33.000Z', cancelledBy: 'client' })
    );
    expect(result.by).toBe('client');
    expect(result.at.toISOString()).toBe('2026-11-05T23:49:33.000Z');
  });

  it('reports a provider cancellation as such', () => {
    expect(
      getLateCancellation(
        tx({ lateCancelledAt: '2026-11-05T23:49:33.000Z', cancelledBy: 'provider' })
      ).by
    ).toBe('provider');
  });

  it('is null for ordinary transactions, missing metadata and unreadable dates', () => {
    expect(getLateCancellation(tx({}))).toBeNull();
    expect(getLateCancellation(tx({ cancelRequestedBy: 'customer' }))).toBeNull();
    expect(getLateCancellation({})).toBeNull();
    expect(getLateCancellation(null)).toBeNull();
    expect(isLateCancelled(tx({ lateCancelledAt: 'not a date' }))).toBe(false);
  });
});
