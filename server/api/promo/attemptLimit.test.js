const attempts = require('./attemptLimit');
const { MAX_FAILED_ATTEMPTS, ATTEMPT_WINDOW_MS } = require('./rules');

beforeEach(() => attempts.reset());

describe('failed code guesses', () => {
  it('allows a few, then asks the client to wait', () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) attempts.recordFailure('u1', 1000);
    expect(attempts.isLimited('u1', 1000)).toBe(false);
    attempts.recordFailure('u1', 1000);
    expect(attempts.isLimited('u1', 1000)).toBe(true);
  });

  it('is per user', () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) attempts.recordFailure('u1', 1000);
    expect(attempts.isLimited('u2', 1000)).toBe(false);
  });

  it('forgives once the window has passed', () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) attempts.recordFailure('u1', 1000);
    expect(attempts.isLimited('u1', 1000 + ATTEMPT_WINDOW_MS - 1)).toBe(true);
    expect(attempts.isLimited('u1', 1000 + ATTEMPT_WINDOW_MS)).toBe(false);
  });
});
