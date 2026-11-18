import React from 'react';
import '@testing-library/jest-dom';
import { Form as FinalForm } from 'react-final-form';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import enMessages from '../../translations/en.json';

import SessionOutcomesField from './SessionOutcomesField';
import SessionOutcomesSection from './SessionOutcomesSection';

const { screen, userEvent, waitFor } = testingLibrary;

const messages = enMessages;

const TestForm = ({ onSubmit, initialValues }) => (
  <FinalForm
    onSubmit={onSubmit}
    initialValues={initialValues}
    render={({ handleSubmit }) => (
      <form onSubmit={handleSubmit}>
        <SessionOutcomesField formId="test" />
        <button type="submit">Save</button>
      </form>
    )}
  />
);

describe('SessionOutcomesField', () => {
  it('shows three fields, the help text and the examples (not as placeholders)', () => {
    render(<TestForm onSubmit={jest.fn()} />, { messages });

    expect(screen.getByLabelText('Outcome 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Outcome 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Outcome 3')).toBeInTheDocument();
    expect(
      screen.getByText('What will your client leave with? Be specific. One line each.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('One decision made, or one clear test to run before you make it.')
    ).toBeInTheDocument();
    expect(
      screen.getByText("A script for the conversation you've been putting off.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("A plan for the next 30 days you'll actually follow.")
    ).toBeInTheDocument();

    // Examples are inspiration, never a pre-filled look: every input is empty with no placeholder.
    ['Outcome 1', 'Outcome 2', 'Outcome 3'].forEach(label => {
      const input = screen.getByLabelText(label);
      expect(input).toHaveValue('');
      expect(input).not.toHaveAttribute('placeholder');
    });
  });

  it('counts characters live and caps typing at 90', async () => {
    const user = userEvent.setup();
    render(<TestForm onSubmit={jest.fn()} />, { messages });

    expect(screen.getByTestId('pub_outcome_1-count')).toHaveTextContent('0 / 90');
    await user.type(screen.getByLabelText('Outcome 1'), 'Hello');
    expect(screen.getByTestId('pub_outcome_1-count')).toHaveTextContent('5 / 90');
    // Other fields count on their own.
    expect(screen.getByTestId('pub_outcome_2-count')).toHaveTextContent('0 / 90');

    expect(screen.getByLabelText('Outcome 1')).toHaveAttribute('maxLength', '90');
  });

  it('requires outcome 1 but not outcomes 2 and 3', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<TestForm onSubmit={onSubmit} />, { messages });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('Add at least one outcome.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Outcome 1'), 'One clear decision');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({ pub_outcome_1: 'One clear decision' });
  });

  it('refuses to save an outcome over 90 characters (e.g. text saved before the limit existed)', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(
      <TestForm
        onSubmit={onSubmit}
        initialValues={{ pub_outcome_1: 'Fine', pub_outcome_2: 'a'.repeat(91) }}
      />,
      { messages }
    );

    expect(screen.getByTestId('pub_outcome_2-count')).toHaveTextContent('91 / 90');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('Keep it to 90 characters or fewer.')).toBeInTheDocument();
  });

  it('saves exactly 90 characters', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const ninety = 'a'.repeat(90);
    render(<TestForm onSubmit={onSubmit} initialValues={{ pub_outcome_1: ninety }} />, {
      messages,
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

describe('SessionOutcomesSection (session page)', () => {
  it('shows the outcomes as a numbered list under "You\'ll walk away with"', () => {
    render(
      <SessionOutcomesSection
        publicData={{ outcome_1: 'First', outcome_2: 'Second', outcome_3: 'Third' }}
      />,
      { messages }
    );

    expect(screen.getByRole('heading', { name: "You'll walk away with" })).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('hides the whole section when outcome 1 has no text', () => {
    const { container, rerender } = render(<SessionOutcomesSection publicData={{}} />, {
      messages,
    });
    expect(container).toBeEmptyDOMElement();

    // The old description is not used as a fallback.
    rerender(<SessionOutcomesSection publicData={{ outcome_1: '   ', outcome_2: 'Second' }} />);
    expect(screen.queryByTestId('session-outcomes')).not.toBeInTheDocument();
  });
});
