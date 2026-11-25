import { PREP_LINK_KEY, validPrepLink } from './prepLink';

describe('prepLink', () => {
  const validate = validPrepLink('Not a link');

  it('is the listing field prep_link', () => {
    expect(PREP_LINK_KEY).toBe('prep_link');
  });

  it('is optional: nothing, or only spaces, is fine', () => {
    expect(validate(undefined)).toBeUndefined();
    expect(validate('')).toBeUndefined();
    expect(validate('   ')).toBeUndefined();
  });

  it('accepts a web link, with or without https://', () => {
    expect(validate('https://form.typeform.com/to/abc123')).toBeUndefined();
    expect(validate('http://example.com/prep')).toBeUndefined();
    expect(validate('forms.gle/abc')).toBeUndefined();
  });

  it('refuses anything that is not a web link', () => {
    expect(validate('javascript:alert(1)')).toBe('Not a link');
    expect(validate('mailto:maya@example.com')).toBe('Not a link');
    expect(validate('data:text/html,hi')).toBe('Not a link');
    expect(validate('not a link at all')).toBe('Not a link');
  });
});
