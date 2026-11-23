const { hasEarlierPaidBooking, isKeptPaidBooking } = require('./eligibility');

const t = (...names) => names.map(transition => ({ transition }));
const tx = (id, ...names) => ({ id: { uuid: id }, attributes: { transitions: t(...names) } });

describe('which bookings count as an earlier paid booking', () => {
  const PAY = ['transition/request-payment', 'transition/confirm-payment'];

  it('counts a booking that was paid and accepted', () => {
    expect(isKeptPaidBooking(t(...PAY, 'transition/operator-accept'))).toBe(true);
  });

  it('counts a completed and a late-cancelled booking (the client was charged)', () => {
    expect(isKeptPaidBooking(t(...PAY, 'transition/operator-accept', 'transition/complete'))).toBe(
      true
    );
    expect(
      isKeptPaidBooking(t(...PAY, 'transition/operator-accept', 'transition/late-cancel'))
    ).toBe(true);
  });

  it('counts a paid booking still waiting for its calendar booking', () => {
    expect(isKeptPaidBooking(t(...PAY))).toBe(true);
  });

  it('does not count one that was refunded in full', () => {
    ['transition/cancel', 'transition/operator-decline', 'transition/expire'].forEach(refund =>
      expect(isKeptPaidBooking(t(...PAY, refund))).toBe(false)
    );
  });

  it('does not count one that never got past payment', () => {
    expect(isKeptPaidBooking(t('transition/request-payment'))).toBe(false);
    expect(isKeptPaidBooking(t('transition/request-payment', 'transition/expire-payment'))).toBe(
      false
    );
    expect(isKeptPaidBooking([])).toBe(false);
    expect(isKeptPaidBooking(undefined)).toBe(false);
  });
});

describe("looking through the client's own orders", () => {
  const pages = (...orderPages) => {
    const query = jest.fn(async ({ page }) => ({
      data: { data: orderPages[page - 1], meta: { totalPages: orderPages.length } },
    }));
    return { transactions: { query } };
  };

  it("asks only for orders, so it can only ever see the caller's own", async () => {
    const sdk = pages([]);
    await hasEarlierPaidBooking(sdk);
    expect(sdk.transactions.query).toHaveBeenCalledWith(expect.objectContaining({ only: 'order' }));
  });

  it('is false for a client with no orders or only abandoned ones', async () => {
    expect(await hasEarlierPaidBooking(pages([]))).toBe(false);
    expect(await hasEarlierPaidBooking(pages([tx('a', 'transition/request-payment')]))).toBe(false);
  });

  it('is true when any order, on any page, was paid and kept', async () => {
    const sdk = pages(
      [tx('a', 'transition/request-payment')],
      [
        tx(
          'b',
          'transition/request-payment',
          'transition/confirm-payment',
          'transition/operator-accept'
        ),
      ]
    );
    expect(await hasEarlierPaidBooking(sdk)).toBe(true);
    expect(sdk.transactions.query).toHaveBeenCalledTimes(2);
  });

  it('can ignore the booking being created', async () => {
    const sdk = pages([tx('now', 'transition/request-payment', 'transition/confirm-payment')]);
    expect(await hasEarlierPaidBooking(sdk, { excludeTransactionId: 'now' })).toBe(false);
  });

  it('errs towards "has booked before" if there are too many orders to read', async () => {
    const query = jest.fn(async () => ({
      data: { data: [tx('x', 'transition/request-payment')], meta: { totalPages: 99 } },
    }));
    expect(await hasEarlierPaidBooking({ transactions: { query } })).toBe(true);
    expect(query).toHaveBeenCalledTimes(10);
  });
});
