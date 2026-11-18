/**
 * The three "what will your client leave with" outcomes on a session (listing).
 *
 * Stored as listing publicData: outcome_1, outcome_2, outcome_3 (plain text, short). The fields are
 * declared in Console (Build > Listing fields) as `shortText`; this file owns what Console cannot
 * express: the 90-character limit, outcome 1 being required, and which outcomes are worth showing.
 */

export const OUTCOME_KEYS = ['outcome_1', 'outcome_2', 'outcome_3'];
export const OUTCOME_MAX_LENGTH = 90;

// Form field names (listing fields are namespaced `pub_` in the editor form).
export const OUTCOME_FIELD_NAMES = OUTCOME_KEYS.map(key => `pub_${key}`);

const clean = value => (typeof value === 'string' ? value.trim() : '');

/**
 * The outcomes to show on the session page, in order, as an array of strings.
 *
 * Empty unless outcome 1 has text: the section is hidden for a session with no outcomes (and
 * outcome 1 is required, so a missing one means the rest should not stand alone). A blank outcome 2
 * or 3 is skipped, so a numbered list never shows a gap.
 */
export const outcomesOf = publicData => {
  const data = publicData || {};
  if (!clean(data[OUTCOME_KEYS[0]])) {
    return [];
  }
  return OUTCOME_KEYS.map(key => clean(data[key])).filter(Boolean);
};

/**
 * Validators for final-form (return an error message, or undefined when fine). Messages are passed
 * in so the caller can use translations. Length is counted in characters of the trimmed text, the
 * same as `outcomesOf` and the live counter use.
 */
export const requiredOutcome = message => value => (clean(value) ? undefined : message);

export const outcomeNotTooLong = message => value =>
  clean(value).length > OUTCOME_MAX_LENGTH ? message : undefined;

// What the live counter shows for a field's current value.
export const outcomeLength = value => (typeof value === 'string' ? value.length : 0);
