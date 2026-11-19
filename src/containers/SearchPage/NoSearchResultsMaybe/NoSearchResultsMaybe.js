import React from 'react';
import { FormattedMessage } from '../../../util/reactIntl';
import { NamedLink } from '../../../components';

import css from './NoSearchResultsMaybe.module.css';

const NoSearchResultsMaybe = props => {
  const {
    listingsAreLoaded,
    totalItems,
    location,
    resetAll,
    showCreateListingsLink,
    hasOtherSessions,
  } = props;
  const hasNoResult = listingsAreLoaded && totalItems === 0;
  const hasSearchParams = location.search?.length > 0;

  const createListingLinkMaybe = showCreateListingsLink ? (
    <NamedLink className={css.createListingLink} name="NewListingPage">
      <FormattedMessage id="SearchPage.createListing" />
    </NamedLink>
  ) : null;

  return hasNoResult ? (
    <div className={css.noSearchResults}>
      {/* Revie: when other sessions are offered below, the results page is not a dead end, so the
          "no results" sentence is dropped and only the way back to all filters stays. */}
      {hasOtherSessions ? null : (
        <>
          <FormattedMessage id="SearchPage.noResults" />
          <br />
        </>
      )}
      {hasSearchParams ? (
        <button className={css.resetAllFiltersButton} onClick={e => resetAll(e)}>
          <FormattedMessage id={'SearchPage.resetAllFilters'} />
        </button>
      ) : null}
      <p>{createListingLinkMaybe}</p>
    </div>
  ) : null;
};

export default NoSearchResultsMaybe;
