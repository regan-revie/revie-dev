jest.mock('passport', () => {
  const authenticate = jest.fn(() => jest.fn());
  return { authenticate, use: jest.fn() };
});
jest.mock('passport-google-oauth', () => ({ OAuth2Strategy: jest.fn() }));
jest.mock('./loginWithIdp', () => jest.fn());

const passport = require('passport');
const { authenticateGoogle } = require('./google');

describe('Google login scopes', () => {
  beforeEach(() => {
    // Mock implementations do not survive between tests in this setup.
    passport.authenticate.mockImplementation(() => jest.fn());
  });

  const requestedScopes = () => {
    passport.authenticate.mockClear();
    authenticateGoogle({ query: {} }, {}, jest.fn());
    const [strategy, options] = passport.authenticate.mock.calls[0];
    expect(strategy).toBe('google');
    return options.scope;
  };

  it('asks only for sign-in: openid, profile and email', () => {
    expect(requestedScopes()).toEqual([
      'openid',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
  });

  it('no longer asks for the retired Google+ scope, and never for calendar access', () => {
    const scopes = requestedScopes();
    expect(scopes.some(s => s.includes('plus.login'))).toBe(false);
    expect(scopes.some(s => /calendar/i.test(s))).toBe(false);
  });

  it('still hands the state parameter to Google, carrying the sign-in return details', () => {
    passport.authenticate.mockClear();
    authenticateGoogle({ query: { from: '/inbox', userType: 'coach' } }, {}, jest.fn());
    const options = passport.authenticate.mock.calls[0][1];
    expect(JSON.parse(options.state)).toEqual({ from: '/inbox', userType: 'coach' });
  });
});
