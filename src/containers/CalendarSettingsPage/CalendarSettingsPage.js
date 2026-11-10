import React from 'react';
import { connect } from 'react-redux';

import { nylasSyncMe } from '../../util/api';

import { useConfiguration } from '../../context/configurationContext';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import {
  getCurrentUserTypeRoles,
  showCreateListingLinkForUser,
  showPaymentDetailsForUser,
} from '../../util/userHelpers';
import { getCalendarConnection } from '../../util/calendarConnection';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { updateProfile } from '../ManageAccountPage/ManageAccountPage.duck';

import {
  H3,
  H4,
  NamedRedirect,
  Page,
  PrimaryButton,
  UserNav,
  LayoutSideNavigation,
} from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import BookingHoursSection from './BookingHoursSection';

import css from './CalendarSettingsPage.module.css';

// Where the coach is sent to connect, and where the Nylas callback (server/api/nylas/callback.js)
// sends them back to. `returnPath` is honoured by connect.js only when it is a relative path.
const CALENDAR_PATH = '/account/calendar';
export const CONNECT_URL = `/api/nylas/connect?provider=google&returnPath=${encodeURIComponent(
  CALENDAR_PATH
)}`;

// The callback appends ?calendarConnect=<status> to the return path.
const RESULT_MESSAGES = {
  connected: { id: 'CalendarSettingsPage.resultConnected', isError: false },
  declined: { id: 'CalendarSettingsPage.resultDeclined', isError: true },
  failed: { id: 'CalendarSettingsPage.resultFailed', isError: true },
};

const defaultGoTo = url => {
  // A full page load, not a router navigation: this leaves the app for Google and comes back.
  if (typeof window !== 'undefined') window.location.assign(url);
};

/**
 * Account settings > Calendar, for coaches. Connects the coach's Google Calendar through Nylas so
 * clients only see times the coach is free and booked sessions land in their calendar.
 *
 * @param {Object} props
 * @param {propTypes.currentUser} [props.currentUser]
 * @param {boolean} props.scrollingDisabled
 * @param {Object} [props.location] router location, read for the connect result flag
 * @param {Function} [props.goTo] navigates away to a URL; replaced in tests
 * @param {Function} props.onSaveHours saves the working hours; rejects if they were not saved
 * @returns {JSX.Element}
 */
export const CalendarSettingsPageComponent = props => {
  const config = useConfiguration();
  const intl = useIntl();
  const { currentUser, scrollingDisabled, location, goTo = defaultGoTo, onSaveHours } = props;

  // Only providers (coaches) have a calendar to connect.
  const { provider: isProvider } = getCurrentUserTypeRoles(config, currentUser);
  if (currentUser && !isProvider) {
    return <NamedRedirect name="ContactDetailsPage" />;
  }

  const { connected, email } = getCalendarConnection(currentUser);
  const result =
    RESULT_MESSAGES[new URLSearchParams(location?.search || '').get('calendarConnect')];

  const showManageListingsLink = showCreateListingLinkForUser(config, currentUser);
  const { showPayoutDetails, showPaymentMethods } = showPaymentDetailsForUser(config, currentUser);
  const accountSettingsNavProps = {
    currentPage: 'CalendarSettingsPage',
    showPaymentMethods,
    showPayoutDetails,
  };

  return (
    <Page
      title={intl.formatMessage({ id: 'CalendarSettingsPage.title' })}
      scrollingDisabled={scrollingDisabled}
    >
      <LayoutSideNavigation
        topbar={
          <>
            <TopbarContainer
              desktopClassName={css.desktopTopbar}
              mobileClassName={css.mobileTopbar}
            />
            <UserNav
              currentPage="CalendarSettingsPage"
              showManageListingsLink={showManageListingsLink}
            />
          </>
        }
        sideNav={null}
        useAccountSettingsNav
        accountSettingsNavProps={accountSettingsNavProps}
        footer={<FooterContainer />}
        intl={intl}
      >
        <div className={css.content}>
          <H3 as="h1">
            <FormattedMessage id="CalendarSettingsPage.heading" />
          </H3>

          {result ? (
            <p className={result.isError ? css.resultError : css.resultSuccess} role="status">
              <FormattedMessage id={result.id} />
            </p>
          ) : null}

          {connected ? (
            <div className={css.panel}>
              <H4 as="h2" className={css.panelHeading}>
                <FormattedMessage id="CalendarSettingsPage.connectedTitle" />
              </H4>
              {email ? (
                <p className={css.connectedAs}>
                  <FormattedMessage id="CalendarSettingsPage.connectedAs" values={{ email }} />
                </p>
              ) : null}
              <a className={css.reconnectLink} href={CONNECT_URL}>
                <FormattedMessage id="CalendarSettingsPage.reconnect" />
              </a>
            </div>
          ) : (
            <div className={css.panel}>
              <p className={css.explanation}>
                <FormattedMessage id="CalendarSettingsPage.notConnectedText" />
              </p>
              <PrimaryButton type="button" onClick={() => goTo(CONNECT_URL)}>
                <FormattedMessage id="CalendarSettingsPage.connectButton" />
              </PrimaryButton>
            </div>
          )}

          <BookingHoursSection currentUser={currentUser} onSave={onSaveHours} />
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => ({
  currentUser: state.user.currentUser,
  scrollingDisabled: isScrollingDisabled(state),
});

const mapDispatchToProps = dispatch => ({
  // The hours are saved on the coach's own user (stock profile update, so the rest of the app sees
  // them at once), then the server is asked to carry them onto their listings straight away. If that
  // second call fails the hours are still saved and the server's own loop applies them within a minute.
  onSaveHours: bookingHours =>
    dispatch(updateProfile({ privateData: { bookingHours } }))
      .unwrap()
      .then(() => nylasSyncMe().catch(() => null)),
});

const CalendarSettingsPage = connect(
  mapStateToProps,
  mapDispatchToProps
)(CalendarSettingsPageComponent);

export default CalendarSettingsPage;

export { getCalendarConnection };
