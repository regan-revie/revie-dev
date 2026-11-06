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

  it('still cancels when the note cannot be written', async () => {
    updateTransactionMetadata.mockResolvedValue({ ok: false, error: new Error('down') });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await handler({ body: { transactionId: 'tx-1' } }, res);

    expect(cancelBooking).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
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
});
