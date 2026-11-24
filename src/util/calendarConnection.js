/**
 * Whether a coach has a working calendar connection, from what the Nylas connect callback
 * (server/api/nylas/callback.js) stored on their user: a public flag (`calendarConnected`) and,
 * readable only by them, the Nylas grant id, the email of the connected account and, if Google has
 * stopped honouring the connection, `calendarStatus: 'reconnect_needed'` (server/api/nylas/grantStatus.js).
 *
 * A coach who needs to reconnect is NOT `connected`: the Calendar page and the session setup card
 * treat that as "not done", with a way to reconnect.
 *
 * @param {propTypes.currentUser} currentUser
 * @returns {{connected: boolean, reconnectNeeded: boolean, email: string|null}}
 */
export const getCalendarConnection = currentUser => {
  const profile = currentUser?.attributes?.profile || {};
  const privateData = profile.privateData || {};
  const publicData = profile.publicData || {};
  const hasConnection = !!(publicData.calendarConnected || privateData.nylasGrantId);
  const reconnectNeeded = hasConnection && privateData.calendarStatus === 'reconnect_needed';
  const connected = hasConnection && !reconnectNeeded;
  return {
    connected,
    reconnectNeeded,
    email: hasConnection ? privateData.nylasGrantEmail || null : null,
  };
};

// Where a coach is sent to (re)connect Google: a full page load that leaves the app for Google and
// comes back to the Calendar page. `returnPath` is honoured by connect.js only when it is relative.
export const CALENDAR_PATH = '/account/calendar';
export const CONNECT_URL = `/api/nylas/connect?provider=google&returnPath=${encodeURIComponent(
  CALENDAR_PATH
)}`;

/** A full page load to a URL: leaving the app for Google and coming back. A function so tests can spy on it. */
export const goToUrl = url => {
  if (typeof window !== 'undefined') window.location.assign(url);
};
