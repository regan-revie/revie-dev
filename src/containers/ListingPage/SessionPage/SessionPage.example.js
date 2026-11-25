import React, { useEffect } from 'react';

import { types as sdkTypes } from '../../../util/sdkLoader';
import { useConfiguration } from '../../../context/configurationContext';
import { createCurrentUser, createUser, createListing, createReview } from '../../../util/testData';

import { withPhoto } from '../../../components/CoachPhoto/CoachPhoto.fixture';
import SessionTopbar, { AccountMenu } from './SessionTopbar';
import { BookingCard } from '../../../components/OrderPanel/BookingPanelParts';
import topbarCss from './SessionTopbar.module.css';
import SessionHero from './SessionHero';
import SessionAbout from './SessionAbout';
import SessionCoach from './SessionCoach';
import SessionGoodToKnow from './SessionGoodToKnow';
import SessionReviews from './SessionReviews';
import SessionOutcomesSection from '../../../components/SessionOutcomes/SessionOutcomesSection';

import sessionCss from './SessionPage.module.css';

const { Money } = sdkTypes;

/**
 * Styleguide examples for the redesigned session page, with made-up coach, copy and reviews, so
 * the page can be checked at desktop and phone widths without a signed-in account or a live
 * session. Open "Full page" as /styleguide/c/SessionPage/FullPage/raw for the page without the
 * styleguide around it. Sample content only; nothing here is real data.
 */

const author = createUser('example-coach', {
  profile: {
    displayName: 'Maya R.',
    abbreviatedName: 'MR',
    bio:
      "I spent twelve years in HR watching brilliant women get passed over for roles they'd have been great at, mostly because nobody had helped them say out loud what they wanted. Now that's the whole job.\n\nI work best with people who are ready to be honest about what isn't working.",
    publicData: {
      pronouns: 'she-her',
      certifications: ['acc'],
      location: 'uk',
      languages: ['english', 'spanish'],
      personality_identifier: [
        'single-parent',
        'neurodivergent',
        'first-generation',
        'adhd',
        'caregiver',
        'chronic-illness',
      ],
      communication_style: ['direct', 'supportive', 'analytical'],
      focusareas: ['values', 'career', 'reframing'],
      sociallink: 'https://www.linkedin.com/in/example',
      coach_title: 'Career coach for women stepping into their first leadership role',
      clients_love:
        "Clients love working with me because I'll say the thing your friends are too polite to say, then help you do something about it.",
    },
  },
});

const listing = createListing(
  'example-session',
  {
    title: 'Get clear on your next career move, then make it.',
    description:
      "You're good at your job. You're less sure it's the right job. We'll separate what you want from what you think you should want, and turn it into one move you can make this month.\n\nBring the thing you keep circling back to: the promotion you're not sure you want, the side project that won't go away, the manager conversation you keep postponing.",
    price: new Money(11000, 'USD'),
    publicData: {
      pre_work:
        "Once you book, I'll send a short questionnaire so we don't spend the first 10 minutes on background. Bring one situation you're stuck on.",
      outcome_1: 'A short list of what you actually want from work, in your own words',
      outcome_2: 'One decision made, or one clear test to run before you make it',
      outcome_3: "A first step for this week, small enough that you'll actually do it",
      priceVariants: [
        { name: '30 minutes', bookingLengthInMinutes: 30 },
        { name: '60 minutes', bookingLengthInMinutes: 60 },
        { name: '90 minutes', bookingLengthInMinutes: 90 },
      ],
    },
  },
  { author }
);

const reviews = [
  [
    'a',
    5,
    'I came in sure I needed a new job. I left knowing I needed one hard conversation with my boss. I had it the next week.',
    new Date(Date.UTC(2026, 9, 12)),
  ],
  [
    'b',
    5,
    "I've done coaching before and walked away with a nice feeling. This time I walked away with a plan.",
    new Date(Date.UTC(2026, 8, 3)),
  ],
  ['c', 4, 'Direct, warm, practical.', new Date(Date.UTC(2026, 7, 21))],
].map(([id, rating, content, createdAt]) =>
  createReview(id, { rating, content, createdAt }, { author: createUser(`reviewer-${id}`) })
);

// The hero twice, once with a photo and once without (the capsule with her initials), for checking
// the coach photo. With ?bare=1 in the page URL the styleguide's own frame is hidden, so the page
// can be screenshotted on its own.
const useBareStyleguide = () =>
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get('bare')) {
      return;
    }
    const nav = document.querySelector('[class*="StyleguidePage_navBar"]');
    const main = document.querySelector('[class*="StyleguidePage_main"]');
    const root = document.querySelector('#styleguide');
    const heading = document.querySelector('[class*="contentHeading"]');
    if (nav) nav.style.display = 'none';
    if (heading) heading.style.display = 'none';
    if (main) main.style.cssText = 'width:100%;max-width:none;margin:0;padding:0;flex:1 1 100%';
    if (root) {
      root.style.display = 'block';
      root.style.padding = '0';
    }
  }, []);

const Page = ({ withReviews, tags }) => {
  useBareStyleguide();
  const config = useConfiguration();
  const userFields = config?.user?.userFields;
  // With reviews: the coach has a photo (a drawn portrait, in the shape of a real profile image).
  // Without: no photo, so the capsule shows her initials.
  const coach = tags
    ? { ...author, profileImage: withPhoto() }
    : {
        ...author,
        attributes: {
          ...author.attributes,
          profile: {
            ...author.attributes.profile,
            publicData: {
              ...author.attributes.profile.publicData,
              personality_identifier: ['single-parent', 'adhd'],
            },
          },
        },
      };
  return (
    <div className={sessionCss.page}>
      <SessionTopbar />
      <div className={sessionCss.main}>
        <div className={sessionCss.column}>
          <SessionHero
            listing={listing}
            author={coach}
            reviews={withReviews ? reviews : []}
            userFields={userFields}
            onManageDisableScrolling={() => {}}
          />
          <SessionAbout
            description={listing.attributes.description}
            preWork={listing.attributes.publicData.pre_work}
          />
          <SessionOutcomesSection publicData={listing.attributes.publicData} />
          <SessionReviews reviews={withReviews ? reviews : []} />
          <SessionCoach author={coach} userFields={userFields} afterReviews={withReviews} />
          <SessionGoodToKnow firstName="Maya" authorId="example-coach" />
        </div>
        {/* Stands in for the booking panel (job B restyles the real one), to check where it sits */}
        <div className={sessionCss.bookColumn}>
          <div
            style={{
              height: 520,
              padding: 28,
              borderRadius: 20,
              border: '1px solid rgba(49, 4, 22, 0.16)',
              background: 'var(--revieCream)',
              boxShadow: '0 12px 32px rgba(49, 4, 22, 0.1)',
            }}
          >
            Booking panel
          </div>
        </div>
      </div>
    </div>
  );
};

const NoReviews = () => <Page withReviews={false} tags={false} />;
const WithReviews = () => <Page withReviews={true} tags={true} />;

export const FullPage = { component: NoReviews, props: {}, group: 'session page' };
export const FullPageWithReviews = { component: WithReviews, props: {}, group: 'session page' };

const HeroPair = () => {
  const config = useConfiguration();
  const userFields = config?.user?.userFields;
  useBareStyleguide();
  const withPhotoCoach = { ...author, profileImage: withPhoto() };
  return (
    <div className={sessionCss.page}>
      {[withPhotoCoach, author].map((coach, i) => (
        <div key={i} className={sessionCss.main} style={{ display: 'block' }}>
          <SessionHero
            listing={listing}
            author={coach}
            reviews={[]}
            userFields={userFields}
            onManageDisableScrolling={() => {}}
          />
        </div>
      ))}
    </div>
  );
};

export const HeroWithPhotoAndWithInitials = {
  component: HeroPair,
  props: {},
  group: 'session page',
};

/**
 * The signed-in account menu, opened, with the sticky booking panel's place just below it, to check
 * the card's width (no wrapping), where it opens (its right edge on the avatar's) and that it sits
 * above the panel.
 */
const MenuOpenOverPanel = () => {
  useBareStyleguide();
  useEffect(() => {
    const timer = setTimeout(() => {
      const button = document.getElementById('session-profile-menu-label');
      if (button) button.click();
    }, 400);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className={sessionCss.pageRoot}>
      <div className={topbarCss.root}>
        <header className={topbarCss.bar}>
          <div style={{ marginLeft: 'auto' }}>
            <AccountMenu
              currentUser={createCurrentUser('example-client', {
                profile: { firstName: 'Jess', lastName: 'Lee', abbreviatedName: 'JL' },
              })}
              kind="client"
              inboxTab="orders"
              onLogout={() => {}}
            />
          </div>
        </header>
      </div>
      <div className={sessionCss.main}>
        <div className={sessionCss.column} />
        <div className={sessionCss.bookColumn}>
          <BookingCard>
            <p style={{ margin: 0, minHeight: 360 }}>The booking panel.</p>
          </BookingCard>
        </div>
      </div>
    </div>
  );
};

export const AccountMenuOpen = { component: MenuOpenOverPanel, props: {}, group: 'session page' };
