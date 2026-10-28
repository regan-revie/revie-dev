import { getErrorMessages } from './ErrorMessages';

const networkFailure = { type: 'error', name: 'TypeError', message: 'Failed to fetch' };
const messageIdOf = element => element?.props?.children?.props?.id;

describe('getErrorMessages()', () => {
  it('tells the client nothing was charged when the initiate request never got an answer', () => {
    const messages = getErrorMessages(false, networkFailure, false, null, null, null);
    expect(messageIdOf(messages.initiateOrderErrorMessage)).toBe('CheckoutPage.networkError');
  });

  it('says the same when the price estimate could not be reached', () => {
    const messages = getErrorMessages(false, null, false, null, networkFailure, null);
    expect(messageIdOf(messages.speculateErrorMessage)).toBe('CheckoutPage.networkError');
  });

  it('keeps the generic message for an error the server actually returned', () => {
    const serverError = { type: 'error', name: 'Error', message: 'boom', status: 500 };
    const messages = getErrorMessages(false, serverError, false, null, null, null);
    expect(messageIdOf(messages.initiateOrderErrorMessage)).toBe('CheckoutPage.initiateOrderError');
  });
});
