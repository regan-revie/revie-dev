/**
 * Revie's rules about which user fields are asked and shown, kept in code so they hold in every
 * Sharetribe environment whatever its Console config says (Dev, Test and Live drift).
 */

// Gender ("How do you identify?", the private `identity`) is optional and private: asked on the
// account page (where private fields are saved), for coaches and clients alike, and never at
// sign-up. It is stored in `privateData`, so it is shown to nobody, and it is never copied to
// listings (server/api/coachTraits only ever reads the public `personality_identifier`). Only the
// private field is meant: the listing `identity` tags and the profile's `personality_identifier`
// are a different question that shares the name.
export const GENDER_FIELD = { key: 'identity', scope: 'private' };

export const isGenderField = fieldConfig =>
  GENDER_FIELD.key === fieldConfig?.key && GENDER_FIELD.scope === (fieldConfig?.scope || 'public');

// Help text for fields that Console has none for. Console's own help text wins when it has one.
// Message ids, so the wording lives in en.json.
export const defaultHelpTextId = fieldConfig =>
  isGenderField(fieldConfig) && !fieldConfig?.helpText ? 'UserField.genderHelpText' : null;

// A client's personal answers. They may be asked and stored (they help matching later) but are never
// shown on a public profile page, whatever Console says.
export const NEVER_PUBLIC_USER_FIELDS = ['support', 'work', 'client_wants'];

export const isNeverPublicUserField = fieldConfig =>
  NEVER_PUBLIC_USER_FIELDS.includes(fieldConfig?.key);

// Console can only switch a field in or out of sign-up for everyone, but `location` is asked of
// coaches at sign-up (they must have one) and not of clients (who may give it later, or never).
// So that one split lives here. The other client-only questions are switched off in Console.
const HIDDEN_AT_SIGNUP_FOR = { client: ['location'] };

export const isHiddenAtSignUp = (fieldConfig, userType) =>
  isGenderField(fieldConfig) || (HIDDEN_AT_SIGNUP_FOR[userType] || []).includes(fieldConfig?.key);
