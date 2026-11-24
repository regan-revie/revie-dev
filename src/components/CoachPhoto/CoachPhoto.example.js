import React from 'react';

import CoachPhoto from './CoachPhoto';
import { withPhoto } from './CoachPhoto.fixture';

/**
 * Styleguide examples for the coach photo "sticker", at three widths, with a photo and without. See
 * CoachPhoto.fixture.js for the picture used.
 */

const Sizes = ({ image }) => (
  <div
    style={{ display: 'flex', alignItems: 'flex-end', gap: 48, padding: 40, background: '#310416' }}
  >
    <div style={{ width: 150 }}>
      <CoachPhoto image={image} name="Maya R." />
    </div>
    <div style={{ width: 112 }}>
      <CoachPhoto image={image} name="Maya R." />
    </div>
    <div style={{ width: 76 }}>
      <CoachPhoto image={image} name="Maya R." />
    </div>
  </div>
);

const WithPhoto = () => <Sizes image={withPhoto()} />;
const WithoutPhoto = () => <Sizes image={null} />;

export const WithPhotoExample = { component: WithPhoto, props: {}, group: 'coach photo' };
export const WithoutPhotoExample = { component: WithoutPhoto, props: {}, group: 'coach photo' };
