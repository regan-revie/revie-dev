import React from 'react';
import '@testing-library/jest-dom';

import { pickCategoryFields } from '../../../../util/fieldHelpers';
import { fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingDetailsForm from './EditListingDetailsForm';
import { pickListingFieldsData } from './EditListingDetailsPanel';

const { screen } = testingLibrary;
const noop = () => null;

const enumField = (key, label, schemaType = 'multi-enum') => ({
  key,
  scope: 'public',
  schemaType,
  enumOptions: [{ option: 'a', label: `${label} A` }, { option: 'b', label: `${label} B` }],
  listingTypeConfig: { limitToListingTypeIds: false },
  showConfig: { label },
  saveConfig: { label, isRequired: true },
});

// The four coach-level traits (asked on the profile) plus one that stays per session.
const coachTraitFields = [
  enumField('identity', 'Identity & Background'),
  enumField('communication_style', 'Communication Style'),
  enumField('language', 'Session Language Options'),
  enumField('coachlocation', 'Coach Location', 'enum'),
];
const structure = enumField('structure', 'Session Structure', 'enum');

describe('session editor: coach-level traits are not asked per session', () => {
  const selectableListingTypes = [
    {
      listingType: 'signature-session',
      transactionProcessAlias: 'default-booking/release-1',
      unitType: 'fixed',
    },
  ];

  const renderForm = listingFieldsConfig =>
    render(
      <EditListingDetailsForm
        intl={fakeIntl}
        dispatch={noop}
        onListingTypeChange={noop}
        onSubmit={v => v}
        saveActionMsg="Save details"
        updated={false}
        updateInProgress={false}
        disabled={false}
        ready={false}
        listingFieldsConfig={listingFieldsConfig}
        categoryPrefix="categoryLevel"
        selectableCategories={[]}
        pickSelectedCategories={values => pickCategoryFields(values, 'categoryLevel', 1, [])}
        selectableListingTypes={selectableListingTypes}
        hasExistingListingType={true}
        initialValues={selectableListingTypes[0]}
        marketplaceCurrency="EUR"
      />
    );

  it('does not show identity, communication style, language or location', () => {
    renderForm([...coachTraitFields, structure]);
    [
      'Identity & Background',
      'Communication Style',
      'Session Language Options',
      'Coach Location',
    ].forEach(label => expect(screen.queryByText(label)).not.toBeInTheDocument());
  });

  it('still shows the fields that are per session (structure)', () => {
    renderForm([...coachTraitFields, structure]);
    expect(screen.getByText('Session Structure')).toBeInTheDocument();
  });
});

describe('session editor: saving Details never touches the coach-level traits', () => {
  const fields = [...coachTraitFields, structure];
  const pick = data => pickListingFieldsData(data, 'public', 'signature-session', {}, fields);

  it('leaves the four traits out of what it sends, so the server-written values are not blanked', () => {
    // A new listing has no values for them, which the stock code would turn into null.
    const picked = pick({ pub_structure: 'a' });
    expect(picked).toEqual({ structure: 'a' });
    ['identity', 'communication_style', 'language', 'coachlocation'].forEach(key =>
      expect(Object.prototype.hasOwnProperty.call(picked, key)).toBe(false)
    );
  });

  it('even if the form values somehow carry them', () => {
    const picked = pick({ pub_structure: 'a', pub_identity: ['a'], pub_coachlocation: 'b' });
    expect(Object.keys(picked)).toEqual(['structure']);
  });
});
