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

  it('shows "New to Revie" until there is a review, then the rating', () => {
    const { unmount } = renderHero();
    expect(screen.getByTestId('new-badge')).toHaveTextContent('New to Revie');
    unmount();

    renderHero({ reviews: [review('a', 5), review('b', 4)] });
    expect(screen.queryByTestId('new-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('rating-badge')).toHaveTextContent('4.5 · 2 reviews');
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
    expect(screen.getByText('The rest of it follows.')).toBeInTheDocument();
    expect(screen.queryByTestId('prep-card')).not.toBeInTheDocument();
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

  it('shows the "Before your session" card only when pre_work has text', () => {
    render(<SessionAbout description="One." preWork="Fill in the form." />, { messages });
    expect(screen.getByTestId('prep-card')).toHaveTextContent('Before your session');
    expect(screen.getByText('Fill in the form.')).toBeInTheDocument();
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

  it('shows the quote with the part after the last comma in Bold', () => {
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
    expect(quote.querySelector('b')).toHaveTextContent('then I help.');
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
    expect(section.getByText('4.7')).toBeInTheDocument();
    expect(section.getByText('from 3 reviews')).toBeInTheDocument();
    expect(section.getAllByTestId('review-card')).toHaveLength(2);
    expect(section.getByText('“Review new”')).toBeInTheDocument();
    expect(section.queryByText('“Review old”')).not.toBeInTheDocument();

    await user.click(section.getByRole('button', { name: 'See all 3 reviews' }));
    expect(section.getAllByTestId('review-card')).toHaveLength(3);
  });
});
