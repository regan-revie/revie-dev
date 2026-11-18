const {
  TRAITS,
  listingTraitsFromProfile,
  listingTraitChanges,
  profileTraitsFromListings,
} = require('./traits');

describe('coach traits: profile -> listing', () => {
  it('copies the four public traits to the listing keys', () => {
    const { traits } = listingTraitsFromProfile({
      personality_identifier: ['introvert', 'burnout'],
      languages: ['english', 'french'],
      location: 'uk',
      communication_style: ['direct'],
    });
    expect(traits).toEqual({
      identity: ['introvert', 'burnout'],
      language: ['english', 'french'],
      coachlocation: 'uk',
      communication_style: ['direct'],
    });
  });

  it('translates option keys that differ, without renaming anything in Console', () => {
    const { traits } = listingTraitsFromProfile({
      personality_identifier: [
        'neurodivergent',
        'empath',
        'chronic-illness',
        'immigrant',
        'first-generation',
      ],
      location: 'middle-east',
    });
    expect(traits.identity.sort()).toEqual(
      ['neurdivergent', 'hsp', 'chronically-ill', 'expat', 'first-gen'].sort()
    );
    expect(traits.coachlocation).toBe('middleeast');
    expect(listingTraitsFromProfile({ location: 'latin-america' }).traits.coachlocation).toBe(
      'latam'
    );
    expect(listingTraitsFromProfile({ location: 'south-america' }).traits.coachlocation).toBe(
      'southam'
    );
  });

  it('every option on every profile field has a listing counterpart (no silent drops)', () => {
    // The user-side option lists, as configured in Console on Dev.
    const userOptions = {
      personality_identifier: [
        'neurodivergent',
        'introvert',
        'extrovert',
        'ambivert',
        'empath',
        'chronic-illness',
        'burnout',
        'mental-health',
        'queer',
        'poc',
        'parent',
        'single-parent',
        'immigrant',
        'ex-corporate',
        'first-generation',
      ],
      languages: [
        'english',
        'spanish',
        'french',
        'italian',
        'hebrew',
        'mandarin',
        'japanese',
        'portuguese',
        'arabic',
      ],
      location: [
        'us',
        'uk',
        'canada',
        'europe',
        'middle-east',
        'africa',
        'asia',
        'latin-america',
        'south-america',
      ],
      communication_style: [
        'direct',
        'empathetic',
        'analytical',
        'supportive',
        'challenging',
        'intuitive',
      ],
    };
    TRAITS.forEach(trait => {
      const options = userOptions[trait.userKey];
      options.forEach(option => {
        const { traits, unmapped } = listingTraitsFromProfile({
          [trait.userKey]: trait.kind === 'single' ? option : [option],
        });
        expect(unmapped).toEqual([]);
        expect(traits[trait.listingKey]).toBeDefined();
      });
      // And the mapping is one-to-one: nothing collapses two options into one.
      const mappedTo = options.map(o => trait.optionMap[o] || o);
      expect(new Set(mappedTo).size).toBe(options.length);
      expect(mappedTo.every(o => trait.listingOptions.includes(o))).toBe(true);
    });
  });

  it('never reads the private gender identity, which shares a key name with the listing tags', () => {
    const { traits } = listingTraitsFromProfile({ identity: 'woman', pronouns: 'she-her' });
    expect(traits).toEqual({});
  });

  it('never produces a value for an empty profile answer, so a listing is never cleared', () => {
    expect(
      listingTraitsFromProfile({
        personality_identifier: [],
        languages: undefined,
        location: '',
        communication_style: null,
      }).traits
    ).toEqual({});
    expect(listingTraitsFromProfile(undefined).traits).toEqual({});
  });

  it('drops and reports an option with no listing counterpart instead of guessing', () => {
    const { traits, unmapped } = listingTraitsFromProfile({ languages: ['english', 'klingon'] });
    expect(traits.language).toEqual(['english']);
    expect(unmapped).toEqual([{ key: 'languages', option: 'klingon' }]);
  });

  it('gives the same value whatever order the profile lists options in', () => {
    const a = listingTraitsFromProfile({ languages: ['french', 'english'] }).traits;
    const b = listingTraitsFromProfile({ languages: ['english', 'french'] }).traits;
    expect(a).toEqual(b);
  });
});

describe('listingTraitChanges', () => {
  it('is empty when the listing already matches, whatever the order', () => {
    expect(
      listingTraitChanges(
        { language: ['french', 'english'], coachlocation: 'uk' },
        {
          language: ['english', 'french'],
          coachlocation: 'uk',
        }
      )
    ).toEqual({});
  });

  it('returns only what differs, and leaves traits the profile has no answer for alone', () => {
    const wanted = { language: ['english'], coachlocation: 'uk' };
    expect(
      listingTraitChanges(
        { language: ['english'], coachlocation: 'us', identity: ['burnout'] },
        wanted
      )
    ).toEqual({ coachlocation: 'uk' });
  });

  it('fills a listing that has none', () => {
    expect(listingTraitChanges({}, { language: ['english'] })).toEqual({ language: ['english'] });
  });
});

describe('profileTraitsFromListings (cutover, reverse)', () => {
  it('fills only the traits the profile has no answer for', () => {
    const { traits } = profileTraitsFromListings({ languages: ['english'] }, [
      { language: ['french'], coachlocation: 'uk', identity: ['hsp', 'expat'] },
    ]);
    expect(traits).toEqual({
      location: 'uk',
      personality_identifier: ['empath', 'immigrant'],
    });
  });

  it('never overwrites an answer already on the profile', () => {
    expect(profileTraitsFromListings({ location: 'us' }, [{ coachlocation: 'uk' }]).traits).toEqual(
      {}
    );
  });

  it('unions multi-value traits across listings and translates keys back', () => {
    const { traits } = profileTraitsFromListings({}, [
      { language: ['english'], coachlocation: 'latam' },
      { language: ['french', 'english'], coachlocation: 'latam' },
    ]);
    expect(traits.languages).toEqual(['english', 'french']);
    expect(traits.location).toBe('latin-america');
  });

  it('leaves a single value alone and reports it when listings disagree', () => {
    const { traits, conflicts } = profileTraitsFromListings({}, [
      { coachlocation: 'uk' },
      { coachlocation: 'us' },
    ]);
    expect(traits.location).toBeUndefined();
    expect(conflicts).toEqual(['coachlocation']);
  });

  it('does nothing for a coach whose listings carry nothing', () => {
    expect(profileTraitsFromListings({}, [{}, {}]).traits).toEqual({});
  });
});
