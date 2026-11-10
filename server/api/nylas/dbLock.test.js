// The pg Pool is mocked: these assert the lock protocol (try, run, always unlock, always release),
// not Postgres itself.
const mockClient = { query: jest.fn(), release: jest.fn() };
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(async () => mockClient),
    query: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  })),
}));

const load = url => {
  let db;
  jest.isolateModules(() => {
    const original = process.env.DATABASE_URL;
    if (url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = url;
    db = require('./db');
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });
  return db;
};

const URL = 'postgres://user:pw@localhost:5432/revie_dev';

beforeEach(() => {
  mockClient.query.mockReset();
  mockClient.release.mockReset();
});

describe('withAdvisoryLock()', () => {
  it('runs the function and unlocks when it gets the lock', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ got: true }] });
    const fn = jest.fn(async () => 'done');
    const out = await load(URL).withAdvisoryLock('coach:1', fn);

    expect(out).toEqual({ locked: true, value: 'done' });
    expect(mockClient.query.mock.calls[0][0]).toMatch(/pg_try_advisory_lock/);
    expect(mockClient.query.mock.calls[1][0]).toMatch(/pg_advisory_unlock/);
    expect(mockClient.release).toHaveBeenCalledWith(false);
  });

  it('does not run the function when somebody else holds the lock', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ got: false }] });
    const fn = jest.fn();
    const out = await load(URL).withAdvisoryLock('coach:1', fn);

    expect(out).toEqual({ locked: false });
    expect(fn).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('still unlocks and releases when the function throws', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ got: true }] });
    await expect(
      load(URL).withAdvisoryLock('coach:1', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(mockClient.query.mock.calls[1][0]).toMatch(/pg_advisory_unlock/);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('throws the connection away if it could not unlock, so the lock cannot leak back into the pool', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ got: true }] })
      .mockRejectedValueOnce(new Error('connection lost'));
    await load(URL).withAdvisoryLock('coach:1', async () => 1);
    expect(mockClient.release).toHaveBeenCalledWith(true);
  });

  it('just runs the function when there is no database (local development)', async () => {
    const out = await load(undefined).withAdvisoryLock('coach:1', async () => 7);
    expect(out).toEqual({ locked: true, value: 7 });
  });
});
