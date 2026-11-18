import {
  OUTCOME_MAX_LENGTH,
  outcomeLength,
  outcomeNotTooLong,
  outcomesOf,
  requiredOutcome,
} from './sessionOutcomes';

describe('sessionOutcomes', () => {
  describe('outcome 1 is required', () => {
    const validate = requiredOutcome('Add at least one outcome.');

    it('rejects an empty, missing or whitespace-only outcome 1', () => {
      expect(validate('')).toBe('Add at least one outcome.');
      expect(validate(undefined)).toBe('Add at least one outcome.');
      expect(validate(null)).toBe('Add at least one outcome.');
      expect(validate('    ')).toBe('Add at least one outcome.');
    });

    it('accepts an outcome with text', () => {
      expect(validate('One clear decision')).toBeUndefined();
    });
  });

  describe('90-character limit', () => {
    const validate = outcomeNotTooLong('Too long');

    it('accepts exactly 90 characters and rejects 91', () => {
      expect(OUTCOME_MAX_LENGTH).toBe(90);
      expect(validate('a'.repeat(90))).toBeUndefined();
      expect(validate('a'.repeat(91))).toBe('Too long');
    });

    it('accepts empty (outcomes 2 and 3 are optional)', () => {
      expect(validate('')).toBeUndefined();
      expect(validate(undefined)).toBeUndefined();
    });

    it('counts the live counter the same way the form does', () => {
      expect(outcomeLength('hello')).toBe(5);
      expect(outcomeLength(undefined)).toBe(0);
    });
  });

  describe('outcomesOf (what the session page shows)', () => {
    it('returns the outcomes in order', () => {
      expect(outcomesOf({ outcome_1: 'A', outcome_2: 'B', outcome_3: 'C' })).toEqual([
        'A',
        'B',
        'C',
      ]);
    });

    it('is empty when outcome 1 has no text, even if 2 or 3 do', () => {
      expect(outcomesOf({})).toEqual([]);
      expect(outcomesOf(undefined)).toEqual([]);
      expect(outcomesOf({ outcome_1: '  ', outcome_2: 'B' })).toEqual([]);
    });

    it('skips blank outcomes so the list has no gaps', () => {
      expect(outcomesOf({ outcome_1: 'A', outcome_2: '', outcome_3: 'C' })).toEqual(['A', 'C']);
      expect(outcomesOf({ outcome_1: ' A ' })).toEqual(['A']);
    });

    it('ignores the old description entirely: there is no fallback to other text', () => {
      expect(outcomesOf({ description: 'Old text', pre_work: 'x' })).toEqual([]);
    });
  });
});
