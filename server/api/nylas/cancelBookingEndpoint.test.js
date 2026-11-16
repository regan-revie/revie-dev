jest.mock('../../api-util/sdk', () => ({
  createCookieTokenStore: jest.fn(() => ({})),
  getSdk: jest.fn(() => ({})),
  handleError: jest.fn((res, e) => res.status(e.status).json({ error: e.message })),
}));
jest.mock('./config', () => ({ isConfigured: jest.fn(() => true) }));
jest.mock('./availability', () => ({ cancelBooking: jest.fn(async () => ({})) }));
jest.mock('./manageBookingShared', () => ({
  loadCalendarBookingTransaction: jest.fn(async () => ({ configurationId: 'cfg-1' })),
}));
jest.mock('./integration', () => ({
  updateTransactionMetadata: jest.fn(async () => ({ ok: true })),
}));
jest.mock('./db', () => ({
  isAvailable: jest.fn(() => true),
  findByTransactionId: jest.fn(async () => [{ nylas_booking_id: 'bk-1', status: 'created' }]),
  hasPendingEventCancellation: jest.fn(async () => false),
}));

const { cancelBooking } = require('./availability');
const { updateTransactionMetadata } = require('./integration');
const handler = require('./cancelBookingEndpoint');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Mock implementations do not survive between tests in this setup, so every one is set here.
  require('./config').isConfigured.mockReturnValue(true);
  require('./db').isAvailable.mockReturnValue(true);
  require('./db').findByTransactionId.mockResolvedValue([
    { nylas_booking_id: 'bk-1', status: 'created' },
  ]);
  require('./manageBookingShared').loadCalendarBookingTransaction.mockResolvedValue({
    configurationId: 'cfg-1',
  });
  require('./db').hasPendingEventCancellation.mockResolvedValue(false);
  cancelBooking.mockResolvedValue({});
  updateTransactionMetadata.mockResolvedValue({ ok: true });
});

describe('POST /api/nylas/cancel-booking', () => {
  it('notes that the customer asked before telling Nylas, so the webhook can attribute a late cancellation', async () => {
    const res = makeRes();
    await handler({ body: { transactionId: 'tx-1' } }, res);

    expect(updateTransactionMetadata).toHaveBeenCalledWith('tx-1', {
      cancelRequestedBy: 'customer',
    });
    expect(updateTransactionMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      cancelBooking.mock.invocationCallOrder[0]
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('refuses to cancel when the note cannot be written, so a late cancel is never refunded as a coach one', async () => {
    updateTransactionMetadata.mockResolvedValue({ ok: false, error: new Error('down') });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await handler({ body: { transactionId: 'tx-1' } }, res);

    expect(cancelBooking).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
    spy.mockRestore();
  });

  it('removes the note again when Nylas refuses, so a later calendar-side cancel is not blamed on the client', async () => {
    cancelBooking.mockRejectedValue(new Error('nylas down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await handler({ body: { transactionId: 'tx-1' } }, res);

    expect(updateTransactionMetadata).toHaveBeenLastCalledWith('tx-1', {
      cancelRequestedBy: null,
    });
    expect(res.status).toHaveBeenCalledWith(502);
    spy.mockRestore();
  });

  describe("while the coach's deletion of the event is in its five-minute wait", () => {
    beforeEach(() => {
      require('./db').hasPendingEventCancellation.mockResolvedValue(true);
    });

    it("refuses with the coach-is-cancelling message, and the client's cancel never reaches Nylas", async () => {
      const res = makeRes();
      await handler({ body: { transactionId: 'tx-1' } }, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        code: 'being-cancelled-by-coach',
        error: "This session is being cancelled by the coach. You'll get a full refund.",
      });
      expect(cancelBooking).not.toHaveBeenCalled();
    });

    it('never writes the "customer asked" note, so the coach cancellation can never be read as a late client cancel (which charges)', async () => {
      const res = makeRes();
      await handler({ body: { transactionId: 'tx-1' } }, res);
      expect(updateTransactionMetadata).not.toHaveBeenCalled();
    });

    it('asks about the booking that is actually active, not another one on the same transaction', async () => {
      require('./db').findByTransactionId.mockResolvedValue([
        { nylas_booking_id: 'old-cancelled', status: 'cancelled' },
        { nylas_booking_id: 'bk-2', status: 'created' },
      ]);
      await handler({ body: { transactionId: 'tx-1' } }, makeRes());
      expect(require('./db').hasPendingEventCancellation).toHaveBeenCalledWith('bk-2');
    });

    it('works as before once the wait is over (the coach put the event back)', async () => {
      require('./db').hasPendingEventCancellation.mockResolvedValue(false);
      const res = makeRes();
      await handler({ body: { transactionId: 'tx-1' } }, res);
      expect(cancelBooking).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
