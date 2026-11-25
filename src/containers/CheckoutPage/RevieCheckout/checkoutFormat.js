/**
 * Pure helpers for the checkout summary: how a session's day and time read, when free cancellation
 * ends, and the link back to the session page. Apart from the components so the date arithmetic
 * (where booking pages usually go wrong) is testable without rendering anything.
 *
 * Every time here is in the viewer's own timezone, the one the booking panel showed.
 */
import { createSlug } from '../../../util/urlHelpers';
import { FREE_CANCELLATION_HOURS } from '../../../util/freeCancellationWindow';
import {
  dayKeyOf,
  formatSlotTime12,
  formatSummaryDay,
} from '../../../components/OrderPanel/NylasBookingForm/nylasSlots';

// A client cancelling inside this window is charged: the same 48 hours the server applies
// (server/api/nylas/scheduler.js), from the one shared definition.
export { FREE_CANCELLATION_HOURS };

const HOUR_MS = 60 * 60 * 1000;

const DAY_PERIOD = /\s?(am|pm)$/;

/**
 * "10:00 to 11:00 am": a session's start and end. The am/pm is said once when both are the same,
 * and twice when the session crosses noon ("11:30 am to 12:30 pm").
 */
export const formatTimeRange = (startMs, endMs, timeZone, locale = 'en-GB') => {
  const start = formatSlotTime12(startMs, timeZone, locale);
  const end = formatSlotTime12(endMs, timeZone, locale);
  const startPeriod = (start.match(DAY_PERIOD) || [])[1];
  const endPeriod = (end.match(DAY_PERIOD) || [])[1];
  const startShown =
    startPeriod && startPeriod === endPeriod ? start.replace(DAY_PERIOD, '') : start;
  return `${startShown} to ${end}`;
};

/** "Thu 3 Dec · 10:00 to 11:00 am" */
export const formatSessionWhen = (startMs, endMs, timeZone, locale = 'en-GB') =>
  `${formatSummaryDay(startMs, timeZone, locale)} · ${formatTimeRange(
    startMs,
    endMs,
    timeZone,
    locale
  )}`;

/** The moment free cancellation ends, "Tue 1 Dec, 10:00 am": 48 hours before the session starts. */
export const formatCancelUntil = (startMs, timeZone, locale = 'en-GB') => {
  const until = startMs - FREE_CANCELLATION_HOURS * HOUR_MS;
  return `${formatSummaryDay(until, timeZone, locale)}, ${formatSlotTime12(
    until,
    timeZone,
    locale
  )}`;
};

/** The session length in whole minutes. */
export const sessionMinutes = (startMs, endMs) => Math.round((endMs - startMs) / 60000);

/**
 * The query string for "Find a new time": back to the session page with the same length and the
 * same day already chosen (and, on a phone, the booking sheet already open). The session page
 * reads `bookableOption` (the length's slug), `day` (a YYYY-MM-DD in the viewer's timezone) and
 * `orderOpen`.
 */
export const findNewTimeSearch = ({ priceVariantName, startMs, timeZone }) => {
  const params = [];
  if (priceVariantName) {
    params.push(`bookableOption=${encodeURIComponent(createSlug(priceVariantName))}`);
  }
  if (Number.isFinite(startMs) && timeZone) {
    params.push(`day=${dayKeyOf(startMs, timeZone)}`);
  }
  params.push('orderOpen=true');
  return `?${params.join('&')}`;
};

/** "She'll", "He'll" or "They'll": for the sentence under the note box. */
export const subjectWillOf = pronounsKey =>
  pronounsKey === 'she-her' ? "She'll" : pronounsKey === 'he-him' ? "He'll" : "They'll";

/** Money as the summary shows a discount: "−$16.50", with a real minus sign. */
export const formatDiscount = formattedMoney => `−${(formattedMoney || '').replace(/^[-−]/, '')}`;
