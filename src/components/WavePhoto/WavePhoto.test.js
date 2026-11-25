import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import WavePhoto from './WavePhoto';

const { screen } = testingLibrary;

const image = variants => ({
  id: { uuid: 'img-1' },
  type: 'image',
  attributes: {
    variants: Object.fromEntries(
      Object.entries(variants).map(([name, width]) => [
        name,
        { url: `https://example.com/${name}.jpg`, width, height: width * 2 },
      ])
    ),
  },
});

describe('WavePhoto', () => {
  it('shows the photo, clipped to the wave defined in the same component', () => {
    const { container } = render(
      <WavePhoto image={image({ 'scale-small': 400, 'scale-large': 800 })} name="Maya R." />
    );

    const photo = screen.getByTestId('wave-photo-image');
    expect(photo).toHaveAttribute('alt', 'Maya R.');
    expect(photo.getAttribute('srcset')).toContain('scale-large.jpg 800w');
    expect(screen.queryByTestId('wave-photo-initials')).not.toBeInTheDocument();

    const clip = container.querySelector('clipPath');
    expect(clip).toHaveAttribute('clipPathUnits', 'objectBoundingBox');
    // the shape points at that clip, and the id has no colon (useId's own would break url(#...))
    const shape = photo.parentElement;
    expect(shape.getAttribute('style')).toContain(`url(#${clip.getAttribute('id')})`);
    expect(clip.getAttribute('id')).not.toMatch(/:/);
  });

  it('gives each photo its own clip, so two on a page do not share one', () => {
    const { container } = render(
      <>
        <WavePhoto name="A B" />
        <WavePhoto name="C D" />
      </>
    );
    const ids = [...container.querySelectorAll('clipPath')].map(c => c.getAttribute('id'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toEqual(ids[1]);
  });

  it('shows the initials, in the same shape, when there is no photo', () => {
    render(<WavePhoto name="Maya R." />);
    expect(screen.getByTestId('wave-photo-initials')).toHaveTextContent('MR');
    expect(screen.getByRole('img', { name: 'Maya R.' })).toBeInTheDocument();
    expect(screen.queryByTestId('wave-photo-image')).not.toBeInTheDocument();
  });
});
