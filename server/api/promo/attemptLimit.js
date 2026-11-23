/**
 * A per-user limit on failed code guesses, so a client cannot try codes in a loop.
 *
 * In memory on purpose: one web service, and a restart forgiving a few guesses costs nothing. Only
 * failures count: a client who types a good code is never slowed down.
 */

const { MAX_FAILED_ATTEMPTS, ATTEMPT_WINDOW_MS } = require('./rules');

const failures = new Map(); // user id -> epoch ms of each recent failure

const recent = (userId, now) =>
  (failures.get(userId) || []).filter(t => now - t < ATTEMPT_WINDOW_MS);

const isLimited = (userId, now = Date.now()) => recent(userId, now).length >= MAX_FAILED_ATTEMPTS;

const recordFailure = (userId, now = Date.now()) => {
  failures.set(userId, [...recent(userId, now), now]);
  // Keep the map from growing with users who never come back.
  if (failures.size > 5000) {
    failures.forEach((times, id) => {
      if (!times.some(t => now - t < ATTEMPT_WINDOW_MS)) failures.delete(id);
    });
  }
};

/** For tests. */
const reset = () => failures.clear();

module.exports = { isLimited, recordFailure, reset };
