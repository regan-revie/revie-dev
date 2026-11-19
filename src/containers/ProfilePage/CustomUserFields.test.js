import React, { act } from 'react';
import '@testing-library/jest-dom';

import { fakeIntl } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { CustomUserFields } from './ProfilePage';

const { screen } = testingLibrary;

const enumField = (key, label, options) => ({
  key,
  scope: 'public',
  schemaType: 'enum',
  enumOptions: options.map(option => ({ option, label: option })),
  saveConfig: { label, isRequired: false, displayInSignUp: false },
  showConfig: { label, displayInProfile: true },
  userTypeConfig: { limitToUserTypeIds: false },
});

// Console has every one of these shown on the public profile; the code must hide the client's
// personal ones regardless.
const userFieldConfig = [
  enumField('pronouns', 'Pronouns', ['they-them']),
  enumField('support', 'How I am looking to grow', ['stress']),
  enumField('work', 'Work situation', ['freelancer']),
  enumField('client_wants', 'My ideal coach will', ['soft-coach']),
];

describe('public profile page: a client’s personal answers', () => {
  it('shows ordinary fields but never support, work or client_wants', async () => {
    await act(async () => {
      render(
        <CustomUserFields
          intl={fakeIntl}
          userFieldConfig={userFieldConfig}
          publicData={{
            userType: 'client',
            pronouns: 'they-them',
            support: 'stress',
            work: 'freelancer',
            client_wants: 'soft-coach',
          }}
          metadata={{}}
        />
      );
    });

    expect(screen.getByText('Pronouns')).toBeInTheDocument();
    expect(screen.queryByText('How I am looking to grow')).toBeNull();
    expect(screen.queryByText('Work situation')).toBeNull();
    expect(screen.queryByText('My ideal coach will')).toBeNull();
  });
});

describe('public profile page: gender', () => {
  it('never shows the private identity question or its answer', async () => {
    const gender = {
      ...enumField('identity', 'How do you identify?', ['woman']),
      scope: 'private',
    };
    await act(async () => {
      render(
        <CustomUserFields
          intl={fakeIntl}
          userFieldConfig={[enumField('pronouns', 'Pronouns', ['they-them']), gender]}
          // Even if the value somehow reached the page's public data, a private field is not shown.
          publicData={{ userType: 'client', pronouns: 'they-them', identity: 'woman' }}
          metadata={{}}
        />
      );
    });

    expect(screen.getByText('Pronouns')).toBeInTheDocument();
    expect(screen.queryByText('How do you identify?')).toBeNull();
    expect(screen.queryByText('Woman')).toBeNull();
  });
});
