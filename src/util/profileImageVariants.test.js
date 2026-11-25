import {
  PROFILE_PHOTO_IMAGE_FIELDS,
  PROFILE_PHOTO_VARIANT_NAMES,
  profilePhotoVariantParams,
} from './profileImageVariants';

describe('profile photo variants (the original shape, not the square crops)', () => {
  it('has a small (400 wide) and a large (800 wide) scale variant', () => {
    expect(PROFILE_PHOTO_VARIANT_NAMES).toEqual(['scale-small', 'scale-large']);
    expect(PROFILE_PHOTO_IMAGE_FIELDS).toEqual(['variants.scale-small', 'variants.scale-large']);
  });

  it('defines each as fit:scale (never crop), with a tall maximum so a portrait is not cut', () => {
    const params = profilePhotoVariantParams();
    expect(Object.keys(params)).toEqual(['imageVariant.scale-small', 'imageVariant.scale-large']);
    expect(params['imageVariant.scale-small']).toBe('w:400;h:800;fit:scale');
    expect(params['imageVariant.scale-large']).toBe('w:800;h:1600;fit:scale');
    Object.values(params).forEach(definition => expect(definition).not.toContain('crop'));
  });
});
