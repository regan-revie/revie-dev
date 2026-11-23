jest.mock('../api-util/sdk', () => ({
  createCookieTokenStore: jest.fn(),
  getSdk: jest.fn(),
  getTrustedSdk: jest.fn(),
  handleError: jest.fn(),
  serialize: jest.fn(),
  fetchCommission: jest.fn(),
}));
const { handleError, getSdk } = require('../api-util/sdk');
const handler = require('./transition-privileged');

describe('transition-privileged and promo codes', () => {
  it('refuses a code on the inquiry path, before touching Sharetribe', () => {
    const res = {};
    handler(
      {
        body: {
          orderData: { promoCode: 'NEWYEAR15' },
          bodyParams: {
            id: 'x',
            transition: 'transition/request-payment-after-inquiry',
            params: {},
          },
        },
      },
      res
    );
    expect(handleError).toHaveBeenCalledTimes(1);
    expect(handleError.mock.calls[0][1].statusText).toBe('promo-not-supported');
    expect(getSdk).not.toHaveBeenCalled();
  });

  it('refuses a code smuggled in the transition params too', () => {
    handleError.mockClear();
    handler(
      {
        body: {
          orderData: {},
          bodyParams: { id: 'x', transition: 't', params: { promoCode: 'A1B' } },
        },
      },
      {}
    );
    expect(handleError.mock.calls[0][1].statusText).toBe('promo-not-supported');
  });
});
