import React from 'react';
import '@testing-library/jest-dom';

import { createUser, createListing, createReview } from '../../../util/testData';
import {
  renderWithProviders as render,
  testingLibrary,
  getRouteConfiguration,
  getHostedConfiguration,
} from '../../../util/testHelpers';
import enMessages from '../../../translations/en.json';

import SessionHero from './SessionHero';
import SessionAbout from './SessionAbout';
import SessionCoach from './SessionCoach';
import SessionReviews from './SessionReviews';
import SessionGoodToKnow from './SessionGoodToKnow';
import SessionOutcomesSection from '../../../components/SessionOutcomes/SessionOutcomesSection';

jest.mock('../../../util/api', () => ({
  ...jest.requireActual('../../../util/api'),
  nylasAvailability: jest.fn(() => Promise.resolve({ slots: [], connected: true })),
}));

const { screen, within, userEvent, waitFor } = testingLibrary;
const messages = enMessages;

const hostedConfig = getHostedConfiguration();
const routeConfiguration = getRouteConfiguration(hostedConfig.layout);

const userFields = [
  {
    key: 'personality_identifier',
    enumOptions: [
      { option: 'single-parent', label: 'Single parent' },
      { option: 'adhd', label: 'ADHD' },
      { option: 'first-generation', label: 'First generation' },
      { option: 'neurodivergent', label: 'Neurodivergent' },
      { option: 'caregiver', label: 'Caregiver' },
      { option: 'chronic-illness', label: 'Chronic illness' },
    ],
  },
  { key: 'pronouns', enumOptions: [{ option: 'she-her', label: 'she/her' }] },
  { key: 'certifications', enumOptions: [{ option: 'acc', label: 'ICF ACC' }] },
  { key: 'location', enumOptions: [{ option: 'uk', label: 'UK' }] },
  {
    key: 'languages',
    enumOptions: [{ option: 'english', label: 'English' }, { option: 'spanish', label: 'Spanish' }],
  },
  { key: 'communication_style', enumOptions: [{ option: 'direct', label: 'Direct' }] },
  { key: 'focusareas', enumOptions: [{ option: 'values', label: 'Values work' }] },
];

const coach = (publicData = {}, profile = {}) =>
  createUser('coach-1', {
    profile: {
      displayName: 'Maya R.',
      abbreviatedName: 'MR',
      bio: 'I spent twelve years in HR.',
      publicData: {
        pronouns: 'she-her',
        certifications: ['acc'],
        location: 'uk',
        languages: ['english', 'spanish'],
        personality_identifier: ['single-parent', 'adhd', 'first-generation', 'neurodivergent'],
        ...publicData,
      },
      ...profile,
    },
  });

const session = (attributes = {}) =>
  createListing('session-1', {
    title: 'Get clear on your next career move, then make it.',
    description: "You're good at your job. You're less sure it's the right job.",
    publicData: {
      priceVariants: [
        { name: '30', bookingLengthInMinutes: 30 },
        { name: '60', bookingLengthInMinutes: 60 },
        { name: '90', bookingLengthInMinutes: 90 },
      ],
      ...attributes.publicData,
    },
    ...attributes.rest,
  });

const renderHero = ({ listing = session(), author = coach(), reviews = [] } = {}) =>
  render(
    <SessionHero
      listing={listing}
      author={author}
      reviews={reviews}
      userFields={userFields}
      onManageDisableScrolling={() => {}}
    />,
    { messages, routeConfiguration }
  );

const review = (id, rating = 5, createdAt = new Date(Date.UTC(2026, 9, 12))) =>
  createReview(
    id,
    { rating, content: `Review ${id}`, createdAt },
    { author: createUser(`r-${id}`) }
  );

describe('hero title', () => {
  it('sets the part after the last comma in Bold and the rest in Regular', () => {
    renderHero();
    const title = screen.getByTestId('session-title');
    expect(title.tagName).toBe('H1');
    expect(title).toHaveTextContent('Get clear on your next career move, then make it.');
    const bold = title.querySelector('b');
    expect(bold).toHaveTextContent('then make it.');
    expect(title.textContent.startsWith('Get clear on your next career move, ')).toBe(true);
  });

  it('sets a title with no comma in Bold throughout', () => {
    renderHero({ listing: session({ rest: { title: 'Make the decision' } }) });
    const title = screen.getByTestId('session-title');
    expect(title.querySelector('b')).toHaveTextContent('Make the decision');
    expect(title.textContent).toBe('Make the decision');
  });

  it('labels the session with its lengths', () => {
    renderHero();
    expect(screen.getAllByText('Signature session · 30, 60 or 90 min').length).toBeGreaterThan(0);
  });
});

describe('hero quick facts', () => {
  it('shows the prep fact only when pre_work has text', () => {
    const { unmount } = renderHero({
      listing: session({ publicData: { pre_work: 'A short form.' } }),
    });
    expect(screen.getByTestId('fact-prep')).toHaveTextContent('Short prep questionnaire');
    unmount();

    renderHero({ listing: session({ publicData: { pre_work: '   ' } }) });
    expect(screen.queryByTestId('fact-prep')).not.toBeInTheDocument();
    expect(screen.getByText('Video call')).toBeInTheDocument();
  });

  it('leaves out "next available" until a slot is known', async () => {
    renderHero();
    expect(screen.queryByTestId('fact-next-available')).not.toBeInTheDocument();
  });

  it('shows the next available day in the viewer’s timezone once the slots arrive', async () => {
    const { nylasAvailability } = require('../../../util/api');
    // 17 Nov 2026, 12:00 UTC (the same calendar day almost everywhere)
    nylasAvailability.mockResolvedValueOnce({
      slots: [
        { start: Date.UTC(2026, 10, 19, 12), end: Date.UTC(2026, 10, 19, 13) },
        { start: Date.UTC(2026, 10, 17, 12), end: Date.UTC(2026, 10, 17, 13) },
      ],
      connected: true,
    });
    renderHero({ listing: session({ publicData: { calendarBookingEnabled: true } }) });
    expect(await screen.findByTestId('fact-next-available')).toHaveTextContent(
      /Next available \w{3} 17 Nov/
    );
  });
});

describe('hero coach row', () => {
  it('links the name to the coach profile and shows pronouns, certification, location and languages', () => {
    renderHero();
    expect(screen.getByRole('link', { name: 'Maya R., see profile' })).toBeInTheDocument();
    expect(screen.getByText('she/her')).toBeInTheDocument();
    expect(screen.getByText('ICF ACC')).toBeInTheDocument();
    expect(screen.getByText('UK · English, Spanish')).toBeInTheDocument();
  });

  it('leaves out pronouns and the one-line title when the coach has none', () => {
    renderHero({ author: coach({ pronouns: undefined }) });
    expect(screen.queryByText('she/her')).not.toBeInTheDocument();
  });

  it('shows the one-line title when the coach has one', () => {
    renderHero({ author: coach({ coach_title: 'Career coach for first-time leaders' }) });
    expect(screen.getByText('Career coach for first-time leaders')).toBeInTheDocument();
  });

  it('shows "New to Revie" with no reviews, a count with one or two, the score from three', () => {
    const badge = reviews => {
      const { unmount } = renderHero({ reviews });
      const text = (screen.queryByTestId('rating-badge') || screen.getByTestId('new-badge'))
        .textContent;
      const isNew = !!screen.queryByTestId('new-badge');
      unmount();
      return { text, isNew };
    };

    expect(badge([])).toEqual({ text: 'New to Revie', isNew: true });
    // one or two: no score, just how many
    expect(badge([review('a', 5)])).toEqual({ text: '1 review', isNew: false });
    expect(badge([review('a', 5), review('b', 4)])).toEqual({ text: '2 reviews', isNew: false });
    // three or more: the average, to one decimal
    expect(badge([review('a', 5), review('b', 4), review('c', 4)])).toEqual({
      text: '4.3 · 3 reviews',
      isNew: false,
    });
  });
});

describe('hero lived-experience tags', () => {
  const manyTags = [
    'single-parent',
    'adhd',
    'first-generation',
    'neurodivergent',
    'caregiver',
    'chronic-illness',
  ];

  it('shows all of them when there are four or fewer, with no "more" button', () => {
    renderHero();
    const tags = within(screen.getByTestId('hero-tags'));
    expect(tags.getAllByRole('listitem')).toHaveLength(4);
    expect(tags.queryByRole('button')).not.toBeInTheDocument();
  });

  it('caps them at four with "+N more", which opens a dialog listing all of them', async () => {
    const user = userEvent.setup();
    renderHero({ author: coach({ personality_identifier: manyTags }) });

    const tags = within(screen.getByTestId('hero-tags'));
    // four tags plus the button's own list item
    expect(tags.getAllByRole('listitem')).toHaveLength(5);
    expect(tags.queryByText('Caregiver')).not.toBeInTheDocument();

    await user.click(tags.getByRole('button', { name: '+2 more' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent("Maya's been there.");
    manyTags.forEach((key, i) => {
      const label = userFields[0].enumOptions.find(o => o.option === key).label;
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('never uses chartreuse for a tag', () => {
    renderHero({ author: coach({ personality_identifier: manyTags }) });
    // chartreuse is only the "New to Revie" badge; tag colours are periwinkle, pink or orange
    screen.getAllByRole('listitem').forEach(li => {
      expect(li.className).not.toMatch(/chartreuse/);
    });
  });
});

describe('the session section', () => {
  it('sets the first sentence large and the rest as body text', () => {
    render(<SessionAbout description="First sentence. The rest of it follows." preWork="" />, {
      messages,
    });
    expect(screen.getByText('First sentence.')).toBeInTheDocument();
    expect(screen.getByText('First sentence.').querySelector('b')).toBeNull();
    expect(screen.getByText('The rest of it follows.')).toBeInTheDocument();
    expect(screen.queryByTestId('prep-card')).not.toBeInTheDocument();
  });

  it('does not bold a first sentence with a comma (only titles are bold after the last comma)', () => {
    render(<SessionAbout description="You're good at it, but not sure. The rest." preWork="" />, {
      messages,
    });
    const lead = screen.getByText("You're good at it, but not sure.");
    expect(lead.tagName).toBe('P');
    expect(lead.querySelector('b')).toBeNull();
  });

  it('opens further paragraphs with "Read more"', async () => {
    const user = userEvent.setup();
    render(<SessionAbout description={'One. Two.\n\nHidden paragraph.'} preWork="" />, {
      messages,
    });
    expect(screen.queryByText('Hidden paragraph.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Read more' }));
    expect(screen.getByText('Hidden paragraph.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.queryByText('Hidden paragraph.')).not.toBeInTheDocument();
  });

  it('shows the "Before your session" card with the coach\'s own words, only when pre_work has text', () => {
    const { unmount } = render(<SessionAbout description="One." preWork="Fill in the form." />, {
      messages,
    });
    expect(screen.getByTestId('prep-card')).toHaveTextContent('Before your session');
    expect(screen.getByText('Fill in the form.')).toBeInTheDocument();
    unmount();

    render(<SessionAbout description="One." preWork="   " />, { messages });
    expect(screen.queryByTestId('prep-card')).not.toBeInTheDocument();
  });

  it('has no "The session" label above it', () => {
    render(<SessionAbout description="One. Two." preWork="" />, { messages });
    expect(screen.queryByText('The session')).not.toBeInTheDocument();
  });
});

describe('"You\'ll walk away with"', () => {
  it('is hidden without outcome 1', () => {
    const { container } = render(<SessionOutcomesSection publicData={{}} />, { messages });
    expect(container).toBeEmptyDOMElement();

    render(<SessionOutcomesSection publicData={{ outcome_2: 'Second', outcome_3: 'Third' }} />, {
      messages,
    });
    expect(screen.queryByTestId('session-outcomes')).not.toBeInTheDocument();
  });

  it('shows the outcomes numbered, skipping blanks', () => {
    render(
      <SessionOutcomesSection
        publicData={{ outcome_1: 'First', outcome_2: '  ', outcome_3: 'Third' }}
      />,
      { messages }
    );
    expect(screen.getByRole('heading', { name: "You'll walk away with" })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map(li => li.textContent)).toEqual(['1First', '2Third']);
  });
});

describe('the coach section', () => {
  it('shows no quote card when the coach has not written one', () => {
    render(<SessionCoach author={coach()} userFields={userFields} />, { messages });
    expect(screen.queryByTestId('coach-quote')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Get to know Maya.' })).toBeInTheDocument();
  });

  it('shows the quote in one weight (only titles are bold after their last comma)', () => {
    render(
      <SessionCoach
        author={coach({
          clients_love: "Clients love working with me because I'm blunt, then I help.",
        })}
        userFields={userFields}
      />,
      { messages }
    );
    const quote = screen.getByTestId('coach-quote');
    expect(quote).toHaveTextContent("Clients love working with me because I'm blunt, then I help.");
    expect(quote.querySelector('b')).toBeNull();
  });

  it('has no "The coach" label above its heading', () => {
    render(<SessionCoach author={coach()} userFields={userFields} />, { messages });
    expect(screen.queryByText('The coach')).not.toBeInTheDocument();
  });

  describe('quote card', () => {
    const quoteCoach = (publicData = {}) =>
      coach({ clients_love: 'I say the thing your friends will not.', ...publicData });

    it("has the coach's name in the card, and her pronouns when she has set them", () => {
      const { unmount } = render(<SessionCoach author={quoteCoach()} userFields={userFields} />, {
        messages,
        routeConfiguration,
      });
      const card = within(screen.getByTestId('coach-quote'));
      expect(card.getByText('Maya R.')).toBeInTheDocument();
      expect(card.getByText('she/her')).toBeInTheDocument();
      unmount();

      render(
        <SessionCoach author={quoteCoach({ pronouns: undefined })} userFields={userFields} />,
        {
          messages,
          routeConfiguration,
        }
      );
      const withoutPronouns = within(screen.getByTestId('coach-quote'));
      expect(withoutPronouns.getByText('Maya R.')).toBeInTheDocument();
      expect(withoutPronouns.queryByText('she/her')).not.toBeInTheDocument();
    });

    it("has an outlined button to the coach's profile", () => {
      render(<SessionCoach author={quoteCoach()} userFields={userFields} />, {
        messages,
        routeConfiguration,
      });
      const link = within(screen.getByTestId('coach-quote')).getByRole('link', {
        name: "See Maya's profile",
      });
      expect(link).toHaveAttribute('href', '/u/coach-1');
    });

    it('shows her initials in the wave until she has a photo', () => {
      render(<SessionCoach author={quoteCoach()} userFields={userFields} />, {
        messages,
        routeConfiguration,
      });
      expect(screen.getByTestId('wave-photo-initials')).toHaveTextContent('MR');
    });

    it('shows her photo in the wave when she has one', () => {
      const author = {
        ...quoteCoach(),
        profileImage: {
          id: { uuid: 'img' },
          type: 'image',
          attributes: {
            variants: {
              'scale-small': { url: 'https://example.com/s.jpg', width: 400, height: 550 },
              'scale-large': { url: 'https://example.com/l.jpg', width: 800, height: 1100 },
            },
          },
        },
      };
      render(<SessionCoach author={author} userFields={userFields} />, {
        messages,
        routeConfiguration,
      });
      expect(screen.getByTestId('wave-photo-image')).toHaveAttribute('alt', 'Maya R.');
      expect(screen.queryByTestId('wave-photo-initials')).not.toBeInTheDocument();
    });
  });

  it('opens with a hairline and extra space only when the session has reviews', () => {
    const { unmount } = render(
      <SessionCoach author={coach()} userFields={userFields} afterReviews={true} />,
      { messages }
    );
    expect(screen.getByTestId('session-coach').className).toMatch(/coachAfterReviews/);
    unmount();

    render(<SessionCoach author={coach()} userFields={userFields} />, { messages });
    expect(screen.getByTestId('session-coach').className).not.toMatch(/coachAfterReviews/);
  });

  it('shows coaching style and tools, and opens the story and social link', async () => {
    const user = userEvent.setup();
    render(
      <SessionCoach
        author={coach({
          communication_style: ['direct'],
          focusareas: ['values'],
          sociallink: 'https://www.linkedin.com/in/maya',
        })}
        userFields={userFields}
      />,
      { messages }
    );
    expect(screen.getByText('Direct')).toBeInTheDocument();
    expect(screen.getByText('Values work')).toBeInTheDocument();
    expect(screen.queryByText('I spent twelve years in HR.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: "Read Maya's story" }));
    expect(screen.getByText('I spent twelve years in HR.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: "Maya's social profile" });
    expect(link).toHaveAttribute('href', 'https://www.linkedin.com/in/maya');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('never makes a clickable link out of a non-http social link', async () => {
    const user = userEvent.setup();
    render(
      <SessionCoach
        author={coach({ sociallink: 'javascript:alert(1)' })}
        userFields={userFields}
      />,
      { messages }
    );
    await user.click(screen.getByRole('button', { name: "Read Maya's story" }));
    expect(screen.queryByRole('link', { name: "Maya's social profile" })).not.toBeInTheDocument();
  });
});

describe('Good to know', () => {
  it('shows the four platform-policy cards', () => {
    render(<SessionGoodToKnow firstName="Maya" authorId="coach-1" />, {
      messages,
      routeConfiguration,
    });
    ["How you'll meet", 'Paying', 'Cancelling', 'Moving your session'].forEach(title => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
    expect(screen.getByText(/Free up to 48 hours before/)).toHaveTextContent(
      "If Maya cancels, you're refunded in full."
    );
  });
});

describe('reviews', () => {
  it('are hidden when there are none (no "Reviews (0)")', () => {
    const { container } = render(<SessionReviews reviews={[]} />, { messages });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Reviews/)).not.toBeInTheDocument();
  });

  it('show the average, the two latest, and the rest behind "See all"', async () => {
    const user = userEvent.setup();
    const reviews = [
      review('old', 4, new Date(Date.UTC(2026, 7, 1))),
      review('new', 5, new Date(Date.UTC(2026, 9, 12))),
      review('mid', 5, new Date(Date.UTC(2026, 8, 1))),
    ];
    render(<SessionReviews reviews={reviews} />, { messages });

    const section = within(screen.getByTestId('session-reviews'));
    expect(section.getByRole('heading', { name: 'What clients say.' })).toBeInTheDocument();
    expect(section.queryByText('The details')).not.toBeInTheDocument();
    expect(section.queryByText('Reviews of this session')).not.toBeInTheDocument();
    expect(section.getByText('4.7')).toBeInTheDocument();
    expect(section.getByText('from 3 reviews')).toBeInTheDocument();
    expect(section.getAllByTestId('review-card')).toHaveLength(2);
    expect(section.getByText('“Review new”')).toBeInTheDocument();
    expect(section.queryByText('“Review old”')).not.toBeInTheDocument();

    await user.click(section.getByRole('button', { name: 'See all 3 reviews' }));
    expect(section.getAllByTestId('review-card')).toHaveLength(3);
  });

  it('show the cards but no score with one or two reviews', () => {
    render(<SessionReviews reviews={[review('a', 5), review('b', 5)]} />, { messages });
    const section = within(screen.getByTestId('session-reviews'));
    expect(section.getAllByTestId('review-card')).toHaveLength(2);
    expect(section.queryByTestId('reviews-average')).not.toBeInTheDocument();
    expect(section.queryByText(/from 2 reviews/)).not.toBeInTheDocument();
    expect(section.getByRole('heading', { name: 'What clients say.' })).toBeInTheDocument();
  });
});

describe('Good to know', () => {
  it('has no "The details" label above its heading', () => {
    render(<SessionGoodToKnow firstName="Maya" authorId="coach-1" />, {
      messages,
      routeConfiguration,
    });
    expect(screen.queryByText('The details')).not.toBeInTheDocument();
  });
});
