import {
  COACH_TRAIT_LISTING_KEYS,
  COACH_TRAIT_USER_KEYS,
  missingCoachTraits,
  requiredCoachTraitKeys,
  withCoachTraitsRequired,
} from './coachTraits';

const field = (key, userTypeConfig) => ({
  key,
  scope: 'public',
  schemaType: 'enum',
  userTypeConfig,
});
const coachOnly = { limitToUserTypeIds: true, userTypeIds: ['coach'] };
const clientOnly = { limitToUserTypeIds: true, userTypeIds: ['client'] };

const userWith = publicData => ({ attributes: { profile: { publicData } } });

describe('coachTraits', () => {
  it('names the four profile fields and the four listing fields they are copied to', () => {
    expect(COACH_TRAIT_USER_KEYS).toEqual([
      'personality_identifier',
      'languages',
      'location',
      'communication_style',
    ]);
    expect(COACH_TRAIT_LISTING_KEYS).toEqual([
      'identity',
      'language',
      'coachlocation',
      'communication_style',
    ]);
  });

  describe('requiredCoachTraitKeys', () => {
    it('lists the traits that exist as user fields for coaches, and only those', () => {
      const userFields = [
        field('location'), // for every user type
        field('languages', coachOnly),
        field('personality_identifier', clientOnly), // not for coaches
        field('pronouns'), // not a trait
        // communication_style not created yet in Console
      ];
      expect(requiredCoachTraitKeys(userFields)).toEqual(['languages', 'location']);
    });

    it('is empty when none exist, or there is no config', () => {
      expect(requiredCoachTraitKeys([])).toEqual([]);
      expect(requiredCoachTraitKeys(undefined)).toEqual([]);
    });
  });

  describe('missingCoachTraits', () => {
    const userFields = COACH_TRAIT_USER_KEYS.map(key => field(key));

    it('reports every trait with no answer, treating an empty list as no answer', () => {
      const user = userWith({ location: 'uk', languages: [], personality_identifier: undefined });
      expect(missingCoachTraits(user, userFields)).toEqual([
        'personality_identifier',
        'languages',
        'communication_style',
      ]);
    });

    it('is empty when all are answered', () => {
      const user = userWith({
        personality_identifier: ['introvert'],
        languages: ['english'],
        location: 'uk',
        communication_style: ['direct'],
      });
      expect(missingCoachTraits(user, userFields)).toEqual([]);
    });

    it('does not ask for a trait whose field is not configured, so nobody is stuck on it', () => {
      const user = userWith({ languages: ['english'], location: 'uk' });
      const withoutStyle = userFields.filter(f => f.key !== 'communication_style');
      expect(missingCoachTraits(user, withoutStyle)).toEqual(['personality_identifier']);
    });

    it('handles no user yet', () => {
      expect(missingCoachTraits(null, userFields)).toEqual(COACH_TRAIT_USER_KEYS);
    });
  });

  describe('withCoachTraitsRequired', () => {
    it('makes the four traits required for coaches', () => {
      const config = { key: 'languages', saveConfig: { label: 'Languages' } };
      expect(withCoachTraitsRequired(config, 'coach').saveConfig).toEqual({
        label: 'Languages',
        isRequired: true,
      });
    });

    it('leaves clients, and every other field, as Console has them', () => {
      const traitConfig = { key: 'languages', saveConfig: {} };
      expect(withCoachTraitsRequired(traitConfig, 'client')).toBe(traitConfig);
      const other = { key: 'pronouns', saveConfig: {} };
      expect(withCoachTraitsRequired(other, 'coach')).toBe(other);
    });
  });
});
