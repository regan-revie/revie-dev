/**
 * A fixture for the styleguide: a drawn tall portrait (no real person) in the shape of a profile
 * image entity with the scale variants. With ?photo=/some-image.jpg in the page URL, that picture is
 * used instead, to see a real photo in the same shape (put it in public/ for a local look and do not
 * commit it).
 */

const DRAWN_PORTRAIT = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100">
    <rect width="800" height="1100" fill="#f4e3d3"/>
    <rect y="700" width="800" height="400" fill="#b9d0f0"/>
    <path d="M120 1100 C120 820 280 740 400 740 C520 740 680 820 680 1100Z" fill="#032723"/>
    <rect x="350" y="620" width="100" height="140" rx="30" fill="#e0a98a"/>
    <ellipse cx="400" cy="420" rx="170" ry="210" fill="#e0a98a"/>
    <path d="M220 400 C200 180 330 130 400 130 C500 130 600 200 580 400 C560 300 500 250 400 250 C300 250 240 300 220 400Z" fill="#310416"/>
    <circle cx="340" cy="430" r="14" fill="#310416"/><circle cx="460" cy="430" r="14" fill="#310416"/>
    <path d="M350 520 Q400 560 450 520" stroke="#310416" stroke-width="10" fill="none" stroke-linecap="round"/>
  </svg>`
)}`;

export const photoUrl = () => {
  if (typeof window === 'undefined') return DRAWN_PORTRAIT;
  return new URLSearchParams(window.location.search).get('photo') || DRAWN_PORTRAIT;
};

export const withPhoto = () => ({
  id: { uuid: 'example-photo' },
  type: 'image',
  attributes: {
    variants: {
      'scale-small': { url: photoUrl(), width: 400, height: 550 },
      'scale-large': { url: photoUrl(), width: 800, height: 1100 },
    },
  },
});
