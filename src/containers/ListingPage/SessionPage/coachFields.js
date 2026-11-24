/**
 * Where the session page finds a coach's details, in one place.
 *
 * Most come from user fields that already exist (see docs/onboarding-fields.md): pronouns,
 * certifications, location, languages, "More about me..." (personality_identifier), communication
 * style, focus areas, social link. Two the design uses do NOT exist as fields yet: the coach's
 * one-line title and the "Clients love working with me because..." line. The page reads them from
 * these keys on the coach's public profile data and simply leaves the spot out while they are empty,
 * so adding the fields later (Console, then the profile form) needs no change to the page except the
 * key names here, if different ones are chosen.
 */
export const COACH_TITLE_KEY = 'coach_title';
export const COACH_QUOTE_KEY = 'clients_love';

export const PRONOUNS_KEY = 'pronouns';
export const CERTIFICATIONS_KEY = 'certifications';
export const LOCATION_KEY = 'location';
export const LANGUAGES_KEY = 'languages';
export const LIVED_EXPERIENCE_KEY = 'personality_identifier';
export const COMMUNICATION_STYLE_KEY = 'communication_style';
export const TOOLS_KEY = 'focusareas';
export const SOCIAL_LINK_KEY = 'sociallink';
