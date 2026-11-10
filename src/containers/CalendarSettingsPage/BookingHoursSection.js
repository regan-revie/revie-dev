import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { getDefaultTimeZoneOnBrowser } from '../../util/dates';
import {
  DEFAULT_BOOKING_HOURS,
  TIME_OPTIONS,
  getSavedBookingHours,
  timeZoneOptions,
  validateBookingHours,
} from '../../util/bookingHours';

import { H4, PrimaryButton } from '../../components';

import css from './CalendarSettingsPage.module.css';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * One weekly schedule for the coach: which days, a start and an end time, and the timezone they
 * are read in. Applies to all their session listings. With nothing saved it shows Mon-Fri 9:00-17:00
 * in the browser's timezone, which is also what the server uses, so a coach who never opens this
 * is still never bookable at 3am.
 *
 * @param {Object} props
 * @param {propTypes.currentUser} [props.currentUser]
 * @param {Function} props.onSave `({days, start, end, timeZone}) => Promise`; rejects if not saved
 * @returns {JSX.Element}
 */
const BookingHoursSection = ({ currentUser, onSave }) => {
  const saved = getSavedBookingHours(currentUser);
  const [days, setDays] = useState(saved ? saved.days : DEFAULT_BOOKING_HOURS.days);
  const [start, setStart] = useState(saved ? saved.start : DEFAULT_BOOKING_HOURS.start);
  const [end, setEnd] = useState(saved ? saved.end : DEFAULT_BOOKING_HOURS.end);
  const [timeZone, setTimeZone] = useState(saved ? saved.timeZone : null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'

  // The browser's zone is only known once mounted (this page is also rendered on the server).
  useEffect(() => {
    if (!timeZone) setTimeZone(getDefaultTimeZoneOnBrowser());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const problem = validateBookingHours({ days, start, end });

  const edit = setter => value => {
    setter(value);
    if (status !== 'saving') setStatus('idle');
  };

  const toggleDay = day =>
    edit(setDays)(days.includes(day) ? days.filter(d => d !== day) : [...days, day]);

  const handleSubmit = e => {
    e.preventDefault();
    if (problem || status === 'saving') return;
    setStatus('saving');
    Promise.resolve(onSave({ days: [...days].sort((a, b) => a - b), start, end, timeZone }))
      .then(() => setStatus('saved'))
      .catch(() => setStatus('error'));
  };

  const zones = timeZoneOptions(timeZone);

  return (
    <form className={css.hours} onSubmit={handleSubmit}>
      <H4 as="h2" className={css.panelHeading}>
        <FormattedMessage id="CalendarSettingsPage.hoursHeading" />
      </H4>
      <p className={css.explanation}>
        <FormattedMessage id="CalendarSettingsPage.hoursIntro" />
      </p>

      <fieldset className={css.fieldset}>
        <legend className={css.label}>
          <FormattedMessage id="CalendarSettingsPage.hoursDays" />
        </legend>
        <div className={css.days}>
          {WEEKDAYS.map(day => (
            <label key={day} className={classNames(css.day, { [css.dayOn]: days.includes(day) })}>
              <input
                type="checkbox"
                className={css.dayInput}
                checked={days.includes(day)}
                onChange={() => toggleDay(day)}
              />
              <FormattedMessage id={`CalendarSettingsPage.day${day}`} />
            </label>
          ))}
        </div>
      </fieldset>

      <div className={css.timeRow}>
        <label className={css.field}>
          <span className={css.label}>
            <FormattedMessage id="CalendarSettingsPage.hoursFrom" />
          </span>
          <select
            className={css.select}
            value={start}
            onChange={e => edit(setStart)(e.target.value)}
          >
            {TIME_OPTIONS.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          <span className={css.label}>
            <FormattedMessage id="CalendarSettingsPage.hoursTo" />
          </span>
          <select className={css.select} value={end} onChange={e => edit(setEnd)(e.target.value)}>
            {TIME_OPTIONS.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={css.field}>
        <span className={css.label}>
          <FormattedMessage id="CalendarSettingsPage.hoursTimeZone" />
        </span>
        <select
          className={css.select}
          value={timeZone || ''}
          onChange={e => edit(setTimeZone)(e.target.value)}
        >
          {zones.map(zone => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>

      {problem ? (
        <p className={css.resultError} role="alert">
          <FormattedMessage
            id={
              problem === 'noDays'
                ? 'CalendarSettingsPage.hoursNoDays'
                : 'CalendarSettingsPage.hoursEndBeforeStart'
            }
          />
        </p>
      ) : null}

      <PrimaryButton
        type="submit"
        className={css.saveButton}
        inProgress={status === 'saving'}
        disabled={!!problem || !timeZone}
      >
        <FormattedMessage id="CalendarSettingsPage.hoursSave" />
      </PrimaryButton>

      {status === 'saved' ? (
        <p className={css.resultSuccess} role="status">
          <FormattedMessage id="CalendarSettingsPage.hoursSaved" />
        </p>
      ) : null}
      {status === 'error' ? (
        <p className={css.resultError} role="alert">
          <FormattedMessage id="CalendarSettingsPage.hoursSaveFailed" />
        </p>
      ) : null}
    </form>
  );
};

export default BookingHoursSection;
