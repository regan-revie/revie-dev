import React from 'react';
import classNames from 'classnames';

import { PROFILE_PHOTO_VARIANT_NAMES } from '../../util/profileImageVariants';

import css from './CoachPhoto.module.css';

// What the photo can come from, in order of preference. The scale variants keep the photo's own
// shape (see util/profileImageVariants.js); the square ones are centre-cropped and only a fallback
// for a page whose query did not ask for the scale variants.
const SQUARE_FALLBACK_VARIANTS = ['square-small', 'square-small2x'];

const availableVariants = image => {
  const variants = image?.attributes?.variants || {};
  const scaled = PROFILE_PHOTO_VARIANT_NAMES.filter(name => variants[name]);
  if (scaled.length > 0) {
    return scaled;
  }
  return SQUARE_FALLBACK_VARIANTS.filter(name => variants[name]);
};

/** "Maya R." gives "MR"; one name gives its first letter. At most two letters. */
export const initialsOf = name =>
  (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * The coach's photo as a "sticker": the photo in a pill-shaped frame tilted -3 degrees, over a
 * chartreuse pill offset and tilted +4 degrees. No border, no frame.
 *
 * The shape is the canvas's (docs/design/session-page/). The size is the caller's: give the root a
 * width through `className` and the height follows (112:152). Cropping happens here, in the
 * browser: the image fills the pill with `object-fit: cover` and `object-position: 50% 25%`, so a
 * face sits near the top whatever shape the original was.
 *
 * With no photo the same pill, lavender, holds the coach's initials in maroon TT Commons Pro Bold,
 * about 30% of the pill's width. Never the template's grey default avatar.
 *
 * Reused wherever the coach's photo appears: the session page hero now; the profile page, checkout
 * summary and session cards later.
 *
 * @param {Object} props
 * @param {string} [props.className] sets the width
 * @param {Object} [props.image] the user's profileImage entity (denormalised), if any
 * @param {string} props.name the coach's name, for the alt text and the initials
 * @param {string} [props.sizes] the `sizes` attribute for the image
 */
const CoachPhoto = props => {
  const { className, image, name, sizes } = props;
  const variantNames = availableVariants(image);
  const imageVariants = image?.attributes?.variants || {};
  const srcSet = variantNames
    .map(v => `${imageVariants[v].url} ${imageVariants[v].width}w`)
    .join(', ');
  const hasPhoto = variantNames.length > 0;

  return (
    <div className={classNames(css.root, className)} data-testid="coach-photo">
      <div aria-hidden="true" className={css.back} data-testid="coach-photo-back" />
      <div className={css.frame}>
        {hasPhoto ? (
          <img
            className={css.image}
            srcSet={srcSet}
            sizes={sizes}
            alt={name}
            data-testid="coach-photo-image"
          />
        ) : (
          <span
            role="img"
            aria-label={name}
            className={css.initials}
            data-testid="coach-photo-initials"
          >
            {initialsOf(name)}
          </span>
        )}
      </div>
    </div>
  );
};

export default CoachPhoto;
