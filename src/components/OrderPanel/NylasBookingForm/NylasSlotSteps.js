import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';

import { StepTitle } from '../BookingPanelParts';
import {
  addDaysToKey,
  addMonthsToMonthKey,
  dayAriaLabel,
  dayButtonParts,
  formatSlotTime12,
  groupSlotsByDay,
  monthGrid,
  monthKeyOf,
  monthLabel,
} from './nylasSlots';

import css from './NylasSlotSteps.module.css';

const STRIP_DAYS = 5;

/**
 * "Pick a day" and "Pick a time" in the booking panel and the phone sheet: a strip of five days,
 * "More dates" for a month grid, then the times of the chosen day. Replaces the template's date
 * picker for booking (NylasSlotPicker, which the reschedule panel still uses).
 *
 * Which days have times, and the slots themselves, come in already filtered (the coach's notice
 * period, working hours and the session length are applied on the server and in the form); this
 * only lays them out. Day boundaries are the viewer's timezone's, so a change of zone remounts
 * this (the parent keys it on the zone) and the chosen day resets.
 *
 * @param {Object} props
 * @param {Array<{start: number, end: number}>} props.slots epoch milliseconds
 * @param {string} props.timeZone IANA zone the times are shown in
 * @param {{start: number}} [props.selectedSlot]
 * @param {(slot) => void} props.onSelectSlot
 * @param {() => void} [props.onDayChange] called when another day is chosen, so a held pick can clear
 * @param {number} props.dayStepNumber the number on the "Pick a day" title
 */
const NylasSlotSteps = ({
  slots,
  timeZone,
  selectedSlot,
  onSelectSlot,
  onDayChange,
  dayStepNumber,
}) => {
  const intl = useIntl();
  const locale = intl.locale;

  const days = groupSlotsByDay(slots, timeZone);
  const slotsByDay = new Map(days.map(d => [d.dayKey, d.slots]));
  const firstDayKey = days[0]?.dayKey;
  const lastDayKey = days[days.length - 1]?.dayKey;

  const [selectedDayKey, setSelectedDayKey] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [stripStartKey, setStripStartKey] = useState(null);
  const [monthKey, setMonthKey] = useState(null);

  const activeDayKey = slotsByDay.has(selectedDayKey) ? selectedDayKey : firstDayKey;
  const stripStart = stripStartKey || firstDayKey;
  const stripKeys = Array.from({ length: STRIP_DAYS }, (_, i) => addDaysToKey(stripStart, i));
  const shownMonth = monthKey || monthKeyOf(activeDayKey);
  const atFirstMonth = shownMonth <= monthKeyOf(firstDayKey);
  const atLastMonth = shownMonth >= monthKeyOf(lastDayKey);

  const pickDay = (key, fromGrid) => {
    if (!slotsByDay.has(key)) {
      return;
    }
    setSelectedDayKey(key);
    if (fromGrid) {
      // A day picked from the month grid becomes the first on the strip, so it is in view when the
      // grid closes.
      setStripStartKey(key);
      setCalendarOpen(false);
    }
    onDayChange?.();
  };

  const daySlots = slotsByDay.get(activeDayKey) || [];

  return (
    <>
      <div className={css.step}>
        <StepTitle number={dayStepNumber} id="booking-day-title">
          <FormattedMessage id="BookingPanel.pickDay" />
        </StepTitle>

        {!calendarOpen ? (
          <>
            <div className={css.strip} role="group" aria-labelledby="booking-day-title">
              {stripKeys.map(key => {
                const available = slotsByDay.has(key);
                const selected = key === activeDayKey;
                const { weekday, day } = dayButtonParts(key, locale);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!available}
                    aria-pressed={selected}
                    aria-label={dayAriaLabel(key, locale)}
                    onClick={() => pickDay(key, false)}
                    className={classNames(css.dayButton, {
                      [css.daySelected]: selected,
                      [css.dayOff]: !available,
                    })}
                  >
                    <span className={css.dayWeekday}>{weekday}</span>
                    <span className={css.dayNumber}>{day}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={css.textButton}
              aria-expanded={false}
              onClick={() => {
                setMonthKey(monthKeyOf(activeDayKey));
                setCalendarOpen(true);
              }}
            >
              <FormattedMessage id="BookingPanel.moreDates" />
            </button>
          </>
        ) : (
          <>
            <div className={css.calendar}>
              <div className={css.calendarHeader}>
                <button
                  type="button"
                  className={css.monthArrow}
                  disabled={atFirstMonth}
                  onClick={() => setMonthKey(addMonthsToMonthKey(shownMonth, -1))}
                  aria-label={intl.formatMessage({ id: 'BookingPanel.previousMonth' })}
                >
                  ‹
                </button>
                <span className={css.monthName}>{monthLabel(shownMonth, locale)}</span>
                <button
                  type="button"
                  className={css.monthArrow}
                  disabled={atLastMonth}
                  onClick={() => setMonthKey(addMonthsToMonthKey(shownMonth, 1))}
                  aria-label={intl.formatMessage({ id: 'BookingPanel.nextMonth' })}
                >
                  ›
                </button>
              </div>
              <div aria-hidden="true" className={css.weekdays}>
                {['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map(d => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className={css.monthDays}>
                {monthGrid(shownMonth).map((key, i) => {
                  if (!key) {
                    return <span key={`blank-${i}`} aria-hidden="true" className={css.blank} />;
                  }
                  const available = slotsByDay.has(key);
                  const selected = key === activeDayKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!available}
                      aria-pressed={selected}
                      aria-label={dayAriaLabel(key, locale)}
                      onClick={() => pickDay(key, true)}
                      className={classNames(css.cell, {
                        [css.cellSelected]: selected,
                        [css.cellFree]: available && !selected,
                        [css.cellOff]: !available,
                      })}
                    >
                      {dayButtonParts(key, locale).day}
                    </button>
                  );
                })}
              </div>
              <div className={css.calendarHint}>
                <FormattedMessage id="BookingPanel.calendarHint" />
              </div>
            </div>
            <button
              type="button"
              className={css.textButton}
              aria-expanded={true}
              onClick={() => setCalendarOpen(false)}
            >
              <FormattedMessage id="BookingPanel.fewerDates" />
            </button>
          </>
        )}
      </div>

      <div className={css.step}>
        <StepTitle number={dayStepNumber + 1} id="booking-time-title">
          <FormattedMessage id="BookingPanel.pickTime" />
        </StepTitle>
        <div className={css.times} role="group" aria-labelledby="booking-time-title">
          {daySlots.map(slot => {
            const selected = !!selectedSlot && slot.start === selectedSlot.start;
            return (
              <button
                key={slot.start}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectSlot(slot)}
                className={classNames(css.timeButton, { [css.timeSelected]: selected })}
              >
                {formatSlotTime12(slot.start, timeZone, locale)}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default NylasSlotSteps;
