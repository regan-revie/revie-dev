import React from 'react';
import { useHistory } from 'react-router-dom';

import { useRouteConfiguration } from '../../../context/routeConfigurationContext';
import { FormattedMessage } from '../../../util/reactIntl';
import { createResourceLocatorString } from '../../../util/routes';
import { CONNECT_URL, goToUrl } from '../../../util/calendarConnection';

import { H4, SecondaryButton } from '../../../components';

import css from './SessionSetupCard.module.css';

const Tick = () => (
  <svg className={css.tick} width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="10" className={css.tickDisc} />
    <path d="M5.5 10.5l3 3 6-6.5" className={css.tickMark} />
  </svg>
);

const Todo = () => (
  <svg className={css.todo} width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="9" className={css.todoRing} />
  </svg>
);

const Step = ({ done, labelId, routeName, href }) => {
  const history = useHistory();
  const routeConfiguration = useRouteConfiguration();

  return (
    <li className={css.step}>
      {done ? <Tick /> : <Todo />}
      {done ? (
        <span className={css.doneLabel}>
          <FormattedMessage id={labelId} />
          <span className={css.srOnly}>
            {' '}
            <FormattedMessage id="OrderPanel.setupStepDone" />
          </span>
        </span>
      ) : (
        <SecondaryButton
          type="button"
          className={css.stepButton}
          onClick={() =>
            href
              ? // Leaves the app (for Google) and comes back, so a full page load, not a route change.
                goToUrl(href)
              : history.push(createResourceLocatorString(routeName, routeConfiguration))
          }
        >
          <FormattedMessage id={labelId} />
        </SecondaryButton>
      )}
    </li>
  );
};

/**
 * What the coach still has to do, shown to the listing's author in the sidebar in place of the
 * booking form. Three steps, each either done (a tick, no button) or not (a button to where it is
 * done). Rendered by OrderPanel only while at least one is outstanding; once the calendar and
 * payouts are done the server finishes the booking setup by itself (server/api/nylas/reconcile.js).
 *
 * The profile step is about being found, not about booking: a session can already be bookable while
 * the profile is unfinished, and then the card says so rather than claiming it cannot be booked.
 *
 * @param {Object} props
 * @param {boolean} props.calendarConnected
 * @param {boolean} [props.calendarReconnectNeeded] the coach's Google connection stopped working: the
 *   calendar row is not done and its button reconnects (server/api/nylas/grantStatus.js)
 * @param {boolean} props.payoutDetailsSet
 * @param {boolean} [props.profileFinished] the coach has answered the profile questions that their
 *   sessions are searched by (language, location, ...). Leave undefined where there are none to
 *   answer (no such user fields in Console), and the row is not shown.
 * @param {boolean} [props.bookable=false] the session can already be booked, so only the profile is left
 */
const SessionSetupCard = ({
  calendarConnected,
  calendarReconnectNeeded = false,
  payoutDetailsSet,
  profileFinished,
  bookable = false,
}) => (
  <section className={css.card} aria-labelledby="sessionSetupHeading">
    <H4 as="h2" id="sessionSetupHeading" className={css.heading}>
      <FormattedMessage
        id={
          calendarReconnectNeeded
            ? 'OrderPanel.setupCardHeadingReconnect'
            : bookable
            ? 'OrderPanel.setupCardHeadingFindable'
            : 'OrderPanel.setupCardHeading'
        }
      />
    </H4>
    <p className={css.intro}>
      <FormattedMessage
        id={
          calendarReconnectNeeded
            ? 'OrderPanel.setupCardIntroReconnect'
            : bookable
            ? 'OrderPanel.setupCardIntroFindable'
            : 'OrderPanel.setupCardIntro'
        }
      />
    </p>
    <ul className={css.steps}>
      <Step
        done={calendarConnected}
        labelId={
          calendarReconnectNeeded
            ? 'OrderPanel.setupReconnectCalendar'
            : 'OrderPanel.setupConnectCalendar'
        }
        routeName="CalendarSettingsPage"
        href={calendarReconnectNeeded ? CONNECT_URL : undefined}
      />
      <Step
        done={payoutDetailsSet}
        labelId="OrderPanel.setupAddPayoutDetails"
        routeName="StripePayoutPage"
      />
      {profileFinished === undefined ? null : (
        <Step
          done={profileFinished}
          labelId="OrderPanel.setupFinishProfile"
          routeName="ProfileSettingsPage"
        />
      )}
    </ul>
  </section>
);

export default SessionSetupCard;
