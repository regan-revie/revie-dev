import {
  splitAfterLastComma,
  splitDescription,
  sessionLengths,
  lengthsText,
  capTags,
  tagColourAt,
  optionLabels,
  firstNameOf,
  averageRating,
  reviewScore,
  formatShortDay,
  safeExternalUrl,
  socialKind,
} from './sessionPageHelpers';

describe('splitAfterLastComma (the title weights)', () => {
  it('sets everything after the last comma in bold', () => {
    expect(splitAfterLastComma('Get clear on your next career move, then make it.')).toEqual({
      lead: 'Get clear on your next career move, ',
      bold: 'then make it.',
    });
  });

  it('uses the LAST comma when there are several', () => {
    expect(splitAfterLastComma('Pause, think, then act')).toEqual({
      lead: 'Pause, think, ',
      bold: 'then act',
    });
  });

  it('sets the whole title in bold when there is no comma', () => {
    expect(splitAfterLastComma('Make the decision')).toEqual({
      lead: '',
      bold: 'Make the decision',
    });
  });

  it('ignores a trailing comma and surrounding space', () => {
    expect(splitAfterLastComma('  Make the decision, ')).toEqual({
      lead: '',
      bold: 'Make the decision',
    });
  });

  it('copes with a missing title', () => {
    expect(splitAfterLastComma(undefined)).toEqual({ lead: '', bold: '' });
  });
});

describe('splitDescription', () => {
  it('takes the first sentence as the lead and the rest of the paragraph as the body', () => {
    const result = splitDescription(
      "You're good at your job. You're less sure it's the right job? We'll sort that."
    );
    expect(result.lead).toBe("You're good at your job.");
    expect(result.body).toBe("You're less sure it's the right job? We'll sort that.");
    expect(result.more).toEqual([]);
  });

  it('puts further paragraphs behind "read more"', () => {
    const result = splitDescription('One. Two.\n\nThree paragraph.\n\nFour paragraph.');
    expect(result.lead).toBe('One.');
    expect(result.body).toBe('Two.');
    expect(result.more).toEqual(['Three paragraph.', 'Four paragraph.']);
  });

  it('shows a single sentence as the lead alone', () => {
    expect(splitDescription('Just one sentence.')).toEqual({
      lead: 'Just one sentence.',
      body: '',
      more: [],
    });
  });

  it('moves a long opening paragraph behind "read more" at a sentence boundary', () => {
    const sentence = 'This sentence is about forty characters.';
    const text = Array(20)
      .fill(sentence)
      .join(' ');
    const result = splitDescription(text);
    expect(result.lead).toBe(sentence);
    expect(result.body.length).toBeLessThanOrEqual(400);
    expect(result.more.length).toBe(1);
    // nothing is lost
    const rejoined = [result.lead, result.body, ...result.more].filter(Boolean).join(' ');
    expect(rejoined).toBe(text);
  });

  it('handles empty text', () => {
    expect(splitDescription('  ')).toEqual({ lead: '', body: '', more: [] });
  });
});

describe('session lengths', () => {
  const publicData = {
    priceVariants: [
      { name: '60', bookingLengthInMinutes: 60 },
      { name: '30', bookingLengthInMinutes: 30 },
      { name: '90', bookingLengthInMinutes: 90 },
      { name: '60b', bookingLengthInMinutes: 60 },
    ],
  };

  it('lists the unique lengths, ascending', () => {
    expect(sessionLengths(publicData)).toEqual([30, 60, 90]);
  });

  it('reads the label as the hero shows it', () => {
    expect(lengthsText([30, 60, 90])).toBe('30, 60 or 90');
    expect(lengthsText([30, 60])).toBe('30 or 60');
    expect(lengthsText([60])).toBe('60');
    expect(lengthsText([30, 60, 90], 'or', true)).toBe('30–90');
    expect(lengthsText([])).toBe('');
  });

  it('is empty without price variants', () => {
    expect(sessionLengths({})).toEqual([]);
    expect(sessionLengths(undefined)).toEqual([]);
  });
});

describe('capTags', () => {
  it('shows at most four tags and counts the rest', () => {
    const result = capTags(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(result.shown).toEqual(['a', 'b', 'c', 'd']);
    expect(result.hiddenCount).toBe(2);
    expect(result.all).toHaveLength(6);
  });

  it('has nothing hidden at four or fewer', () => {
    expect(capTags(['a', 'b', 'c', 'd']).hiddenCount).toBe(0);
    expect(capTags(['a']).shown).toEqual(['a']);
    expect(capTags(undefined)).toEqual({ shown: [], hiddenCount: 0, all: [] });
  });

  it('cycles periwinkle, pink, orange and never uses chartreuse', () => {
    const colours = [0, 1, 2, 3, 4, 5, 6].map(tagColourAt);
    expect(colours).toEqual([
      'periwinkle',
      'pink',
      'orange',
      'periwinkle',
      'pink',
      'orange',
      'periwinkle',
    ]);
    expect(colours).not.toContain('chartreuse');
  });
});

describe('optionLabels', () => {
  const userFields = [
    {
      key: 'personality_identifier',
      enumOptions: [
        { option: 'single-parent', label: 'Single parent' },
        { option: 'adhd', label: 'ADHD' },
      ],
    },
  ];

  it('maps keys to labels in the order picked and skips unknown keys', () => {
    expect(
      optionLabels(userFields, 'personality_identifier', ['adhd', 'gone', 'single-parent'])
    ).toEqual(['ADHD', 'Single parent']);
  });

  it('accepts a single value and a missing field', () => {
    expect(optionLabels(userFields, 'personality_identifier', 'adhd')).toEqual(['ADHD']);
    expect(optionLabels(userFields, 'nope', ['adhd'])).toEqual([]);
    expect(optionLabels(undefined, 'x', undefined)).toEqual([]);
  });
});

describe('reviewScore (the average is shown from three reviews)', () => {
  const ratings = list => list.map(rating => ({ attributes: { rating } }));

  it('has no score and a count of 0 with no reviews', () => {
    expect(reviewScore([])).toEqual({ count: 0, average: null });
    expect(reviewScore(undefined)).toEqual({ count: 0, average: null });
  });

  it('has a count but no score with one or two reviews, however good', () => {
    expect(reviewScore(ratings([5]))).toEqual({ count: 1, average: null });
    expect(reviewScore(ratings([5, 5]))).toEqual({ count: 2, average: null });
  });

  it('has the average from three reviews', () => {
    expect(reviewScore(ratings([5, 4, 4]))).toEqual({ count: 3, average: '4.3' });
  });

  it('rounds to one decimal: seven reviews adding up to 34 average 4.9', () => {
    expect(reviewScore(ratings([5, 5, 5, 5, 5, 5, 4]))).toEqual({ count: 7, average: '4.9' });
  });
});

describe('small helpers', () => {
  it('finds a first name', () => {
    expect(firstNameOf('Maya R.')).toBe('Maya');
    expect(firstNameOf('')).toBe('');
  });

  it('averages ratings to one decimal, or null with none', () => {
    const reviews = [5, 5, 5, 5, 5, 5, 4].map(rating => ({ attributes: { rating } }));
    expect(averageRating(reviews)).toBe('4.9');
    expect(averageRating([])).toBe(null);
  });

  it('formats a day as "Tue 17 Nov" in the viewer’s own timezone', () => {
    // noon UTC is the same calendar day in every timezone from UTC-11 to UTC+11
    expect(formatShortDay(Date.UTC(2026, 10, 17, 12, 0), 'en-GB')).toBe('Tue 17 Nov');
  });

  it('only turns http(s) links into links', () => {
    expect(safeExternalUrl('https://www.linkedin.com/in/maya')).toBe(
      'https://www.linkedin.com/in/maya'
    );
    expect(safeExternalUrl('instagram.com/maya')).toBe('https://instagram.com/maya');
    expect(safeExternalUrl('javascript:alert(1)')).toBe(null);
    expect(safeExternalUrl('')).toBe(null);
  });

  it('picks an icon by site', () => {
    expect(socialKind('https://www.linkedin.com/in/maya')).toBe('linkedin');
    expect(socialKind('https://instagram.com/maya')).toBe('instagram');
    expect(socialKind('https://maya.coach')).toBe('link');
  });
});
