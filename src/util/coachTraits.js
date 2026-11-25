/**
 * Coach-level traits. Asked once on the coach's profile and copied onto each of their session
 * listings by the server (server/api/coachTraits/), because search can only filter on listing data.
 * `server/api/coachTraits/traits.js` is the authority on the mapping; this file only knows which
 * keys are involved, to hide them in the session editor and to tell whether a profile is finished
 * (the one-line title, `coach_title`, and `clients_love` count toward that too).
 *
 *   profile (user public)   listing (public)
 *   personality_identifier  identity
 *   languages               language
 *   location                coachlocation
 *   communication_style     communication_style
 */

export const COACH_USER_TYPE = 'coach';

export const COACH_TRAIT_USER_KEYS = [
  'personality_identifier',
  'languages',
  'location',
  'communication_style',
];

// What a coach has to answer on the profile: the four traits above, plus the one-line title the
// session page shows under her name, plus "Clients love working with me because..." (the quote
// card on the session page, and so the big photo beside it). Neither is a search trait and neither
// is copied to listings.
export const COACH_TITLE_KEY = 'coach_title';
export const CLIENTS_LOVE_KEY = 'clients_love';
export const COACH_REQUIRED_PROFILE_KEYS = [
  ...COACH_TRAIT_USER_KEYS,
  COACH_TITLE_KEY,
  CLIENTS_LOVE_KEY,
];

// Length limits Console cannot express for these two (short text is 70 characters at most, long text
// has no limit), kept here so the profile form and its tests share them.
export const PROFILE_FIELD_MAX_LENGTHS = { coach_title: 40, clients_love: 200 };

// The listing fields the server fills in. Not asked in the session editor and never written by it.
export const COACH_TRAIT_LISTING_KEYS = [
  'identity',
  'language',
  'coachlocation',
  'communication_style',
];

const hasValue = value => (Array.isArray(value) ? value.length > 0 : value != null && value !== '');

/**
 * The profile traits a coach has to answer: those of the four that exist as user fields for coaches
 * in this environment's Console config. A trait whose field has not been created yet cannot be
 * asked, so it cannot be required either.
 *
 * @param {Array} userFields the user field configs (`config.user.userFields`)
 */
export const requiredCoachTraitKeys = userFields =>
  COACH_REQUIRED_PROFILE_KEYS.filter(key =>
    (userFields || []).some(field => {
      if (field?.key !== key) return false;
      const { limitToUserTypeIds, userTypeIds } = field.userTypeConfig || {};
      return !limitToUserTypeIds || (userTypeIds || []).includes(COACH_USER_TYPE);
    })
  );

/**
 * The required traits a coach has not answered yet.
 *
 * @param {Object} currentUser the logged-in user
 * @param {Array} userFields the user field configs
 * @returns {string[]} user field keys
 */
export const missingCoachTraits = (currentUser, userFields) => {
  const publicData = currentUser?.attributes?.profile?.publicData || {};
  return requiredCoachTraitKeys(userFields).filter(key => !hasValue(publicData[key]));
};

/** The same field configs, with the four traits, the title and clients_love required when the user is a coach. */
export const withCoachTraitsRequired = (fieldConfig, userType) => {
  if (userType !== COACH_USER_TYPE || !COACH_REQUIRED_PROFILE_KEYS.includes(fieldConfig?.key)) {
    return fieldConfig;
  }
  return { ...fieldConfig, saveConfig: { ...fieldConfig.saveConfig, isRequired: true } };
};

/** The field config with its length limit added, for the fields that have one. */
export const withProfileFieldLimits = fieldConfig => {
  const maxLength = PROFILE_FIELD_MAX_LENGTHS[(fieldConfig?.key)];
  return maxLength ? { ...fieldConfig, maxLength } : fieldConfig;
};
