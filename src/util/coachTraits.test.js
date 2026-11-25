import {
  COACH_REQUIRED_PROFILE_KEYS,
  PROFILE_FIELD_MAX_LENGTHS,
  withProfileFieldLimits,
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

  describe("coach_title (the one-line title under a coach's name)", () => {
    it('is required of coaches with the four traits, but is not a trait copied to listings', () => {
      expect(COACH_REQUIRED_PROFILE_KEYS).toEqual([
        ...COACH_TRAIT_USER_KEYS,
        'coach_title',
        'clients_love',
      ]);
      expect(COACH_TRAIT_USER_KEYS).not.toContain('coach_title');
      expect(COACH_TRAIT_LISTING_KEYS).toHaveLength(4);
    });

    it('is made required for a coach, and left as it is for a client', () => {
      const title = field('coach_title');
      expect(withCoachTraitsRequired(title, 'coach').saveConfig.isRequired).toBe(true);
      expect(withCoachTraitsRequired(title, 'client')).toBe(title);
    });

    it('counts toward "Finish your profile" once the field exists for coaches', () => {
      const userFields = [...COACH_TRAIT_USER_KEYS, 'coach_title'].map(key =>
        field(key, coachOnly)
      );
      const allFour = {
        personality_identifier: ['x'],
        languages: ['x'],
        location: 'x',
        communication_style: ['x'],
      };
      expect(requiredCoachTraitKeys(userFields)).toContain('coach_title');
      expect(missingCoachTraits(userWith(allFour), userFields)).toEqual(['coach_title']);
      expect(
        missingCoachTraits(userWith({ ...allFour, coach_title: 'Career coach' }), userFields)
      ).toEqual([]);
    });

    it('does not count while the field has not been created in Console', () => {
      const userFields = COACH_TRAIT_USER_KEYS.map(key => field(key, coachOnly));
      expect(requiredCoachTraitKeys(userFields)).not.toContain('coach_title');
    });
  });

  describe('clients_love ("Clients love working with me because...")', () => {
    it('is made required for a coach, and left as it is for a client', () => {
      const love = field('clients_love');
      expect(withCoachTraitsRequired(love, 'coach').saveConfig.isRequired).toBe(true);
      expect(withCoachTraitsRequired(love, 'client')).toBe(love);
    });

    it('counts toward "Finish your profile" once the field exists for coaches', () => {
      const userFields = [...COACH_TRAIT_USER_KEYS, 'coach_title', 'clients_love'].map(key =>
        field(key, coachOnly)
      );
      const answered = {
        personality_identifier: ['x'],
        languages: ['x'],
        location: 'x',
        communication_style: ['x'],
        coach_title: 'Career coach',
      };
      expect(requiredCoachTraitKeys(userFields)).toContain('clients_love');
      expect(missingCoachTraits(userWith(answered), userFields)).toEqual(['clients_love']);
      expect(
        missingCoachTraits(userWith({ ...answered, clients_love: 'I listen.' }), userFields)
      ).toEqual([]);
    });

    it('does not count while the field has not been created in Console', () => {
      const userFields = [...COACH_TRAIT_USER_KEYS, 'coach_title'].map(key =>
        field(key, coachOnly)
      );
      expect(requiredCoachTraitKeys(userFields)).not.toContain('clients_love');
    });

    it('is not asked of a field that exists for clients only, and is not copied to listings', () => {
      const userFields = [field('clients_love', clientOnly)];
      expect(requiredCoachTraitKeys(userFields)).toEqual([]);
      expect(COACH_TRAIT_LISTING_KEYS).toHaveLength(4);
    });
  });

  describe('length limits', () => {
    it('are 40 characters for the title and 200 for "Clients love working with me because..."', () => {
      expect(PROFILE_FIELD_MAX_LENGTHS).toEqual({ coach_title: 40, clients_love: 200 });
      expect(withProfileFieldLimits(field('coach_title')).maxLength).toBe(40);
      expect(withProfileFieldLimits(field('clients_love')).maxLength).toBe(200);
    });

    it('leave other fields alone', () => {
      const other = field('location');
      expect(withProfileFieldLimits(other)).toBe(other);
    });
  });
});
