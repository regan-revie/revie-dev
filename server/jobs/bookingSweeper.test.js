jest.mock('../api/nylas/db', () => ({ isAvailable: jest.fn(() => true) }));
jest.mock('../api/nylas/integration', () => ({
  isConfigured: jest.fn(() => true),
  findPaidUnconfirmedTransactions: jest.fn(),
}));
jest.mock('../api/nylas/bookingRecovery', () => ({ ensureBooking: jest.fn() }));
jest.mock('../log', () => ({ error: jest.fn() }));

const db = require('../api/nylas/db');
const integration = require('../api/nylas/integration');
const { ensureBooking } = require('../api/nylas/bookingRecovery');
const log = require('../log');
const { runBookingSweep } = require('./bookingSweeper');

beforeEach(() => {
  jest.clearAllMocks();
  db.isAvailable.mockReturnValue(true);
  integration.isConfigured.mockReturnValue(true);
  integration.findPaidUnconfirmedTransactions.mockResolvedValue([]);
  ensureBooking.mockResolvedValue({ outcome: 'booked' });
});

describe('runBookingSweep()', () => {
  it('hands every paid-but-unconfirmed transaction to the recovery routine, tagged as the sweeper', async () => {
    integration.findPaidUnconfirmedTransactions.mockResolvedValue(['tx-1', 'tx-2']);
    ensureBooking
      .mockResolvedValueOnce({ outcome: 'booked' })
      .mockResolvedValueOnce({ outcome: 'declined' });

    const result = await runBookingSweep();

    expect(ensureBooking).toHaveBeenNthCalledWith(1, { transactionId: 'tx-1', source: 'sweeper' });
    expect(ensureBooking).toHaveBeenNthCalledWith(2, { transactionId: 'tx-2', source: 'sweeper' });
    expect(result).toEqual({ checked: 2, outcomes: { booked: 1, declined: 1 } });
  });

  it('only looks at transactions older than the cut-off, so it stays clear of live checkouts', async () => {
    await runBookingSweep();
    expect(integration.findPaidUnconfirmedTransactions).toHaveBeenCalledWith({
      olderThanMinutes: 3,
    });
  });

  it('does one transaction at a time', async () => {
    integration.findPaidUnconfirmedTransactions.mockResolvedValue(['a', 'b', 'c']);
    let inFlight = 0;
    let maxInFlight = 0;
    ensureBooking.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      inFlight -= 1;
      return { outcome: 'booked' };
    });
    await runBookingSweep();
    expect(maxInFlight).toBe(1);
  });

  it('keeps going, and reports, when one transaction blows up', async () => {
    integration.findPaidUnconfirmedTransactions.mockResolvedValue(['tx-1', 'tx-2']);
    ensureBooking
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ outcome: 'booked' });
    const result = await runBookingSweep();
    expect(result.outcomes).toEqual({ booked: 1 });
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-booking-sweep-item-failed', {
      transactionId: 'tx-1',
    });
  });

  it('does nothing without a database or Integration API credentials', async () => {
    db.isAvailable.mockReturnValue(false);
    expect(await runBookingSweep()).toEqual({ skipped: true, checked: 0, outcomes: {} });
    db.isAvailable.mockReturnValue(true);
    integration.isConfigured.mockReturnValue(false);
    expect((await runBookingSweep()).skipped).toBe(true);
    expect(integration.findPaidUnconfirmedTransactions).not.toHaveBeenCalled();
  });
});
