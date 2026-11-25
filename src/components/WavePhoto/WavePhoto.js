import React, { useId } from 'react';
import classNames from 'classnames';

import { initialsOf, profilePhotoSrcSet } from '../CoachPhoto/CoachPhoto';

import css from './WavePhoto.module.css';

// The wavy outline from the approved design (docs/design/session-page/, the coach quote card): a
// rounded rectangle whose left and right edges each have two scallops. Drawn in a 100 x 100 box
// and scaled to 0..1 so the clip follows whatever size the photo is given
// (clipPathUnits="objectBoundingBox").
const WAVE_PATH =
  'M18 0 L82 0 C94 0 100 6 100 18 L100 19.3 C100 29.3 96 33.3 88 33.3 C96 33.3 100 37.3 100 47.3 ' +
  'L100 52.7 C100 62.7 96 66.7 88 66.7 C96 66.7 100 70.7 100 80.7 L100 82 C100 94 94 100 82 100 ' +
  'L18 100 C6 100 0 94 0 82 L0 80.7 C0 70.7 4 66.7 12 66.7 C4 66.7 0 62.7 0 52.7 L0 47.3 ' +
  'C0 37.3 4 33.3 12 33.3 C4 33.3 0 29.3 0 19.3 L0 18 C0 6 6 0 18 0 Z';

/**
 * The coach's photo clipped to the wavy shape. Used on the session page's coach quote card; the
 * coach profile page reuses it.
 *
 * The size is the caller's: give the root a width and a height through `className` (it fills its
 * parent's width and is 300px tall until told otherwise). Cropping happens here, in the browser,
 * the same way as CoachPhoto's: the image fills the shape with `object-fit: cover` and
 * `object-position: 50% 25%`, so a face stays near the top whatever shape the original was.
 *
 * With no photo the same shape, lavender, holds the coach's initials in maroon, as CoachPhoto's
 * capsule does.
 *
 * @param {Object} props
 * @param {string} [props.className] sets the size
 * @param {Object} [props.image] the user's profileImage entity (denormalised), if any
 * @param {string} props.name the coach's name, for the alt text and the initials
 * @param {string} [props.sizes] the `sizes` attribute for the image
 */
const WavePhoto = props => {
  const { className, image, name, sizes } = props;
  const srcSet = profilePhotoSrcSet(image);
  // Each photo carries its own clip definition, so it does not depend on another one being on the
  // page. useId gives colons, which a url(#...) reference cannot contain.
  const clipId = `revie-wave-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div className={classNames(css.root, className)} data-testid="wave-photo">
      <svg aria-hidden="true" focusable="false" width="0" height="0" className={css.defs}>
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path transform="scale(0.01)" d={WAVE_PATH} />
          </clipPath>
        </defs>
      </svg>
      <div className={css.shape} style={{ clipPath: `url(#${clipId})` }}>
        {srcSet ? (
          <img
            className={css.image}
            srcSet={srcSet}
            sizes={sizes}
            alt={name}
            data-testid="wave-photo-image"
          />
        ) : (
          <span
            role="img"
            aria-label={name}
            className={css.initials}
            data-testid="wave-photo-initials"
          >
            {initialsOf(name)}
          </span>
        )}
      </div>
    </div>
  );
};

export default WavePhoto;
