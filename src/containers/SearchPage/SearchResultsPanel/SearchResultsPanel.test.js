import React, { act } from 'react';
import '@testing-library/jest-dom';

import { createListing, fakeIntl } from '../../../util/testData';
import { getHostedConfiguration, renderWithProviders as render } from '../../../util/testHelpers';
import { testingLibrary } from '../../../util/testHelpers';

import SearchResultsPanel from './SearchResultsPanel';
import NoSearchResultsMaybe from '../NoSearchResultsMaybe/NoSearchResultsMaybe';

const { screen } = testingLibrary;

const match = createListing('match1', { title: 'Matching session' });
const other1 = createListing('other1', { title: 'Another session' });
const other2 = createListing('other2', { title: 'A third session' });

const renderPanel = async props => {
  await act(async () => {
    render(
      <SearchResultsPanel
        listings={[match]}
        pagination={null}
        search={{}}
        intl={fakeIntl}
        isMapVariant={false}
        {...props}
      />,
      { config: getHostedConfiguration() }
    );
  });
};

describe('SearchResultsPanel: other sessions below a search with few matches', () => {
  it('shows the matches first, then the other sessions under their own heading and copy', async () => {
    await renderPanel({ otherListings: [other1, other2] });

    expect(screen.getByText('Matching session')).toBeInTheDocument();
    expect(screen.getByText('SearchResultsPanel.otherSessionsHeading')).toBeInTheDocument();
    expect(screen.getByText('SearchResultsPanel.otherSessionsIntro')).toBeInTheDocument();
    expect(screen.getByText('Another session')).toBeInTheDocument();
    expect(screen.getByText('A third session')).toBeInTheDocument();
  });

  it('never shows a match twice', async () => {
    await renderPanel({ otherListings: [match, other1] });
    expect(screen.getAllByText('Matching session')).toHaveLength(1);
    expect(screen.getByText('Another session')).toBeInTheDocument();
  });

  it('shows no extra section when there is nothing to offer', async () => {
    await renderPanel({ otherListings: [] });
    expect(screen.queryByTestId('otherSessions')).toBeNull();
    expect(screen.queryByText('SearchResultsPanel.otherSessionsHeading')).toBeNull();
  });

  it('shows no extra section when the only candidates are the matches themselves', async () => {
    await renderPanel({ otherListings: [match] });
    expect(screen.queryByTestId('otherSessions')).toBeNull();
  });
});

describe('NoSearchResultsMaybe', () => {
  const base = {
    listingsAreLoaded: true,
    totalItems: 0,
    location: { search: '?pub_coachlocation=uk' },
    resetAll: () => {},
  };

  it('keeps the "no results" sentence when there is nothing else to show', () => {
    render(<NoSearchResultsMaybe {...base} hasOtherSessions={false} />);
    expect(screen.getByText('SearchPage.noResults')).toBeInTheDocument();
    expect(screen.getByText('SearchPage.resetAllFilters')).toBeInTheDocument();
  });

  it('drops the sentence but keeps the reset button when other sessions are offered below', () => {
    render(<NoSearchResultsMaybe {...base} hasOtherSessions />);
    expect(screen.queryByText('SearchPage.noResults')).toBeNull();
    expect(screen.getByText('SearchPage.resetAllFilters')).toBeInTheDocument();
  });
});
