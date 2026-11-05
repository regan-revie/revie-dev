const { verifyCaller } = require('./verifyCaller');

const CUSTOMER = 'customer-uuid-1';
const OTHER = 'someone-else-uuid';
const TX = 'tx-uuid-1';

const sdkWithOrders = ids => ({
  transactions: {
    query: jest.fn(async () => ({ data: { data: ids.map(uuid => ({ id: { uuid } })) } })),
  },
});

describe('verifyCaller()', () => {
  it('lets the paying customer through', async () => {
    const sdk = sdkWithOrders([]);
    await expect(
      verifyCaller({ sdk, transactionId: TX, customerId: CUSTOMER, callerId: CUSTOMER })
    ).resolves.toEqual({ ok: true });
    // The relationship was there, so no extra Sharetribe call is needed.
    expect(sdk.transactions.query).not.toHaveBeenCalled();
  });

  it('still refuses a different user when the customer is known', async () => {
    const sdk = sdkWithOrders([TX]);
    const verdict = await verifyCaller({
      sdk,
      transactionId: TX,
      customerId: CUSTOMER,
      callerId: OTHER,
    });
    expect(verdict).toEqual({ ok: false, reason: 'not-the-customer' });
    // A known customer is never second-guessed by the fallback, even if the order list says yes.
    expect(sdk.transactions.query).not.toHaveBeenCalled();
  });

  describe('when the customer relationship is missing', () => {
    it('does not treat that as "not the customer": the caller\'s own orders settle it', async () => {
      const sdk = sdkWithOrders(['other-tx', TX]);
      await expect(
        verifyCaller({ sdk, transactionId: TX, customerId: null, callerId: CUSTOMER })
      ).resolves.toEqual({ ok: true });
      expect(sdk.transactions.query).toHaveBeenCalledWith(
        expect.objectContaining({ only: 'order' })
      );
    });

    it('still refuses a caller who has no such order', async () => {
      const sdk = sdkWithOrders(['other-tx']);
      const verdict = await verifyCaller({
        sdk,
        transactionId: TX,
        customerId: null,
        callerId: OTHER,
      });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toBe('customer-unknown-and-not-in-callers-orders');
    });

    it('lets a Sharetribe failure surface rather than turning it into a refusal', async () => {
      const sdk = { transactions: { query: jest.fn().mockRejectedValue(new Error('boom')) } };
      await expect(
        verifyCaller({ sdk, transactionId: TX, customerId: null, callerId: CUSTOMER })
      ).rejects.toThrow('boom');
    });
  });
});
