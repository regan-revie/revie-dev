import { isNetworkError, withNetworkRetry } from './networkError';

const networkFailure = () => new TypeError('Failed to fetch');

describe('isNetworkError()', () => {
  it("recognises each browser's wording", () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(
      true
    );
  });

  it('recognises the plain object storableError keeps in Redux', () => {
    expect(isNetworkError({ type: 'error', name: 'TypeError', message: 'Failed to fetch' })).toBe(
      true
    );
  });

  it('does not mistake a server answer for a network failure', () => {
    expect(isNetworkError({ name: 'TypeError', message: 'Failed to fetch', status: 500 })).toBe(
      false
    );
    expect(isNetworkError({ name: 'Error', message: 'Failed to fetch' })).toBe(false);
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false);
  });

  it('is false for nothing', () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe('withNetworkRetry()', () => {
  it('returns the first result without retrying when nothing fails', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    expect(await withNetworkRetry(fn, { delayMs: 0 })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once after a network failure', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(networkFailure())
      .mockResolvedValue('ok');
    expect(await withNetworkRetry(fn, { delayMs: 0 })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry and throws the network error', async () => {
    const fn = jest.fn().mockRejectedValue(networkFailure());
    await expect(withNetworkRetry(fn, { delayMs: 0 })).rejects.toThrow('Failed to fetch');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never retries an answer from the server', async () => {
    const serverSaidNo = Object.assign(new Error('Bad Request'), { status: 400 });
    const fn = jest.fn().mockRejectedValue(serverSaidNo);
    await expect(withNetworkRetry(fn, { delayMs: 0 })).rejects.toBe(serverSaidNo);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
