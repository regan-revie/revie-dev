import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory, useLocation } from 'react-router-dom';
import classNames from 'classnames';

import appSettings from '../../../config/settings';
import { useConfiguration } from '../../../context/configurationContext';
import { useRouteConfiguration } from '../../../context/routeConfigurationContext';
import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { pathByRouteName } from '../../../util/routes';
import { getCurrentUserTypeRoles } from '../../../util/userHelpers';
import { sendVerificationEmail, hasCurrentUserErrors } from '../../../ducks/user.duck';
import { logout, authenticationInProgress } from '../../../ducks/auth.duck';
import { manageDisableScrolling } from '../../../ducks/ui.duck';
import {
  InlineTextButton,
  LimitedAccessBanner,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  Modal,
  ModalMissingInformation,
  NamedLink,
} from '../../../components';

import logoAvatar from '../../../assets/revie-logo-avatar.svg';
import { IconInbox } from './SessionIcons';

import css from './SessionTopbar.module.css';

// The marketing site. About, Blog and For coaches live there, not in this app.
export const MARKETING_SITE = 'https://heyrevie.com';
export const MARKETING_LINKS = [
  { id: 'about', href: `${MARKETING_SITE}/about` },
  { id: 'blog', href: `${MARKETING_SITE}/blog` },
  { id: 'forCoaches', href: `${MARKETING_SITE}/coaches` },
];

const MOBILE_MENU_ID = 'SessionTopbar.mobileMenu';

const initialsOf = currentUser => currentUser?.attributes?.profile?.abbreviatedName || '';

const Chevron = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const HamburgerIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="26"
    height="26"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
  >
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

// What the account menu lists, by who is signed in. A coach manages sessions and a calendar; a
// client has bookings. Both end with the same three. `to` is a route name (and optional params).
export const accountMenuItems = (kind, inboxTab) =>
  kind === 'coach'
    ? [
        { id: 'sessions', messageId: 'SessionTopbar.yourSessions', route: 'ManageListingsPage' },
        { id: 'calendar', messageId: 'SessionTopbar.calendar', route: 'CalendarSettingsPage' },
        {
          id: 'profile',
          messageId: 'SessionTopbar.editProfile',
          route: 'ProfileSettingsPage',
        },
        {
          id: 'account',
          messageId: 'SessionTopbar.accountAndPayments',
          route: 'AccountSettingsPage',
        },
      ]
    : [
        {
          id: 'bookings',
          messageId: 'SessionTopbar.yourBookings',
          route: 'InboxPage',
          params: { tab: inboxTab },
        },
        {
          id: 'profile',
          messageId: 'SessionTopbar.editProfile',
          route: 'ProfileSettingsPage',
        },
        {
          id: 'account',
          messageId: 'SessionTopbar.accountAndPayments',
          route: 'AccountSettingsPage',
        },
      ];

export const AccountMenu = ({ currentUser, currentPage, onLogout, kind, inboxTab }) => {
  const intl = useIntl();
  const items = accountMenuItems(kind, inboxTab);
  return (
    // contentPosition="left": the card opens leftwards from the button, so its right edge lines up
    // with the avatar's (the shared Menu otherwise opens it rightwards, off the page's edge).
    <Menu skipFocusOnNavigation={true} contentPosition="left">
      <MenuLabel
        id="session-profile-menu-label"
        className={css.accountButton}
        ariaLabel={intl.formatMessage({ id: 'SessionTopbar.accountMenu' })}
      >
        <span aria-hidden="true" className={css.initials}>
          {initialsOf(currentUser)}
        </span>
        <Chevron />
      </MenuLabel>
      <MenuContent rootClassName={css.menuCard} contentClassName={css.menuList}>
        {items.map(item => (
          <MenuItem key={item.id}>
            <NamedLink name={item.route} params={item.params} className={css.menuLink}>
              <FormattedMessage id={item.messageId} />
            </NamedLink>
          </MenuItem>
        ))}
        <MenuItem key="logout">
          <InlineTextButton
            rootClassName={classNames(css.menuLink, css.menuLogout)}
            onClick={onLogout}
          >
            <FormattedMessage id="TopbarDesktop.logout" />
          </InlineTextButton>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
};

/**
 * The top bar of the session page (/l/...), matching heyrevie.com: the lavender R, then
 * Schibsted Grotesk all-caps links. Signed out it ends in "Sign in" and a lavender "Get started";
 * signed in, in Inbox (with a count of what needs attention) and the account menu. On a phone, the
 * logo and a menu.
 *
 * Used on this page only, so search, checkout and the other pages keep the shared top bar. What the
 * shared bar also does is kept here: the "logged in as" banner for operators and the reminder to
 * confirm an email address.
 */
const SessionTopbar = () => {
  const intl = useIntl();
  const config = useConfiguration();
  const routeConfiguration = useRouteConfiguration();
  const history = useHistory();
  const location = useLocation();
  const dispatch = useDispatch();

  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  const auth = useSelector(state => state.auth);
  const user = useSelector(state => state.user);
  const { isAuthenticated, isLoggedInAs, authScopes } = auth;
  const {
    currentUser,
    currentUserHasListings,
    currentUserHasOrders,
    currentUserSaleNotificationCount = 0,
    currentUserOrderNotificationCount = 0,
    sendVerificationEmailInProgress,
    sendVerificationEmailError,
  } = user;
  const authInProgress = useSelector(state => authenticationInProgress(state));
  const hasGenericError = useSelector(
    state => !!(state.auth.logoutError || hasCurrentUserErrors(state))
  );
  const notificationCount = currentUserSaleNotificationCount + currentUserOrderNotificationCount;

  const onManageDisableScrolling = (componentId, disableScrolling) =>
    dispatch(manageDisableScrolling(componentId, disableScrolling));

  const handleLogout = () => {
    dispatch(logout()).then(() => {
      const path = pathByRouteName('LandingPage', routeConfiguration);
      // As the shared top bar does: in production make sure the data is really gone.
      if (appSettings.dev) {
        history.push(path);
      } else if (typeof window !== 'undefined') {
        window.location = path;
      }
    });
  };

  const { customer: isCustomer, provider: isProvider } = getCurrentUserTypeRoles(
    config,
    currentUser
  );
  // A coach if they sell sessions (or sell and book, and have sessions); otherwise a client.
  const menuKind = isProvider && (!isCustomer || currentUserHasListings) ? 'coach' : 'client';
  const inboxTab = !isCustomer
    ? 'sales'
    : !isProvider
    ? 'orders'
    : currentUserHasListings
    ? 'sales'
    : 'orders';

  // Anything that depends on who is signed in waits for the browser, so what the server drew and
  // what the first browser render draws are the same.
  const signedIn = mounted && isAuthenticated;
  const signedOut = mounted && !isAuthenticated;
  const countLabel = intl.formatMessage(
    { id: 'SessionTopbar.inboxNew' },
    { count: notificationCount }
  );

  const handleSkip = e => {
    e.preventDefault();
    const main = document.getElementById('main-content');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus();
    }
  };

  return (
    <div className={css.root}>
      <a href="#main-content" className={css.skip} onClick={handleSkip}>
        <FormattedMessage id="Topbar.skipToMainContent" />
      </a>
      <LimitedAccessBanner
        isAuthenticated={isAuthenticated}
        isLoggedInAs={isLoggedInAs}
        authScopes={authScopes}
        currentUser={currentUser}
        onLogout={handleLogout}
        currentPage="ListingPage"
      />
      <header className={css.bar}>
        <NamedLink
          name="LandingPage"
          className={css.logo}
          ariaLabel={intl.formatMessage({ id: 'SessionTopbar.home' })}
        >
          <img src={logoAvatar} alt="Revie" className={css.logoImage} />
        </NamedLink>

        {/* Desktop */}
        <nav
          className={css.nav}
          aria-label={intl.formatMessage({ id: 'TopbarDesktop.screenreader.topbarNavigation' })}
        >
          <NamedLink name="SearchPage" className={css.navLink}>
            <FormattedMessage id="SessionTopbar.findACoach" />
          </NamedLink>
          {MARKETING_LINKS.filter(link => !(signedIn && link.id === 'forCoaches')).map(link => (
            <a key={link.id} href={link.href} className={css.navLink}>
              <FormattedMessage id={`SessionTopbar.${link.id}`} />
            </a>
          ))}
          {signedIn ? (
            <>
              <NamedLink name="InboxPage" params={{ tab: inboxTab }} className={css.navLink}>
                <FormattedMessage id="SessionTopbar.inbox" />
                {notificationCount > 0 ? (
                  <span className={css.count} aria-label={countLabel}>
                    {notificationCount}
                  </span>
                ) : null}
              </NamedLink>
              <AccountMenu
                currentUser={currentUser}
                onLogout={handleLogout}
                kind={menuKind}
                inboxTab={inboxTab}
              />
            </>
          ) : null}
          {signedOut ? (
            <>
              <NamedLink name="LoginPage" className={classNames(css.navLink, css.signIn)}>
                <FormattedMessage id="SessionTopbar.signIn" />
              </NamedLink>
              <NamedLink name="SignupPage" className={css.getStarted}>
                <FormattedMessage id="SessionTopbar.getStarted" />
              </NamedLink>
            </>
          ) : null}
        </nav>

        {/* Phone */}
        <div className={css.phoneActions}>
          {signedIn ? (
            <>
              <NamedLink
                name="InboxPage"
                params={{ tab: inboxTab }}
                className={css.phoneInbox}
                ariaLabel={
                  notificationCount > 0
                    ? `${intl.formatMessage({ id: 'SessionTopbar.inbox' })}, ${countLabel}`
                    : intl.formatMessage({ id: 'SessionTopbar.inbox' })
                }
              >
                <IconInbox size={26} />
                {notificationCount > 0 ? <span aria-hidden="true" className={css.dot} /> : null}
              </NamedLink>
              <span aria-hidden="true" className={css.phoneInitials}>
                {initialsOf(currentUser)}
              </span>
            </>
          ) : null}
          <button
            type="button"
            id="session-mobile-menu-button"
            className={css.menuButton}
            onClick={() => setMobileMenuOpen(true)}
            aria-label={intl.formatMessage({ id: 'Topbar.menuIcon' })}
            aria-haspopup="dialog"
            aria-expanded={mobileMenuOpen}
          >
            <HamburgerIcon />
          </button>
        </div>
      </header>

      <Modal
        id={MOBILE_MENU_ID}
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        usePortal
        onManageDisableScrolling={onManageDisableScrolling}
        focusElementId="session-mobile-menu-button"
      >
        {authInProgress ? null : (
          <nav
            className={css.mobileMenu}
            aria-label={intl.formatMessage({ id: 'SessionTopbar.mobileMenu' })}
          >
            <NamedLink name="SearchPage" className={css.mobileLink}>
              <FormattedMessage id="SessionTopbar.findACoach" />
            </NamedLink>
            {MARKETING_LINKS.filter(link => !(signedIn && link.id === 'forCoaches')).map(link => (
              <a key={link.id} href={link.href} className={css.mobileLink}>
                <FormattedMessage id={`SessionTopbar.${link.id}`} />
              </a>
            ))}
            {signedIn ? (
              <>
                <NamedLink name="InboxPage" params={{ tab: inboxTab }} className={css.mobileLink}>
                  <FormattedMessage id="SessionTopbar.inbox" />
                  {notificationCount > 0 ? (
                    <span className={css.count}>{notificationCount}</span>
                  ) : null}
                </NamedLink>
                {accountMenuItems(menuKind, inboxTab).map(item => (
                  <NamedLink
                    key={item.id}
                    name={item.route}
                    params={item.params}
                    className={css.mobileLink}
                  >
                    <FormattedMessage id={item.messageId} />
                  </NamedLink>
                ))}
                <InlineTextButton rootClassName={css.mobileLink} onClick={handleLogout}>
                  <FormattedMessage id="TopbarDesktop.logout" />
                </InlineTextButton>
              </>
            ) : (
              <>
                <NamedLink name="LoginPage" className={css.mobileLink}>
                  <FormattedMessage id="SessionTopbar.signIn" />
                </NamedLink>
                <NamedLink name="SignupPage" className={css.mobileGetStarted}>
                  <FormattedMessage id="SessionTopbar.getStarted" />
                </NamedLink>
              </>
            )}
          </nav>
        )}
      </Modal>

      <ModalMissingInformation
        id="MissingInformationReminder"
        containerClassName={css.missingInformationModal}
        currentUser={currentUser}
        currentUserHasListings={currentUserHasListings}
        currentUserHasOrders={currentUserHasOrders}
        location={location}
        onManageDisableScrolling={onManageDisableScrolling}
        onResendVerificationEmail={() => dispatch(sendVerificationEmail())}
        sendVerificationEmailInProgress={sendVerificationEmailInProgress}
        sendVerificationEmailError={sendVerificationEmailError}
      />

      {hasGenericError ? (
        <div className={css.genericError} role="alert">
          <FormattedMessage id="Topbar.genericError" />
        </div>
      ) : null}
    </div>
  );
};

export default SessionTopbar;
