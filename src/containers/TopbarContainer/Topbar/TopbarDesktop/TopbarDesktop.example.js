import React from 'react';

import { useConfiguration } from '../../../../context/configurationContext';
import { useIntl } from '../../../../util/reactIntl';

import TopbarDesktop from './TopbarDesktop';

// The real desktop topbar for a logged-out visitor, with the configured links, so the search field
// can be checked at 1024px and 1280px without an account.
const Preview = () => {
  const config = useConfiguration();
  const intl = useIntl();
  return (
    <TopbarDesktop
      config={config}
      intl={intl}
      isAuthenticated={false}
      currentUser={null}
      currentPage="LandingPage"
      notificationCount={0}
      onLogout={() => {}}
      onSearchSubmit={values => console.log('search', values)}
      showSearchForm={true}
      showCreateListingsLink={false}
      customLinks={config?.topbar?.customLinks}
    />
  );
};

export const LoggedOut = { component: Preview, props: {}, group: 'navigation' };
