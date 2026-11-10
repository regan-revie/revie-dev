import React from 'react';
import '@testing-library/jest-dom';

import { createCurrentUser } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import BookingHoursSection from './BookingHoursSection';

const { screen, userEvent, waitFor } = testingLibrary;

const userWithHours = bookingHours =>
  createCurrentUser('coach1', { profile: { privateData: { bookingHours } } });

const renderSection = (currentUser, onSave = jest.fn(async () => {})) => {
  render(<BookingHoursSection currentUser={currentUser} onSave={onSave} />);
  return onSave;
};

const dayBox = n => screen.getByRole('checkbox', { name: `CalendarSettingsPage.day${n}` });
const save = () => screen.getByRole('button', { name: 'CalendarSettingsPage.hoursSave' });
const selects = () => screen.getAllByRole('combobox');

describe('BookingHoursSection', () => {
  it('shows Mon-Fri 9:00-17:00 when nothing is saved, so nobody is ever bookable 24/7', async () => {
    renderSection(createCurrentUser('coach1'));

    [1, 2, 3, 4, 5].forEach(n => expect(dayBox(n)).toBeChecked());
    [6, 7].forEach(n => expect(dayBox(n)).not.toBeChecked());
    await waitFor(() => expect(save()).toBeEnabled());
    const [from, to] = selects();
    expect(from).toHaveValue('09:00');
    expect(to).toHaveValue('17:00');
  });

  it('shows the hours the coach saved', () => {
    renderSection(
      userWithHours({ days: [2, 4], start: '10:30', end: '14:00', timeZone: 'Europe/Paris' })
    );

    [2, 4].forEach(n => expect(dayBox(n)).toBeChecked());
    [1, 3, 5, 6, 7].forEach(n => expect(dayBox(n)).not.toBeChecked());
    const [from, to, zone] = selects();
    expect(from).toHaveValue('10:30');
    expect(to).toHaveValue('14:00');
    expect(zone).toHaveValue('Europe/Paris');
  });

  it('ignores saved hours that are unusable and shows the default instead', () => {
    renderSection(userWithHours({ days: [], start: '09:00', end: '17:00' }));
    expect(dayBox(1)).toBeChecked();
    expect(selects()[0]).toHaveValue('09:00');
  });

  it('saves the schedule as edited: days, start, end and timezone', async () => {
    const user = userEvent.setup();
    const onSave = renderSection(
      userWithHours({
        days: [1, 2, 3, 4, 5],
        start: '09:00',
        end: '17:00',
        timeZone: 'Europe/London',
      })
    );

    await user.click(dayBox(5)); // drop Friday
    await user.click(dayBox(6)); // add Saturday
    await user.selectOptions(selects()[0], '08:30');
    await user.selectOptions(selects()[1], '12:00');
    await user.click(save());

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      days: [1, 2, 3, 4, 6],
      start: '08:30',
      end: '12:00',
      timeZone: 'Europe/London',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('CalendarSettingsPage.hoursSaved');
  });

  it('will not save with no day picked, and says why', async () => {
    const user = userEvent.setup();
    const onSave = renderSection(
      userWithHours({ days: [1], start: '09:00', end: '17:00', timeZone: 'Europe/London' })
    );

    await user.click(dayBox(1));
    expect(save()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('CalendarSettingsPage.hoursNoDays');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('will not save an end time that is not after the start time, and says why', async () => {
    const user = userEvent.setup();
    const onSave = renderSection(
      userWithHours({ days: [1], start: '09:00', end: '17:00', timeZone: 'Europe/London' })
    );

    await user.selectOptions(selects()[1], '09:00');
    expect(save()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('CalendarSettingsPage.hoursEndBeforeStart');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('tells the coach when saving failed, and lets them try again', async () => {
    const user = userEvent.setup();
    const onSave = renderSection(
      userWithHours({ days: [1], start: '09:00', end: '17:00', timeZone: 'Europe/London' }),
      jest.fn(async () => {
        throw new Error('network');
      })
    );

    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'CalendarSettingsPage.hoursSaveFailed'
    );
    expect(save()).toBeEnabled();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
