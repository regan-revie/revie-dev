/**
 * Telling "the request never got an answer" apart from "the server said no".
 *
 * A browser fetch that cannot complete (offline, a dropped connection, a request blocked by an
 * extension, a server restarting mid-request) rejects with a TypeError - "Failed to fetch" in
 * Chrome, "Load failed" in Safari, "NetworkError when attempting to fetch resource" in Firefox -
 * and never produces an HTTP status. Everything the server answers, however badly, has a status.
 * So a status-less TypeError is the signature of a request that may not have reached us at all.
 *
 * Revie: this matters at checkout. The only honest thing to tell someone whose request vanished is
 * that nothing was charged and to try again; the template's generic "Payment request failed" reads
 * as though money may have moved.
 */

const NETWORK_MESSAGE = /failed to fetch|load failed|networkerror|network request failed/i;

/**
 * Works on a raw error, or on the plain object `storableError` puts in Redux state (which keeps
 * name and message but not the class).
 */
export const isNetworkError = error => {
  if (!error) return false;
  const { name, message, status } = error;
  return !status && name === 'TypeError' && NETWORK_MESSAGE.test(String(message || ''));
};

/**
 * Run `fn`, and run it once more if it fails with a network error.
 *
 * Only for calls that change nothing, such as a price estimate: running one twice costs nothing. It
 * must never wrap anything that creates a transaction or moves money, because a network error does
 * not say whether the first attempt reached the server.
 *
 * @param {() => Promise<any>} fn
 * @param {{retries?: number, delayMs?: number}} [options]
 */
export const withNetworkRetry = async (fn, { retries = 1, delayMs = 600 } = {}) => {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (e) {
      if (!isNetworkError(e) || attempt >= retries) throw e;
      attempt += 1;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
};
