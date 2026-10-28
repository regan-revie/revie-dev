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
    expect(path).toBe('/v3/grants/g/events/ev-1?calendar_id=cal%40example.com');
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
});
