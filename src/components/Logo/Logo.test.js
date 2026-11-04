import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import Logo from './Logo';

const { screen } = testingLibrary;

describe('Logo', () => {
  it('shows the maroon wordmark on a light ground', () => {
    render(<Logo layout="desktop" tone="onLight" />);
    const src = screen.getByRole('img').getAttribute('src');
    expect(src).toMatch(/revie-logo-desktop/);
    expect(src).not.toMatch(/cream/);
  });

  it('keeps the configured wordmark by default, for the maroon topbar', () => {
    render(<Logo layout="desktop" />);
    // Whatever branding is configured, it is not swapped for the maroon file.
    const img = screen.queryByRole('img');
    expect(img?.getAttribute('src') || '').not.toMatch(/revie-logo-desktop\.png$/);
  });

  it('does not swap the mobile mark, which reads on any ground', () => {
    render(<Logo layout="mobile" tone="onLight" />);
    const img = screen.queryByRole('img');
    expect(img?.getAttribute('src') || '').not.toMatch(/revie-logo-desktop/);
  });
});
