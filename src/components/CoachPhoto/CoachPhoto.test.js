import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import CoachPhoto, { initialsOf } from './CoachPhoto';

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

describe('CoachPhoto', () => {
  it('shows the photo in the pill, with the chartreuse pill behind it', () => {
    render(<CoachPhoto image={image({ 'scale-small': 400, 'scale-large': 800 })} name="Maya R." />);

    const photo = screen.getByTestId('coach-photo-image');
    expect(photo).toHaveAttribute('alt', 'Maya R.');
    expect(screen.getByTestId('coach-photo-back')).toBeInTheDocument();
    expect(screen.queryByTestId('coach-photo-initials')).not.toBeInTheDocument();
  });

  it('uses the original-shape (scale) variants, both sizes, not the square crops', () => {
    render(
      <CoachPhoto
        image={image({ 'scale-small': 400, 'scale-large': 800, 'square-small': 240 })}
        name="Maya R."
      />
    );
    const srcSet = screen.getByTestId('coach-photo-image').getAttribute('srcset');
    expect(srcSet).toContain('scale-small.jpg 400w');
    expect(srcSet).toContain('scale-large.jpg 800w');
    expect(srcSet).not.toContain('square-small');
  });

  it('falls back to the square variants only where the page did not ask for the scale ones', () => {
    render(
      <CoachPhoto image={image({ 'square-small': 240, 'square-small2x': 480 })} name="Maya R." />
    );
    const srcSet = screen.getByTestId('coach-photo-image').getAttribute('srcset');
    expect(srcSet).toContain('square-small.jpg 240w');
  });

  it("with no photo, shows the same pill with the coach's initials and never an avatar image", () => {
    render(<CoachPhoto name="Maya R." />);

    expect(screen.getByTestId('coach-photo')).toBeInTheDocument();
    expect(screen.getByTestId('coach-photo-back')).toBeInTheDocument();
    expect(screen.getByTestId('coach-photo-initials')).toHaveTextContent('MR');
    expect(screen.queryByRole('img', { name: 'Maya R.' })).toBe(
      screen.getByTestId('coach-photo-initials')
    );
    expect(screen.queryByTestId('coach-photo-image')).not.toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('treats an image entity with no usable variant as no photo', () => {
    render(<CoachPhoto image={image({})} name="Maya R." />);
    expect(screen.getByTestId('coach-photo-initials')).toBeInTheDocument();
  });

  it('takes its width from the caller', () => {
    render(<CoachPhoto className="callerWidth" name="Maya R." />);
    expect(screen.getByTestId('coach-photo')).toHaveClass('callerWidth');
  });
});

describe('initialsOf', () => {
  it('takes up to two initials, capitalised', () => {
    expect(initialsOf('Maya R.')).toBe('MR');
    expect(initialsOf('maya')).toBe('M');
    expect(initialsOf('Ana Maria Lopez')).toBe('AM');
    expect(initialsOf('')).toBe('');
    expect(initialsOf(undefined)).toBe('');
  });
});
