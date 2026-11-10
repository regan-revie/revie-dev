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

const renderPage = (currentUser, search = '', goTo = undefined) =>
  render(
    <CalendarSettingsPageComponent
      currentUser={currentUser}
      scrollingDisabled={false}
      location={{ search }}
      goTo={goTo}
    />
  );

describe('getCalendarConnection()', () => {
  it('is connected, with the account email, once the callback has stored the grant', () => {
    expect(getCalendarConnection(connected)).toEqual({
      connected: true,
      email: 'coach@example.com',
    });
  });

  it('is not connected for a coach with no calendar, or no user at all', () => {
    expect(getCalendarConnection(notConnected)).toEqual({ connected: false, email: null });
    expect(getCalendarConnection(null)).toEqual({ connected: false, email: null });
  });

  it('is still connected, without an email, if only the public flag is present', () => {
    expect(getCalendarConnection(userWith({ publicData: { calendarConnected: true } }))).toEqual({
      connected: true,
      email: null,
    });
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
});
