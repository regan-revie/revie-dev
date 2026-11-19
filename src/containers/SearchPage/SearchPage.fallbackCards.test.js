import React, { act } from 'react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';

import configureStore from '../../store';
import { types as sdkTypes } from '../../util/sdkLoader';
import { createListing, createUser } from '../../util/testData';
import {
  getDefaultConfiguration,
  getHostedConfiguration,
  renderWithProviders as render,
  testingLibrary,
} from '../../util/testHelpers';
import { mergeConfig } from '../../util/configHelpers';
import { makeGetListingsByIdSelector } from '../../ducks/marketplaceData.duck';

import { fetchOtherSessions, listingCardQueryParams } from './SearchPage.duck';
import { ListingCard } from '../../components';

const { UUID } = sdkTypes;
const { screen, waitFor } = testingLibrary;

const config = mergeConfig(getHostedConfiguration(), getDefaultConfiguration());
const cardParams = listingCardQueryParams(config);

// A fake Sharetribe API that behaves like the real one where it matters here: it only sends the
// author and the images (and only the image variants asked for) when the query includes them.
// `included` is what the real SDK response carries next to `data`.
const fakeSdk = () => {
  const author = createUser('coach1', {
    profile: { displayName: 'Coach Casey', abbreviatedName: 'CC' },
  });
  const imageWith = variants => ({
    id: new UUID('img1'),
    type: 'image',
    attributes: {
      variants: Object.fromEntries(
        variants.map(name => [
          name.replace('variants.', ''),
          { name, width: 400, height: 400, url: `https://img.example/${name}.jpg` },
        ])
      ),
    },
  });

  const query = jest.fn(params => {
    const include = params.include || [];
    const wantsAuthor = include.includes('author');
    const wantsImages = include.includes('images');
    const listing = {
      ...createListing('fallback1', {
        title: 'Fallback session',
        publicData: { calendarBookingEnabled: true },
      }),
      relationships: {
        ...(wantsAuthor ? { author: { data: { id: author.id, type: 'user' } } } : {}),
        ...(wantsImages ? { images: { data: [{ id: new UUID('img1'), type: 'image' }] } } : {}),
      },
    };
    const included = [
      ...(wantsAuthor ? [author] : []),
      ...(wantsImages ? [imageWith(params['fields.image'] || [])] : []),
    ];
    return Promise.resolve({ data: { data: [listing], included, meta: { totalItems: 1 } } });
  });

  return { listings: { query } };
};

describe('other-coaches fallback cards, from the fallback response alone', () => {
  it('asks for the same author, images, image variants and fields as the search results', async () => {
    const sdk = fakeSdk();
    const store = configureStore({ sdk });
    await store.dispatch(fetchOtherSessions({ excludeIds: [], config }));

    const params = sdk.listings.query.mock.calls[0][0];
    expect(params.include).toEqual(['author', 'images']);
    expect(params['fields.user']).toEqual(cardParams['fields.user']);
    expect(params['fields.image']).toEqual(cardParams['fields.image']);
    expect(params['limit.images']).toBe(1);
    cardParams['fields.image']
      .filter(f => f.startsWith('variants.listing-card'))
      .forEach(f => expect(params['fields.image']).toContain(f));
    // Everything the card asks for, plus the flag the fallback itself filters on.
    cardParams['fields.listing'].forEach(f => expect(params['fields.listing']).toContain(f));
    expect(params['fields.listing']).toContain('publicData.calendarBookingEnabled');
  });

  it('renders the image and the author name with an empty store', async () => {
    const sdk = fakeSdk();
    const store = configureStore({ sdk }); // nothing in the store beforehand
    expect(store.getState().marketplaceData.entities).toEqual({});

    const { payload: ids } = await store.dispatch(fetchOtherSessions({ excludeIds: [], config }));
    expect(ids).toHaveLength(1);
    const listings = makeGetListingsByIdSelector()(store.getState(), ids);

    // The denormalised listing carries its author and the variant the card looks for.
    expect(listings[0].author.attributes.profile.displayName).toBe('Coach Casey');
    expect(Object.keys(listings[0].images[0].attributes.variants)).toContain('listing-card');

    await act(async () => {
      render(
        <ListingCard listing={listings[0]} lazyLoadImage={false} />,
        // The test provider builds its own store from this state: what the fallback response put in.
        {
          config: getHostedConfiguration(),
          initialState: store.getState(),
          messages: { 'ListingCard.author': 'by {authorName}' },
        }
      );
    });

    // The image is rendered, from the card's own variant, and it is not the "no image" placeholder.
    const img = await screen.findByRole('img', { name: 'Fallback session' });
    expect(img.getAttribute('srcset')).toContain('listing-card');
    expect(screen.queryByText('ResponsiveImage.noImage')).toBeNull();
    // The author's name is on the card.
    expect(screen.getByText('by Coach Casey')).toBeInTheDocument();
  });

  it('control: a card from a response without author and images shows "no image" and no name', async () => {
    // What the old fallback query got back. This is the state the bug left on the page.
    const store = configureStore({ sdk: fakeSdk() });
    await store.dispatch(fetchOtherSessions({ excludeIds: [], config }));
    const bare = {
      ...makeGetListingsByIdSelector()(store.getState(), [new UUID('fallback1')])[0],
      author: null,
      images: [],
    };

    await act(async () => {
      render(<ListingCard listing={bare} lazyLoadImage={false} />, {
        config: getHostedConfiguration(),
        messages: { 'ListingCard.author': 'by {authorName}' },
      });
    });
    expect(screen.getByText('ResponsiveImage.noImage')).toBeInTheDocument();
    expect(screen.queryByText('by Coach Casey')).toBeNull();
  });

  it('fails the check when the query leaves out the author and images (the original bug)', async () => {
    // Guard on the test itself: against a query without include, the fake API sends no author
    // and no image, which is what the real API did and why the card was bare.
    const sdk = fakeSdk();
    const response = await sdk.listings.query({ perPage: 24 });
    expect(response.data.included).toEqual([]);
  });
});
