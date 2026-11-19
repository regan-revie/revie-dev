import { isGenderField, isNeverPublicUserField, defaultHelpTextId } from './userFieldPolicy';
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

describe('gender (private identity): optional, on the account page, never at sign-up', () => {
  it('recognises only the private identity field', () => {
    expect(isGenderField(gender)).toBe(true);
    expect(isGenderField(tags)).toBe(false);
    expect(isGenderField(location)).toBe(false);
  });

  it('is not asked at sign-up, for coaches or clients, even if Console shows it there', () => {
    const configs = [gender, location];
    ['client', 'coach'].forEach(userType => {
      const keys = getPropsForCustomUserFieldInputs(configs, userType, true).map(p => p.key);
      expect(keys).not.toContain('priv_identity');
    });
    // A coach still gets location at sign-up, so the list is not simply empty.
    expect(getPropsForCustomUserFieldInputs(configs, 'coach', true).map(p => p.key)).toEqual([
      'pub_location',
    ]);
  });

  it('is asked on the profile / account form, for coaches and clients', () => {
    const configs = [gender, location];
    ['client', 'coach'].forEach(userType => {
      const keys = getPropsForCustomUserFieldInputs(configs, userType, false).map(p => p.key);
      expect(keys).toContain('priv_identity');
    });
  });

  it('is private and optional, so it is saved only to privateData and never required', () => {
    const configs = [gender, location];
    const values = { priv_identity: 'woman', pub_location: 'uk' };
    expect(pickUserFieldsData(values, 'private', 'client', configs)).toEqual({
      identity: 'woman',
    });
    expect(pickUserFieldsData(values, 'public', 'client', configs)).toEqual({ location: 'uk' });
    expect(gender.saveConfig.isRequired).toBe(false);
  });

  it('keeps a stored answer: it loads into the form values and is saved back unchanged', () => {
    const configs = [gender, location];
    const initial = initialValuesForUserFields({ identity: 'woman' }, 'private', 'client', configs);
    expect(initial).toEqual({ priv_identity: 'woman' });
    expect(pickUserFieldsData(initial, 'private', 'client', configs)).toEqual({
      identity: 'woman',
    });
  });

  it('has default help text unless Console supplies its own', () => {
    expect(defaultHelpTextId(gender)).toBe('UserField.genderHelpText');
    expect(defaultHelpTextId({ ...gender, helpText: 'From Console' })).toBeNull();
    expect(defaultHelpTextId(tags)).toBeNull();
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
