/**
 * Revie's rules about which user fields are asked and shown, kept in code so they hold in every
 * Sharetribe environment whatever its Console config says (Dev, Test and Live drift).
 */

// Gender ("How do you identify?", private `identity`) is no longer asked of anyone: not at sign-up,
// not on the profile, not in account settings. Answers already stored are kept, untouched. Only the
// private field is retired; the listing `identity` tags and the profile's `personality_identifier`
// are a different question.
export const RETIRED_USER_FIELDS = [{ key: 'identity', scope: 'private' }];

export const isRetiredUserField = fieldConfig =>
  RETIRED_USER_FIELDS.some(
    retired =>
      retired.key === fieldConfig?.key && retired.scope === (fieldConfig?.scope || 'public')
  );

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
  (HIDDEN_AT_SIGNUP_FOR[userType] || []).includes(fieldConfig?.key);
