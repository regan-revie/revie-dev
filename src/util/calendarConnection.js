/**
 * Whether a coach has a connected calendar, from what the Nylas connect callback
 * (server/api/nylas/callback.js) stored on their user: a public flag (`calendarConnected`) and,
 * readable only by them, the Nylas grant id and the email of the connected account. This says a
 * calendar was connected, not that its grant is still valid.
 *
 * @param {propTypes.currentUser} currentUser
 * @returns {{connected: boolean, email: string|null}}
 */
export const getCalendarConnection = currentUser => {
  const profile = currentUser?.attributes?.profile || {};
  const privateData = profile.privateData || {};
  const publicData = profile.publicData || {};
  const connected = !!(publicData.calendarConnected || privateData.nylasGrantId);
  return { connected, email: connected ? privateData.nylasGrantEmail || null : null };
};
