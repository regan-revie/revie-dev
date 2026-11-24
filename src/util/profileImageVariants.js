import { util } from './sdkLoader';

/**
 * Profile photos in their original shape.
 *
 * Sharetribe's own profile-image variants (`square-small`, `square-small2x`, ...) are centre-cropped
 * squares, which can cut the top of a head off when the photo is shown in a tall capsule (the coach
 * photo, see components/CoachPhoto). These two variants scale the original down to fit inside a box
 * without cropping, so the browser can crop it itself (CSS `object-fit: cover`, face near the top).
 *
 *   scale-small   at most 400 wide, 800 tall    (the session page hero's small photo)
 *   scale-large   at most 800 wide, 1600 tall   (anywhere a larger photo is needed)
 *
 * A custom variant has to be both defined (`imageVariant.<name>`) and asked for (`fields.image`) on
 * each query that should return it. Add `PROFILE_PHOTO_IMAGE_FIELDS` to the query's `fields.image`
 * and spread `profilePhotoVariantParams()` into its params; it then applies to every image in the
 * response, including the author's `profileImage`.
 */
export const PROFILE_PHOTO_VARIANT_NAMES = ['scale-small', 'scale-large'];

export const PROFILE_PHOTO_IMAGE_FIELDS = PROFILE_PHOTO_VARIANT_NAMES.map(
  name => `variants.${name}`
);

const scaleVariant = (name, width, height) => ({
  [`imageVariant.${name}`]: util.objectQueryString({ w: width, h: height, fit: 'scale' }),
});

export const profilePhotoVariantParams = () => ({
  ...scaleVariant('scale-small', 400, 800),
  ...scaleVariant('scale-large', 800, 1600),
});
