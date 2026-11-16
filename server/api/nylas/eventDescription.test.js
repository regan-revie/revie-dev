jest.mock('../../log', () => ({ error: jest.fn() }));
const log = require('../../log');
const { describeBookedEvent } = require('./eventDescription');

const params = overrides => ({
  grantId: 'g',
  calendarId: 'cal@example.com',
  eventId: 'ev-1',
  clientName: 'Grace',
  transactionId: 'tx-1',
  siteUrl: 'https://revie.example',
  request: jest.fn(async () => ({})),
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('describeBookedEvent()', () => {
  it("writes the client's name and a link to their own session onto the event", async () => {
    const p = params();
    expect(await describeBookedEvent(p)).toBe(true);
    const [path, options] = p.request.mock.calls[0];
    expect(path).toBe(
      '/v3/grants/g/events/ev-1?calendar_id=cal%40example.com&notify_participants=false'
    );
    expect(options.method).toBe('PUT');
    expect(options.body.description).toContain('Client: Grace');
    expect(options.body.description).toContain('https://revie.example/order/tx-1');
  });

  it('does nothing, quietly, when it lacks the event, calendar or grant', async () => {
    for (const missing of ['grantId', 'calendarId', 'eventId']) {
      const p = params({ [missing]: undefined });
      // eslint-disable-next-line no-await-in-loop
      expect(await describeBookedEvent(p)).toBe(false);
      expect(p.request).not.toHaveBeenCalled();
    }
    expect(log.error).not.toHaveBeenCalled();
  });

  it('never throws: a failure costs a plainer invite, not the booking', async () => {
    const p = params({
      request: jest.fn(async () => {
        throw new Error('nylas down');
      }),
    });
    await expect(describeBookedEvent(p)).resolves.toBe(false);
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-event-description-failed', {
      transactionId: 'tx-1',
    });
  });

  describe('no second invitation', () => {
    it('updates the event without notifying the guests (Google would otherwise send an "Updated invitation")', async () => {
      const p = params();
      await describeBookedEvent(p);
      expect(p.request.mock.calls[0][0]).toMatch(/[?&]notify_participants=false(&|$)/);
    });

    it('sends the description and nothing else: no conferencing, times or participants are rewritten', async () => {
      const p = params();
      await describeBookedEvent(p);
      expect(Object.keys(p.request.mock.calls[0][1].body)).toEqual(['description']);
    });

    it('makes one update per booking, not one per field', async () => {
      const p = params();
      await describeBookedEvent(p);
      expect(p.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate limits (429)', () => {
    const rateLimited = () =>
      Object.assign(new Error('Nylas PUT failed with status 429'), { status: 429 });

    it('is retried after a short pause and then succeeds, without reporting anything', async () => {
      const sleep = jest.fn(async () => {});
      const request = jest
        .fn()
        .mockRejectedValueOnce(rateLimited())
        .mockResolvedValueOnce({});
      expect(await describeBookedEvent(params({ request, sleep }))).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(1000);
      expect(log.error).not.toHaveBeenCalled();
    });

    it('is retried twice at most, then reported once and given up on, never throwing', async () => {
      const sleep = jest.fn(async () => {});
      const request = jest.fn().mockRejectedValue(rateLimited());
      await expect(describeBookedEvent(params({ request, sleep }))).resolves.toBe(false);
      expect(request).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'nylas-event-description-failed', {
        transactionId: 'tx-1',
      });
    });

    it('is not retried for any other failure', async () => {
      const sleep = jest.fn(async () => {});
      const request = jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));
      await expect(describeBookedEvent(params({ request, sleep }))).resolves.toBe(false);
      expect(request).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  });
});
