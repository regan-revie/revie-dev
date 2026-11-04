import SectionFooter from './SectionFooter';

// The footer with its wordmark, on the default light ground and on a dark one, so both logo tones
// can be checked without logging in.
const slogan = { fieldType: 'paragraph', content: 'Coaching that fits your life.' };
const copyright = { fieldType: 'paragraph', content: '© Revie' };

export const LightGround = {
  component: SectionFooter,
  props: { sectionId: 'footer-light', numberOfColumns: 1, slogan, copyright },
  group: 'navigation',
};

export const DarkGround = {
  component: SectionFooter,
  props: {
    sectionId: 'footer-dark',
    numberOfColumns: 1,
    slogan,
    copyright,
    appearance: { fieldType: 'customAppearance', backgroundColor: '#310416', textColor: 'dark' },
  },
  group: 'navigation',
};
