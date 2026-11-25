import React from 'react';
import '@testing-library/jest-dom';
import { Form as FinalForm } from 'react-final-form';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import en from '../../translations/en.json';
import PrepLinkField from './PrepLinkField';

const { screen, userEvent } = testingLibrary;

const setup = () => {
  const onSubmit = jest.fn();
  render(
    <FinalForm
      onSubmit={onSubmit}
      render={({ handleSubmit }) => (
        <form onSubmit={handleSubmit}>
          <PrepLinkField
            formId="test"
            name="pub_prep_link"
            fieldConfig={{ saveConfig: { label: 'Prep link (optional)' } }}
          />
          <button type="submit">save</button>
        </form>
      )}
    />,
    { messages: en }
  );
  return onSubmit;
};

describe('PrepLinkField', () => {
  it('has the label from Console and the help line', () => {
    setup();
    expect(screen.getByLabelText('Prep link (optional)')).toBeInTheDocument();
    expect(
      screen.getByText('A link to your own prep questionnaire, e.g. Typeform or Google Form.')
    ).toBeInTheDocument();
  });

  it('saves with nothing in it (it is optional)', async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByText('save'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('saves a web link', async () => {
    const onSubmit = setup();
    await userEvent.type(screen.getByLabelText('Prep link (optional)'), 'https://forms.gle/abc');
    await userEvent.click(screen.getByText('save'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({ pub_prep_link: 'https://forms.gle/abc' });
  });

  it('refuses something that is not a web link, and says so', async () => {
    const onSubmit = setup();
    await userEvent.type(screen.getByLabelText('Prep link (optional)'), 'javascript:alert(1)');
    await userEvent.click(screen.getByText('save'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText(en['PrepLinkField.notALink'])).toBeInTheDocument();
  });
});
