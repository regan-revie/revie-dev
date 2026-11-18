import React from 'react';
import '@testing-library/jest-dom';

import { fakeIntl } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import CustomListingFields from './CustomListingFields';

const { screen } = testingLibrary;

// Console's defaults make a short-text field a "detail" shown on the listing page, as here.
const shortText = (key, label) => ({
  key,
  scope: 'public',
  schemaType: 'shortText',
  showConfig: { label, isDetail: true, displayOnListingPage: true },
  saveConfig: { label },
});
const enumField = {
  key: 'structure',
  scope: 'public',
  schemaType: 'enum',
  enumOptions: [{ option: 'flexible', label: 'Flexible' }],
  showConfig: { label: 'Session Structure', isDetail: true, displayOnListingPage: true },
  saveConfig: { label: 'Session Structure' },
};

const renderFields = publicData =>
  render(
    <CustomListingFields
      publicData={publicData}
      metadata={{}}
      listingFieldConfigs={[
        enumField,
        shortText('outcome_1', 'Outcome 1'),
        shortText('outcome_2', 'Outcome 2'),
        shortText('outcome_3', 'Outcome 3'),
        shortText('tagline', 'Tagline'),
      ]}
      categoryConfiguration={{ key: 'categoryLevel', categories: [] }}
      intl={fakeIntl}
    />
  );

describe('CustomListingFields', () => {
  it('does not list the outcomes as details: they have their own numbered section', () => {
    renderFields({
      structure: 'flexible',
      outcome_1: 'A clear decision',
      outcome_2: 'A script',
      outcome_3: 'A plan',
      tagline: 'Hello',
    });
    expect(screen.queryByText('Outcome 1')).not.toBeInTheDocument();
    expect(screen.queryByText('A clear decision')).not.toBeInTheDocument();
    expect(screen.queryByText('Outcome 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Outcome 3')).not.toBeInTheDocument();
  });

  it('still lists other fields as details', () => {
    renderFields({ structure: 'flexible', tagline: 'Hello' });
    expect(screen.getByText('Session Structure')).toBeInTheDocument();
    expect(screen.getByText('Flexible')).toBeInTheDocument();
    expect(screen.getByText('Tagline')).toBeInTheDocument();
  });
});
