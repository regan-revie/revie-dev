/**
 * The 48-hour rule, in one place for the client's screens: a session that starts less than 48 hours
 * from now can no longer be moved, and cancelling it is charged in full. The booking panel's fine
 * print, the checkout summary and the "You're booked" email all ask this one question, so they
 * cannot disagree with each other.
 *
 * It is the server's rule, from the same number: `isFreeCancellation()` in
 * server/api/nylas/scheduler.js (free when the notice is 48 hours or more), which decides the
 * refund, and `isInsideFreeWindow()` beside it, which the email uses. A test
 * (server/api/nylas/freeWindow.test.js) holds this file and that one to the same answers, at the
 * boundary too.
 */

export const FREE_CANCELLATION_HOURS = 48;
const FREE_CANCELLATION_MS = FREE_CANCELLATION_HOURS * 60 * 60 * 1000;

/**
 * Is this session inside the 48 hours: starting in less than 48 hours (or already started)?
 * Exactly 48 hours is still free, as on the server. A start that cannot be read is not "inside":
 * the screens then say nothing alarming they cannot back up.
 *
 * @param {number|Date|string} start when the session starts
 * @param {number} [now] epoch ms, for tests
 * @returns {boolean}
 */
export const isInsideFreeWindow = (start, now = Date.now()) => {
  const startMs = new Date(start).getTime();
  if (start === null || start === undefined || start === '' || !Number.isFinite(startMs)) {
    return false;
  }
  return startMs - now < FREE_CANCELLATION_MS;
};
