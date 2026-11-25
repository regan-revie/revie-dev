/**
 * Pure helpers for the session page (the redesigned /l/... page). Kept apart from the components so
 * the rules that shape what a visitor reads - which words are bold, how many tags show, what the
 * label says - are testable without rendering anything.
 */

const clean = value => (typeof value === 'string' ? value.trim() : '');

export const hasText = value => clean(value).length > 0;

/**
 * Splits a headline at its last comma, for the two-weight headline style: Regular up to and
 * including the last comma, Bold after it ("Get clear on your next career move, **then make it.**").
 * A headline with no comma is Bold throughout, so `lead` is empty and `bold` is the whole text.
 * A trailing comma is ignored, so "Hello," reads as all Bold rather than as Regular with nothing bold.
 *
 * @returns {{lead: string, bold: string}}
 */
export const splitAfterLastComma = text => {
  const trimmed = clean(text).replace(/[\s,]+$/, '');
  const index = trimmed.lastIndexOf(',');
  if (index === -1) {
    return { lead: '', bold: trimmed };
  }
  return { lead: `${trimmed.slice(0, index + 1)} `, bold: trimmed.slice(index + 1).trim() };
};

// How much of the opening paragraph's remainder is shown before "Read more".
const BODY_VISIBLE_LIMIT = 400;

/**
 * Splits a session description for the page: the first sentence (set large), the rest of that
 * paragraph (body text), and any further paragraphs, which sit behind "Read more".
 *
 * A long opening paragraph is cut at a sentence boundary so the page does not open on a wall of
 * text; what is cut moves behind "Read more" rather than being lost.
 *
 * @returns {{lead: string, body: string, more: string[]}}
 */
export const splitDescription = text => {
  const paragraphs = clean(text)
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return { lead: '', body: '', more: [] };
  }

  const [first, ...otherParagraphs] = paragraphs;
  // A sentence ends at . ! or ? followed by a space; the last one in a paragraph ends at its end.
  const sentences = first.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [first];
  const [lead, ...restOfFirst] = sentences.map(s => s.trim()).filter(Boolean);

  let body = '';
  const moved = [];
  restOfFirst.forEach(sentence => {
    const next = body ? `${body} ${sentence}` : sentence;
    if (moved.length === 0 && next.length <= BODY_VISIBLE_LIMIT) {
      body = next;
    } else {
      moved.push(sentence);
    }
  });

  const more = moved.length > 0 ? [moved.join(' '), ...otherParagraphs] : otherParagraphs;
  return { lead: lead || '', body, more };
};

/**
 * The lengths a session is sold in, in minutes, from its price variants: unique and ascending.
 */
export const sessionLengths = publicData => {
  const variants = Array.isArray(publicData?.priceVariants) ? publicData.priceVariants : [];
  const lengths = variants
    .map(v => Number(v?.bookingLengthInMinutes))
    .filter(n => Number.isFinite(n) && n > 0);
  return [...new Set(lengths)].sort((a, b) => a - b);
};

/**
 * "30", "30 or 60", "30, 60 or 90": the lengths as the hero label reads them. `orWord` is the
 * translated "or". Several lengths read as a range when `asRange` is set ("30–90", the phone label).
 */
export const lengthsText = (lengths, orWord = 'or', asRange = false) => {
  if (lengths.length === 0) {
    return '';
  }
  if (lengths.length === 1) {
    return `${lengths[0]}`;
  }
  if (asRange) {
    return `${lengths[0]}–${lengths[lengths.length - 1]}`;
  }
  const head = lengths.slice(0, -1).join(', ');
  return `${head} ${orWord} ${lengths[lengths.length - 1]}`;
};

export const MAX_HERO_TAGS = 4;

/**
 * The lived-experience tags for the hero: at most four, and how many more there are. `all` is every
 * tag, for the "been there" modal.
 */
export const capTags = (tags, max = MAX_HERO_TAGS) => {
  const all = Array.isArray(tags) ? tags.filter(hasText) : [];
  return { shown: all.slice(0, max), hiddenCount: Math.max(all.length - max, 0), all };
};

// Tags cycle periwinkle, pink, orange. Never chartreuse: that colour is the "New to Revie" badge.
export const TAG_COLOURS = ['periwinkle', 'pink', 'orange'];
export const tagColourAt = index => TAG_COLOURS[index % TAG_COLOURS.length];

/**
 * Labels for a user field's selected options, in the order the coach picked them. Unknown keys (an
 * option removed from Console since) are skipped rather than shown as a raw key.
 */
export const optionLabels = (userFields, fieldKey, selectedKeys) => {
  const field = (userFields || []).find(f => f.key === fieldKey);
  const options = field?.enumOptions || [];
  const selected = Array.isArray(selectedKeys) ? selectedKeys : selectedKeys ? [selectedKeys] : [];
  return selected.map(key => options.find(o => `${o.option}` === `${key}`)?.label).filter(hasText);
};

/** A person's first name from the name shown for them ("Maya R." gives "Maya"). */
export const firstNameOf = displayName => clean(displayName).split(/\s+/)[0] || '';

/** The average rating, to one decimal ("4.9"), or null with no reviews. */
export const averageRating = reviews => {
  const ratings = (reviews || [])
    .map(r => Number(r?.attributes?.rating))
    .filter(n => Number.isFinite(n));
  if (ratings.length === 0) {
    return null;
  }
  const average = ratings.reduce((sum, n) => sum + n, 0) / ratings.length;
  return (Math.round(average * 10) / 10).toFixed(1);
};

// The score is only shown from this many reviews: one or two ratings are an anecdote, and a
// "5.0" built on one review says more than it knows. See docs/decisions.md (Nov 25).
export const MIN_REVIEWS_FOR_SCORE = 3;

/**
 * What the page says about a session's reviews: how many, and the average (one decimal, "4.9")
 * only once there are `MIN_REVIEWS_FOR_SCORE` of them. With one or two, `average` is null and the
 * page shows the cards and a count but no score; with none, `count` is 0 and the page shows
 * "New to Revie" and no reviews section.
 *
 * @returns {{count: number, average: string|null}}
 */
export const reviewScore = reviews => {
  const list = Array.isArray(reviews) ? reviews : [];
  return {
    count: list.length,
    average: list.length >= MIN_REVIEWS_FOR_SCORE ? averageRating(list) : null,
  };
};

/**
 * A day as the quick facts read it: "Tue 17 Nov". Always in the viewer's own timezone (the
 * browser's), never the coach's.
 */
export const formatShortDay = (timestampMs, locale = 'en') => {
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(timestampMs));
  const pick = type => parts.find(p => p.type === type)?.value || '';
  return `${pick('weekday')} ${pick('day')} ${pick('month')}`.trim();
};

/**
 * Turns a coach's social link into a safe external URL, or null. Only http(s) links are used (a
 * `javascript:` link typed into a profile must never become a clickable one); a bare "instagram.com/x"
 * gets https:// added.
 */
export const safeExternalUrl = value => {
  const text = clean(value);
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch (e) {
    return null;
  }
};

/** Which icon a social link gets: 'linkedin', 'instagram', or 'link' for anything else. */
export const socialKind = href => {
  try {
    const host = new URL(href).hostname.replace(/^www\./, '');
    if (/(^|\.)linkedin\.com$/.test(host)) return 'linkedin';
    if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  } catch (e) {
    // fall through
  }
  return 'link';
};
