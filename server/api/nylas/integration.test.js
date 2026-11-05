const mockQuery = jest.fn();

jest.mock('sharetribe-flex-integration-sdk', () => ({
  createInstance: () => ({ transactions: { query: mockQuery } }),
}));

process.env.SHARETRIBE_INTEGRATION_CLIENT_ID = 'id';
process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET = 'secret';
const { findPaidUnconfirmedTransactions } = require('./integration');

const tx = (id, secondsAgo) => ({
  id: { uuid: id },
  attributes: { lastTransitionedAt: new Date(Date.now() - secondsAgo * 1000) },
});

beforeEach(() => mockQuery.mockReset());

describe('findPaidUnconfirmedTransactions()', () => {
  it('returns only transactions older than the cutoff, filtering in our own code', async () => {
    mockQuery.mockResolvedValue({
      data: {
        data: [tx('fresh', 30), tx('almost', 110), tx('old', 130), tx('ancient', 3600)],
        meta: { totalPages: 1 },
      },
    });
    const ids = await findPaidUnconfirmedTransactions({ olderThanMinutes: 2 });
    expect(ids).toEqual(['old', 'ancient']);
  });

  it('does not rely on the API parameter that is silently ignored', async () => {
    mockQuery.mockResolvedValue({ data: { data: [], meta: { totalPages: 1 } } });
    await findPaidUnconfirmedTransactions();
    const params = mockQuery.mock.calls[0][0];
    expect(params).not.toHaveProperty('lastTransitionedAtEnd');
    expect(params.lastTransitions).toEqual(['transition/confirm-payment']);
  });

  it('defaults to a two-minute cutoff', async () => {
    mockQuery.mockResolvedValue({
      data: { data: [tx('a', 100), tx('b', 125)], meta: { totalPages: 1 } },
    });
    expect(await findPaidUnconfirmedTransactions()).toEqual(['b']);
  });

  it('leaves a transaction it cannot date for a later run', async () => {
    mockQuery.mockResolvedValue({
      data: { data: [{ id: { uuid: 'undated' }, attributes: {} }], meta: { totalPages: 1 } },
    });
    expect(await findPaidUnconfirmedTransactions()).toEqual([]);
  });

  it('reads every page', async () => {
    mockQuery
      .mockResolvedValueOnce({ data: { data: [tx('p1', 600)], meta: { totalPages: 2 } } })
      .mockResolvedValueOnce({ data: { data: [tx('p2', 600)], meta: { totalPages: 2 } } });
    expect(await findPaidUnconfirmedTransactions()).toEqual(['p1', 'p2']);
  });
});
