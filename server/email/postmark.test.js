const postmark = require('./postmark');

const okResponse = body => ({ ok: true, status: 200, json: async () => body });

describe('sendTemplateEmail()', () => {
  const OLD = process.env.POSTMARK_SERVER_TOKEN;
  beforeEach(() => {
    process.env.POSTMARK_SERVER_TOKEN = 'a-secret-server-token';
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.POSTMARK_SERVER_TOKEN;
    else process.env.POSTMARK_SERVER_TOKEN = OLD;
  });

  it('sends by template alias from Revie, with the model, to the transactional stream', async () => {
    const fetchFn = jest.fn(async () => okResponse({ ErrorCode: 0, MessageID: 'm-1' }));
    const result = await postmark.sendTemplateEmail({
      to: 'client@example.com',
      templateAlias: 'session-reminder-client',
      model: { sessionName: 'Find your focus' },
      tag: 'reminder',
      fetchFn,
    });

    const [url, options] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.postmarkapp.com/email/withTemplate');
    expect(options.method).toBe('POST');
    expect(options.headers['X-Postmark-Server-Token']).toBe('a-secret-server-token');
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      From: 'Revie <hello@heyrevie.com>',
      To: 'client@example.com',
      TemplateAlias: 'session-reminder-client',
      TemplateModel: { sessionName: 'Find your focus' },
      MessageStream: 'outbound',
      Tag: 'reminder',
    });
    expect(result).toEqual({ messageId: 'm-1' });
  });

  it('treats an HTTP error as a failure, with no body, address, model or token in the message', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ ErrorCode: 406, Message: 'Inactive recipient client@example.com' }),
    }));
    const error = await postmark
      .sendTemplateEmail({
        to: 'client@example.com',
        templateAlias: 'session-reminder-client',
        model: { recipientName: 'Alex' },
        fetchFn,
      })
      .catch(e => e);

    expect(error.status).toBe(422);
    expect(error.postmarkCode).toBe(406);
    expect(error.message).toContain('session-reminder-client');
    expect(error.message).not.toContain('example.com');
    expect(error.message).not.toContain('Alex');
    expect(error.message).not.toContain('a-secret-server-token');
  });

  it('treats a 200 that carries an error code as a failure too', async () => {
    const fetchFn = jest.fn(async () => okResponse({ ErrorCode: 1101, Message: 'bad template' }));
    await expect(
      postmark.sendTemplateEmail({ to: 'a@b.co', templateAlias: 'x', model: {}, fetchFn })
    ).rejects.toThrow(/code 1101/);
  });

  it('refuses to run without a token', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN;
    await expect(
      postmark.sendTemplateEmail({
        to: 'a@b.co',
        templateAlias: 'x',
        model: {},
        fetchFn: jest.fn(),
      })
    ).rejects.toThrow('POSTMARK_SERVER_TOKEN is not set');
  });
});

describe('sending switch', () => {
  const OLD = process.env.POSTMARK_SENDING_ENABLED;
  afterEach(() => {
    if (OLD === undefined) delete process.env.POSTMARK_SENDING_ENABLED;
    else process.env.POSTMARK_SENDING_ENABLED = OLD;
  });

  it('is off unless the value is exactly "true"', () => {
    delete process.env.POSTMARK_SENDING_ENABLED;
    expect(postmark.isSendingEnabled()).toBe(false);
    ['false', '', '1', 'yes', 'TRUE', 'True'].forEach(v => {
      process.env.POSTMARK_SENDING_ENABLED = v;
      expect(postmark.isSendingEnabled()).toBe(false);
    });
    process.env.POSTMARK_SENDING_ENABLED = 'true';
    expect(postmark.isSendingEnabled()).toBe(true);
  });
});

describe('domainOf()', () => {
  it('keeps only the domain, for logs', () => {
    expect(postmark.domainOf('Someone.Name@Example.COM')).toBe('example.com');
    expect(postmark.domainOf('nonsense')).toBe('unknown');
    expect(postmark.domainOf(undefined)).toBe('unknown');
  });
});
