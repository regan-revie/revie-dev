import React from 'react';
import '@testing-library/jest-dom';

// TopbarContainer uses @loadable/component, whose async state updates raise act() warnings. The
// topbar is not what these tests are about, so it is stubbed, as in EditListingPage.test.js.
jest.mock('../TopbarContainer/TopbarContainer', () => {
  // eslint-disable-next-line react/display-name
  return () => <div data-testid="topbar" />;
});

import { createCurrentUser } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import {
  CalendarSettingsPageComponent,
  getCalendarConnection,
  CONNECT_URL,
} from './CalendarSettingsPage';

const { screen } = testingLibrary;

const userWith = profile => createCurrentUser('coach1', { profile: { ...profile } });
const notConnected = userWith({ publicData: {}, privateData: {} });
const connected = userWith({
  publicData: { calendarConnected: true, calendarProvider: 'google' },
  privateData: {
    nylasGrantId: 'grant-1',
    nylasGrantProvider: 'google',
    nylasGrantEmail: 'coach@example.com',
  },
});

const broken = userWith({
  publicData: { calendarConnected: true, calendarProvider: 'google' },
  privateData: {
    nylasGrantId: 'grant-1',
    nylasGrantProvider: 'google',
    nylasGrantEmail: 'coach@example.com',
    calendarStatus: 'reconnect_needed',
  },
});

const renderPage = (currentUser, search = '', goTo = undefined, onSaveHours = jest.fn()) =>
  render(
    <CalendarSettingsPageComponent
      currentUser={currentUser}
      scrollingDisabled={false}
      location={{ search }}
      goTo={goTo}
      onSaveHours={onSaveHours}
    />
  );

describe('getCalendarConnection()', () => {
  it('is connected, with the account email, once the callback has stored the grant', () => {
    expect(getCalendarConnection(connected)).toEqual({
      connected: true,
      reconnectNeeded: false,
      email: 'coach@example.com',
    });
  });

  it('is not connected for a coach with no calendar, or no user at all', () => {
    const none = { connected: false, reconnectNeeded: false, email: null };
    expect(getCalendarConnection(notConnected)).toEqual(none);
    expect(getCalendarConnection(null)).toEqual(none);
  });

  it('is still connected, without an email, if only the public flag is present', () => {
    expect(getCalendarConnection(userWith({ publicData: { calendarConnected: true } }))).toEqual({
      connected: true,
      reconnectNeeded: false,
      email: null,
    });
  });

  it('a coach whose Google connection broke is NOT connected, and needs to reconnect', () => {
    expect(getCalendarConnection(broken)).toEqual({
      connected: false,
      reconnectNeeded: true,
      email: 'coach@example.com',
    });
  });

  it('"reconnect needed" with no calendar ever connected means nothing', () => {
    const odd = userWith({ publicData: {}, privateData: { calendarStatus: 'reconnect_needed' } });
    expect(getCalendarConnection(odd).reconnectNeeded).toBe(false);
  });

  it('is connected again once the mark is cleared', () => {
    const cleared = userWith({
      publicData: { calendarConnected: true },
      privateData: { nylasGrantId: 'grant-1', calendarStatus: 'connected' },
    });
    expect(getCalendarConnection(cleared).connected).toBe(true);
  });
});

describe('CalendarSettingsPage when the Google connection broke', () => {
  it('says "Reconnect needed" instead of "connected", with a Reconnect Google Calendar button', () => {
    renderPage(broken);

    expect(screen.getByTestId('reconnectNeeded')).toBeInTheDocument();
    expect(screen.getByText('CalendarSettingsPage.reconnectNeededTitle')).toBeInTheDocument();
    expect(screen.getByText('CalendarSettingsPage.reconnectNeededText')).toBeInTheDocument();
    expect(screen.queryByText('CalendarSettingsPage.connectedTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('CalendarSettingsPage.connectButton')).not.toBeInTheDocument();
  });

  it('the button goes to the same connect route, which brings the coach back here', () => {
    const goTo = jest.fn();
    renderPage(broken, '', goTo);
    screen.getByRole('button', { name: 'CalendarSettingsPage.reconnectButton' }).click();
    expect(goTo).toHaveBeenCalledWith(CONNECT_URL);
  });

  it('shows the working hours section as ever', () => {
    renderPage(broken);
    expect(screen.getByText('CalendarSettingsPage.hoursHeading')).toBeInTheDocument();
  });
});

describe('CalendarSettingsPage', () => {
  it('not connected: explains what connecting does and offers the connect button', () => {
    renderPage(notConnected);

    expect(screen.getByText('CalendarSettingsPage.notConnectedText')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'CalendarSettingsPage.connectButton' })
    ).toBeInTheDocument();
    expect(screen.queryByText('CalendarSettingsPage.connectedTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('CalendarSettingsPage.reconnect')).not.toBeInTheDocument();
  });

  it('the connect button goes to the Nylas connect route and comes back to this page', () => {
    const goTo = jest.fn();
    renderPage(notConnected, '', goTo);
    screen.getByRole('button', { name: 'CalendarSettingsPage.connectButton' }).click();

    expect(goTo).toHaveBeenCalledWith(CONNECT_URL);
    expect(CONNECT_URL).toBe('/api/nylas/connect?provider=google&returnPath=%2Faccount%2Fcalendar');
  });

  it('connected: says so, shows the account and offers Reconnect, but no connect button', () => {
    renderPage(connected);

    expect(screen.getByText('CalendarSettingsPage.connectedTitle')).toBeInTheDocument();
    expect(screen.getByText('CalendarSettingsPage.connectedAs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CalendarSettingsPage.reconnect' })).toHaveAttribute(
      'href',
      CONNECT_URL
    );
    expect(
      screen.queryByRole('button', { name: 'CalendarSettingsPage.connectButton' })
    ).not.toBeInTheDocument();
  });

  it('shows the result the Nylas callback sends back', () => {
    renderPage(connected, '?calendarConnect=connected');
    expect(screen.getByRole('status')).toHaveTextContent('CalendarSettingsPage.resultConnected');
  });

  it('shows a declined and a failed connect as messages too', () => {
    const { unmount } = renderPage(notConnected, '?calendarConnect=declined');
    expect(screen.getByRole('status')).toHaveTextContent('CalendarSettingsPage.resultDeclined');
    unmount();

    renderPage(notConnected, '?calendarConnect=failed');
    expect(screen.getByRole('status')).toHaveTextContent('CalendarSettingsPage.resultFailed');
  });

  it('shows no message on an ordinary visit', () => {
    renderPage(notConnected);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the working hours section whether or not a calendar is connected', () => {
    const { unmount } = renderPage(notConnected);
    expect(screen.getByText('CalendarSettingsPage.hoursHeading')).toBeInTheDocument();
    unmount();

    renderPage(connected);
    expect(screen.getByText('CalendarSettingsPage.hoursHeading')).toBeInTheDocument();
  });
});
