import { safeExternalUrl } from '../containers/ListingPage/SessionPage/sessionPageHelpers';

/**
 * A session's prep link: the coach's own prep questionnaire (a Typeform, a Google Form), shown to the
 * client on their booking page as "Open your prep questionnaire". Stored as listing publicData
 * `prep_link`: a short text field in Console (it has no URL type), checked as a link here.
 */
export const PREP_LINK_KEY = 'prep_link';

/**
 * A final-form validator: empty is fine (the field is optional); anything else must be a web link.
 * "typeform.com/to/abc" is accepted (https:// is added when it is shown), "javascript:..." is not.
 *
 * @param {string} message what to say when it is not a link
 */
export const validPrepLink = message => value => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return undefined;
  return safeExternalUrl(text) ? undefined : message;
};
