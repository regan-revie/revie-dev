import React from 'react';
import '@testing-library/jest-dom';

import { createCurrentUser, createListing } from '../../../util/testData';
import {
  renderWithProviders as render,
  testingLibrary,
  getRouteConfiguration,
  getHostedConfiguration,
} from '../../../util/testHelpers';
import enMessages from '../../../translations/en.json';
import fs from 'fs';
import path from 'path';

import SessionTopbar, { accountMenuItems, MARKETING_LINKS } from './SessionTopbar';
import SessionNoticeStrip from './SessionNoticeStrip';

const { screen, waitFor, within } = testingLibrary;
const messages = enMessages;

const hostedConfig = getHostedConfiguration();
const routeConfiguration = getRouteConfiguration(hostedConfig.layout);
const config = {
  ...hostedConfig,
  userTypes: {
    userTypes: [
      { id: 'coach', label: 'Coach', roles: { provider: true, customer: false } },
      { id: 'client', label: 'Client', roles: { provider: false, customer: true } },
    ],
  },
};

const signedIn = (userType, extra = {}) => ({
  auth: { isAuthenticated: true, isLoggedInAs: false, authScopes: [] },
  user: {
    currentUser: createCurrentUser('user1', {
      profile: {
        firstName: 'Mia',
        lastName: 'K',
        displayName: 'Mia K.',
        abbreviatedName: 'MK',
        publicData: { userType },
      },
    }),
    ...extra,
  },
});
const signedOut = { auth: { isAuthenticated: false } };

const menuLabels = () =>
  Array.from(document.querySelectorAll('[role="menu"] a, [role="menu"] button')).map(el =>
    el.textContent.trim()
  );

describe('SessionTopbar: signed out', () => {
  it('has the heyrevie.com links, an underlined "Sign in" and a "Get started" pill', async () => {
    render(<SessionTopbar />, { initialState: signedOut, config, routeConfiguration, messages });

    expect(await screen.findByRole('link', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find a coach' })).toHaveAttribute('href', '/s');
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute(
      'href',
      'https://heyrevie.com/about'
    );
    expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute(
      'href',
      'https://heyrevie.com/blog'
    );
    expect(screen.getByRole('link', { name: 'For coaches' })).toHaveAttribute(
      'href',
      'https://heyrevie.com/coaches'
    );
    expect(screen.queryByRole('link', { name: /Inbox/ })).not.toBeInTheDocument();
  });

  it('uses the canvas logo, as an image of the lavender R', () => {
    render(<SessionTopbar />, { initialState: signedOut, config, routeConfiguration, messages });
    const logo = screen.getByRole('img', { name: 'Revie' });
    expect(logo.getAttribute('src')).toContain('revie-logo-avatar.svg');
  });
});

describe('SessionTopbar: signed in', () => {
  it('has Find a coach, About, Blog and Inbox (no "For coaches"), with the pink count', async () => {
    render(<SessionTopbar />, {
      initialState: signedIn('client', {
        currentUserSaleNotificationCount: 0,
        currentUserOrderNotificationCount: 2,
      }),
      config,
      routeConfiguration,
      messages,
    });
    const nav = within(await screen.findByRole('navigation', { name: 'Top bar navigation' }));
    await waitFor(() => expect(nav.getByRole('link', { name: /Inbox/ })).toBeInTheDocument());
    expect(nav.getByRole('link', { name: 'Find a coach' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'About' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'Blog' })).toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'For coaches' })).not.toBeInTheDocument();
    expect(nav.getByLabelText('2 new')).toHaveTextContent('2');
    expect(nav.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it("opens an account menu with the coach's items in order: Your sessions, Calendar and hours, Edit your profile, Account and payments, Log out", async () => {
    render(<SessionTopbar />, {
      initialState: signedIn('coach', { currentUserHasListings: true }),
      config,
      routeConfiguration,
      messages,
    });
    await screen.findByRole('button', { name: 'Your account menu' });
    expect(menuLabels()).toEqual([
      'Your sessions',
      'Calendar and hours',
      'Edit your profile',
      'Account and payments',
      'Log out',
    ]);
  });

  it('gives a client: Your bookings, Edit your profile, Account and payments, Log out', async () => {
    render(<SessionTopbar />, {
      initialState: signedIn('client'),
      config,
      routeConfiguration,
      messages,
    });
    await screen.findByRole('button', { name: 'Your account menu' });
    expect(menuLabels()).toEqual([
      'Your bookings',
      'Edit your profile',
      'Account and payments',
      'Log out',
    ]);
  });

  it('shows the initials, not a photo or the grey default avatar', async () => {
    render(<SessionTopbar />, {
      initialState: signedIn('client'),
      config,
      routeConfiguration,
      messages,
    });
    const button = await screen.findByRole('button', { name: 'Your account menu' });
    expect(within(button).getByText('MK')).toBeInTheDocument();
  });
});

describe('accountMenuItems', () => {
  it("lists the coach's pages, then the shared ones", () => {
    expect(accountMenuItems('coach').map(i => i.route)).toEqual([
      'ManageListingsPage',
      'CalendarSettingsPage',
      'ProfileSettingsPage',
      'AccountSettingsPage',
    ]);
  });

  it("lists the client's bookings (their inbox of orders), then the shared pages", () => {
    const items = accountMenuItems('client', 'orders');
    expect(items.map(i => i.route)).toEqual([
      'InboxPage',
      'ProfileSettingsPage',
      'AccountSettingsPage',
    ]);
    expect(items[0].params).toEqual({ tab: 'orders' });
  });

  it('keeps the marketing links to heyrevie.com', () => {
    expect(MARKETING_LINKS.map(l => l.href)).toEqual([
      'https://heyrevie.com/about',
      'https://heyrevie.com/blog',
      'https://heyrevie.com/coaches',
    ]);
  });
});

describe('SessionNoticeStrip (the "This is your session." strip under the topbar)', () => {
  const listing = state => createListing('s1', { state });
  const renderStrip = props =>
    render(
      <SessionNoticeStrip
        mounted
        listing={listing('published')}
        isOwnListing
        editParams={{ id: 's1', slug: 's1-title', type: 'edit', tab: 'details' }}
        {...props}
      />,
      { config, routeConfiguration, messages }
    );

  it('on her own session: "This is your session." on the left, "Edit session →" on the right', () => {
    renderStrip();
    const strip = screen.getByTestId('notice-own');
    expect(within(strip).getByText('This is your session.')).toBeInTheDocument();
    expect(within(strip).getByRole('link', { name: /Edit session/ })).toBeInTheDocument();
  });

  it('is a slim strip, not a block: one short line and one link', () => {
    renderStrip();
    const strip = screen.getByTestId('notice-own');
    expect(strip.children).toHaveLength(2);
  });

  it('says so for a draft, a closed session and one waiting for approval', () => {
    const { unmount } = renderStrip({ listing: listing('draft') });
    expect(screen.getByText('This session is a draft.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Finish session/ })).toBeInTheDocument();
    unmount();

    const second = renderStrip({ listing: listing('closed') });
    expect(screen.getByText('This session is closed.')).toBeInTheDocument();
    second.unmount();

    renderStrip({ listing: listing('pendingApproval') });
    expect(screen.getByText('This session is waiting for approval.')).toBeInTheDocument();
  });

  it('adds a strip for missing payout details, with a link to add them', () => {
    renderStrip({ noPayoutDetailsSetWithOwnListing: true });
    expect(screen.getByTestId('notice-payout')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add payout details/ })).toBeInTheDocument();
  });

  it('shows nothing to a client on an open session', () => {
    const { container } = renderStrip({ isOwnListing: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('tells everyone, without a link, that a session is closed', () => {
    renderStrip({ isOwnListing: false, listing: listing('closed') });
    expect(screen.getByTestId('notice-closed')).toHaveTextContent('This session is closed.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows nothing before the browser has taken over (server render)', () => {
    const { container } = renderStrip({ mounted: false });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the account menu card', () => {
  const css = fs.readFileSync(path.join(__dirname, 'SessionTopbar.module.css'), 'utf8');
  const rule = selector =>
    css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))[1];

  it('is at least 240px wide, which beats the shared Menu\'s inline width (so "Account and payments" fits)', () => {
    expect(rule('.menuCard')).toMatch(/min-width:\s*240px\s*!important/);
  });

  it('never wraps a label', () => {
    expect(rule('.menuLink')).toMatch(/white-space:\s*nowrap/);
  });

  it('sits above the sticky booking panel', () => {
    expect(rule('.root')).toMatch(/z-index:\s*var\(--zIndexPopup\)/);
    expect(rule('.menuCard')).toMatch(/z-index:\s*var\(--zIndexPopup\)/);
  });

  it("opens leftwards, its right edge on the avatar button's", () => {
    const js = fs.readFileSync(path.join(__dirname, 'SessionTopbar.js'), 'utf8');
    expect(js).toMatch(/<Menu skipFocusOnNavigation=\{true\} contentPosition="left">/);
  });
});
