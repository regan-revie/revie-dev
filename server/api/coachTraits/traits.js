/**
 * Coach-level traits: asked once on the coach's profile (user public data) and copied onto every
 * one of their session listings (listing public data), because search can only filter on listing
 * data, never on the author's profile.
 *
 *   profile (user public)        ->  listing (public)
 *   personality_identifier       ->  identity
 *   languages                    ->  language
 *   location                     ->  coachlocation
 *   communication_style          ->  communication_style
 *
 * Only these four public fields are copied. The user's private `identity` (gender) is a different
 * field that happens to share a key with the listing's `identity` tags; it is never read here.
 *
 * Option keys are not renamed in Console (values are already stored on Live listings under the
 * listing's keys), so where a user option and a listing option share a meaning but not a key, the
 * difference is translated here, in `OPTION_MAP`.
 *
 * Everything in this file is pure (no I/O), so it can be tested exhaustively.
 */

// What each trait is, and the listing keys that are valid for it. `kind` is how Sharetribe stores
// it: a multi-enum is an array of option keys, an enum is one option key.
const TRAITS = [
  {
    userKey: 'personality_identifier',
    listingKey: 'identity',
    kind: 'multi',
    // user option key -> listing option key, for those that differ
    optionMap: {
      neurodivergent: 'neurdivergent',
      empath: 'hsp',
      'chronic-illness': 'chronically-ill',
      immigrant: 'expat',
      'first-generation': 'first-gen',
    },
    listingOptions: [
      'neurdivergent',
      'introvert',
      'extrovert',
      'ambivert',
      'chronically-ill',
      'hsp',
      'burnout',
      'mental-health',
      'queer',
      'poc',
      'parent',
      'single-parent',
      'expat',
      'ex-corporate',
      'first-gen',
      // Added Nov 2026: same key on the profile and the listing, so no entry in optionMap.
      'perimenopause',
      'disabled',
      'caregiver',
    ],
  },
  {
    userKey: 'languages',
    listingKey: 'language',
    kind: 'multi',
    optionMap: {},
    listingOptions: [
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
  },
  {
    userKey: 'location',
    listingKey: 'coachlocation',
    kind: 'single',
    optionMap: {
      'middle-east': 'middleeast',
      'latin-america': 'latam',
      'south-america': 'southam',
    },
    listingOptions: [
      'us',
      'canada',
      'europe',
      'uk',
      'middleeast',
      'africa',
      'asia',
      'latam',
      'southam',
      // Added Nov 2026: same key on the profile and the listing.
      'australia-nz',
    ],
  },
  {
    userKey: 'communication_style',
    listingKey: 'communication_style',
    kind: 'multi',
    optionMap: {},
    listingOptions: [
      'direct',
      'empathetic',
      'analytical',
      'supportive',
      'challenging',
      'intuitive',
    ],
  },
];

const USER_KEYS = TRAITS.map(t => t.userKey);
const LISTING_KEYS = TRAITS.map(t => t.listingKey);

const reverseMap = map =>
  Object.keys(map).reduce((inverse, key) => ({ ...inverse, [map[key]]: key }), {});

// A user option's listing key, or itself when it is spelled the same on both sides.
const toListingOption = (trait, option) => trait.optionMap[option] || option;
const toUserOption = (trait, option) => reverseMap(trait.optionMap)[option] || option;

/** A stored value as a clean array of option keys (a single enum becomes a one-item array). */
const asOptions = value => {
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && v !== '');
  if (typeof value === 'string' && value !== '') return [value];
  return [];
};

const sameOptions = (a, b) => {
  const x = [...asOptions(a)].sort();
  const y = [...asOptions(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** The value in the shape Sharetribe stores for this trait. */
const shaped = (trait, options) => (trait.kind === 'single' ? options[0] : options);

/**
 * What a coach's profile says their listings should carry.
 *
 * Only traits with a value are returned: an empty profile value is never turned into an empty
 * listing value, because that would take a listing out of search. Options that exist on the profile
 * but have no listing counterpart are dropped and reported in `unmapped`, not guessed at.
 *
 * @param {object} userPublicData the user's `profile.publicData`
 * @returns {{traits: object, unmapped: {key: string, option: string}[]}} `traits` is keyed by
 *   listing key
 */
const listingTraitsFromProfile = userPublicData => {
  const data = userPublicData || {};
  const traits = {};
  const unmapped = [];
  TRAITS.forEach(trait => {
    const mapped = [];
    asOptions(data[trait.userKey]).forEach(option => {
      const listingOption = toListingOption(trait, option);
      if (trait.listingOptions.includes(listingOption)) {
        if (!mapped.includes(listingOption)) mapped.push(listingOption);
      } else {
        unmapped.push({ key: trait.userKey, option });
      }
    });
    if (mapped.length > 0) {
      // Keep the listing's own option order, so the same set is always the same value.
      const ordered = trait.listingOptions.filter(o => mapped.includes(o));
      traits[trait.listingKey] = shaped(trait, ordered);
    }
  });
  return { traits, unmapped };
};

/**
 * Of the traits a profile wants on a listing, those the listing does not already carry.
 * An empty result means the listing is already in step and nothing should be written.
 */
const listingTraitChanges = (listingPublicData, wanted) =>
  Object.keys(wanted).reduce((changes, key) => {
    const trait = TRAITS.find(t => t.listingKey === key);
    return sameOptions((listingPublicData || {})[key], wanted[key])
      ? changes
      : { ...changes, [key]: shaped(trait, asOptions(wanted[key])) };
  }, {});

/**
 * The reverse, for the one-off move at cutover: what profile values the listings of one coach
 * would fill in. Only traits the profile has nothing for are ever proposed (a profile answer is
 * never overwritten), and only options with a profile counterpart are carried over.
 *
 * Several listings: a multi-enum trait takes the union of what they say. A single value (location)
 * is taken only when every listing that has one agrees; otherwise it is left for the coach and
 * reported in `conflicts`.
 *
 * @param {object} userPublicData
 * @param {object[]} listingsPublicData one publicData object per listing
 * @returns {{traits: object, conflicts: string[], unmapped: {key: string, option: string}[]}}
 *   `traits` is keyed by user key
 */
const profileTraitsFromListings = (userPublicData, listingsPublicData) => {
  const user = userPublicData || {};
  const traits = {};
  const conflicts = [];
  const unmapped = [];

  TRAITS.forEach(trait => {
    if (asOptions(user[trait.userKey]).length > 0) return; // never overwrite an answer

    const perListing = (listingsPublicData || [])
      .map(data => asOptions((data || {})[trait.listingKey]))
      .filter(options => options.length > 0);
    if (perListing.length === 0) return;

    if (trait.kind === 'single') {
      const first = perListing[0][0];
      if (!perListing.every(options => options[0] === first)) {
        conflicts.push(trait.listingKey);
        return;
      }
      if (!trait.listingOptions.includes(first)) {
        unmapped.push({ key: trait.listingKey, option: first });
        return;
      }
      traits[trait.userKey] = toUserOption(trait, first);
      return;
    }

    const union = [];
    perListing.forEach(options =>
      options.forEach(option => {
        if (!trait.listingOptions.includes(option)) {
          unmapped.push({ key: trait.listingKey, option });
        } else if (!union.includes(option)) {
          union.push(option);
        }
      })
    );
    const ordered = trait.listingOptions
      .filter(o => union.includes(o))
      .map(o => toUserOption(trait, o));
    if (ordered.length > 0) traits[trait.userKey] = ordered;
  });

  return { traits, conflicts, unmapped };
};

module.exports = {
  TRAITS,
  USER_KEYS,
  LISTING_KEYS,
  asOptions,
  sameOptions,
  listingTraitsFromProfile,
  listingTraitChanges,
  profileTraitsFromListings,
};
