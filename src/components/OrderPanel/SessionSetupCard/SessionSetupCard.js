import React from 'react';
import { useHistory } from 'react-router-dom';

import { useRouteConfiguration } from '../../../context/routeConfigurationContext';
import { FormattedMessage } from '../../../util/reactIntl';
import { createResourceLocatorString } from '../../../util/routes';

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

const Step = ({ done, labelId, routeName }) => {
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
          onClick={() => history.push(createResourceLocatorString(routeName, routeConfiguration))}
        >
          <FormattedMessage id={labelId} />
        </SecondaryButton>
      )}
    </li>
  );
};

/**
 * What the coach still has to do before clients can book a session, shown to the listing's author
 * in the sidebar in place of the booking form. Two steps, each either done (a tick, no button) or
 * not (a button to where it is done). Rendered by OrderPanel only while at least one is outstanding;
 * once both are done the server finishes the setup by itself (server/api/nylas/reconcile.js).
 *
 * @param {Object} props
 * @param {boolean} props.calendarConnected
 * @param {boolean} props.payoutDetailsSet
 */
const SessionSetupCard = ({ calendarConnected, payoutDetailsSet }) => (
  <section className={css.card} aria-labelledby="sessionSetupHeading">
    <H4 as="h2" id="sessionSetupHeading" className={css.heading}>
      <FormattedMessage id="OrderPanel.setupCardHeading" />
    </H4>
    <p className={css.intro}>
      <FormattedMessage id="OrderPanel.setupCardIntro" />
    </p>
    <ul className={css.steps}>
      <Step
        done={calendarConnected}
        labelId="OrderPanel.setupConnectCalendar"
        routeName="CalendarSettingsPage"
      />
      <Step
        done={payoutDetailsSet}
        labelId="OrderPanel.setupAddPayoutDetails"
        routeName="StripePayoutPage"
      />
    </ul>
  </section>
);

export default SessionSetupCard;
