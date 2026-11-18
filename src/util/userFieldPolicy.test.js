import { isRetiredUserField, isNeverPublicUserField } from './userFieldPolicy';
import {
  getPropsForCustomUserFieldInputs,
  initialValuesForUserFields,
  pickUserFieldsData,
} from './userHelpers';

const field = (key, scope, extra = {}) => ({
  key,
  scope,
  schemaType: 'enum',
  enumOptions: [{ option: 'woman', label: 'Woman' }],
  saveConfig: { label: key, isRequired: false, displayInSignUp: true },
  userTypeConfig: { limitToUserTypeIds: false },
  ...extra,
});

// The private gender question and the public identity tags share a key name only.
const gender = field('identity', 'private');
const tags = field('identity', 'public');
const location = field('location', 'public');

describe('retired user fields (gender)', () => {
  it('recognises only the private identity field', () => {
    expect(isRetiredUserField(gender)).toBe(true);
    expect(isRetiredUserField(tags)).toBe(false);
    expect(isRetiredUserField(location)).toBe(false);
  });

  it('is asked nowhere: not at sign-up, not on the profile or in account settings', () => {
    const configs = [gender, location];
    ['client', 'coach'].forEach(userType =>
      [true, false].forEach(isSignup => {
        const keys = getPropsForCustomUserFieldInputs(configs, userType, isSignup).map(p => p.key);
        expect(keys).not.toContain('priv_identity');
      })
    );
    // A coach still gets location at sign-up, so the list is not simply empty.
    expect(getPropsForCustomUserFieldInputs(configs, 'coach', true).map(p => p.key)).toEqual([
      'pub_location',
    ]);
  });

  it('keeps a stored answer: it still loads into the form values and is saved back unchanged', () => {
    const configs = [gender, location];
    const initial = initialValuesForUserFields({ identity: 'woman' }, 'private', 'client', configs);
    expect(initial).toEqual({ priv_identity: 'woman' });
    // Account settings saves private fields from the form's values, which carry the stored answer.
    expect(pickUserFieldsData(initial, 'private', 'client', configs)).toEqual({
      identity: 'woman',
    });
  });
});

describe('fields never shown on a public profile', () => {
  it('are the client’s personal answers', () => {
    ['support', 'work', 'client_wants'].forEach(key =>
      expect(isNeverPublicUserField({ key })).toBe(true)
    );
    ['pronouns', 'languages', 'location', 'focusareas'].forEach(key =>
      expect(isNeverPublicUserField({ key })).toBe(false)
    );
  });
});

describe('sign-up', () => {
  const configs = [location, field('support', 'public'), field('ageverification', 'private')];
  const keysFor = userType =>
    getPropsForCustomUserFieldInputs(configs, userType, true).map(p => p.fieldConfig.key);

  it('asks location of coaches but not of clients', () => {
    expect(keysFor('coach')).toContain('location');
    expect(keysFor('client')).not.toContain('location');
  });

  it('still asks everyone the age check', () => {
    expect(keysFor('coach')).toContain('ageverification');
    expect(keysFor('client')).toContain('ageverification');
  });

  it('asks clients for location on their profile, which is not sign-up', () => {
    const keys = getPropsForCustomUserFieldInputs(configs, 'client', false).map(
      p => p.fieldConfig.key
    );
    expect(keys).toContain('location');
  });
});
