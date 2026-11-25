import React from 'react';
import { useHistory } from 'react-router-dom';

import { useRouteConfiguration } from '../../../context/routeConfigurationContext';
import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { createResourceLocatorString } from '../../../util/routes';
import { CONNECT_URL, goToUrl } from '../../../util/calendarConnection';

import { BookingCard } from '../BookingPanelParts';

import css from './SessionSetupCard.module.css';

const Tick = () => (
  <svg
    role="img"
    aria-hidden="true"
    className={css.icon}
    width="28"
    height="28"
    viewBox="0 0 28 28"
  >
    <circle cx="14" cy="14" r="14" className={css.tickDisc} />
    <path d="M8.5 14.5l3.5 3.5 7.5-8" className={css.tickMark} />
  </svg>
);

const Todo = () => (
  <svg aria-hidden="true" className={css.icon} width="28" height="28" viewBox="0 0 28 28">
    <circle cx="14" cy="14" r="12.5" className={css.todoRing} />
  </svg>
);

/**
 * One row: a forest tick and a word ("Connected") when done; a dashed circle, the bold label and a
 * maroon action ("Add →") when not. The action's spoken name is the whole label, so a screen reader
 * hears "Add your payout details", not just "Add".
 */
const Step = ({ done, labelId, doneId, actionId, routeName, href }) => {
  const history = useHistory();
  const routeConfiguration = useRouteConfiguration();
  const intl = useIntl();
  const label = intl.formatMessage({ id: labelId });

  return (
    <li className={done ? css.rowDone : css.row}>
      {done ? <Tick /> : <Todo />}
      <span className={done ? css.label : css.labelTodo}>{label}</span>
      {done ? (
        <span className={css.doneText}>
          <FormattedMessage id={doneId} />
        </span>
      ) : (
        <button
          type="button"
          className={css.action}
          aria-label={label}
          onClick={() =>
            href
              ? // Leaves the app (for Google) and comes back, so a full page load, not a route change.
                goToUrl(href)
              : history.push(createResourceLocatorString(routeName, routeConfiguration))
          }
        >
          <FormattedMessage id={actionId} />
          <span aria-hidden="true"> →</span>
        </button>
      )}
    </li>
  );
};

/**
 * What the coach still has to do, shown to the session's author in the sidebar in place of the
 * booking panel (docs/design/session-page/ States). Three rows, each done or not, under "Clients
 * can't book **this session yet.**" and "ONE STEP LEFT" / "N STEPS LEFT". Rendered by OrderPanel only
 * while at least one is outstanding; once the calendar and payouts are done the server finishes the
 * booking setup by itself (server/api/nylas/reconcile.js).
 *
 * The profile row is about being found, not about booking: a session can already be bookable while
 * the profile is unfinished, and then the card says so rather than claiming it cannot be booked.
 *
 * @param {Object} props
 * @param {boolean} props.calendarConnected
 * @param {boolean} [props.calendarReconnectNeeded] the coach's Google connection stopped working: the
 *   calendar row is not done and its action reconnects (server/api/nylas/grantStatus.js)
 * @param {boolean} props.payoutDetailsSet
 * @param {boolean} [props.profileFinished] the coach has answered the profile questions that their
 *   sessions are searched by. Leave undefined where there are none to answer (no such user fields in
 *   Console), and the row is not shown.
 * @param {boolean} [props.bookable=false] the session can already be booked, so only the profile is left
 */
const SessionSetupCard = ({
  calendarConnected,
  calendarReconnectNeeded = false,
  payoutDetailsSet,
  profileFinished,
  bookable = false,
}) => {
  const rows = [
    { done: calendarConnected },
    { done: payoutDetailsSet },
    ...(profileFinished === undefined ? [] : [{ done: profileFinished }]),
  ];
  const stepsLeft = rows.filter(r => !r.done).length;
  const kind = calendarReconnectNeeded ? 'Reconnect' : bookable ? 'Findable' : '';

  return (
    <BookingCard
      className={css.card}
      aria-labelledby="sessionSetupHeading"
      data-testid="setup-card"
    >
      <div className={css.head}>
        <h2 id="sessionSetupHeading" className={css.heading}>
          <FormattedMessage id={`BookingPanel.setupHeadingLead${kind}`} />
          <b>
            <FormattedMessage id={`BookingPanel.setupHeadingBold${kind}`} />
          </b>
        </h2>
        <span className={css.stepsLeft}>
          <FormattedMessage id="BookingPanel.stepsLeft" values={{ count: stepsLeft }} />
        </span>
        {kind ? (
          <p className={css.intro}>
            <FormattedMessage id={`BookingPanel.setupIntro${kind}`} />
          </p>
        ) : null}
      </div>
      <ul className={css.rows}>
        <Step
          done={calendarConnected}
          labelId={
            calendarReconnectNeeded
              ? 'BookingPanel.setupReconnectCalendar'
              : 'BookingPanel.setupConnectCalendar'
          }
          doneId="BookingPanel.setupConnected"
          actionId={
            calendarReconnectNeeded ? 'BookingPanel.actionReconnect' : 'BookingPanel.actionConnect'
          }
          routeName="CalendarSettingsPage"
          href={calendarReconnectNeeded ? CONNECT_URL : undefined}
        />
        <Step
          done={payoutDetailsSet}
          labelId="BookingPanel.setupPayout"
          doneId="BookingPanel.setupAdded"
          actionId="BookingPanel.actionAdd"
          routeName="StripePayoutPage"
        />
        {profileFinished === undefined ? null : (
          <Step
            done={profileFinished}
            labelId="BookingPanel.setupProfile"
            doneId="BookingPanel.setupDone"
            actionId="BookingPanel.actionFinish"
            routeName="ProfileSettingsPage"
          />
        )}
      </ul>
    </BookingCard>
  );
};

export default SessionSetupCard;
