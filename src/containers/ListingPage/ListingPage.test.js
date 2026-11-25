import React from 'react';
import '@testing-library/jest-dom';

import configureStore from '../../store';
import { types as sdkTypes } from '../../util/sdkLoader';
import {
  createUser,
  createCurrentUser,
  createListing,
  createOwnListing,
  createReview,
} from '../../util/testData';
import {
  renderWithProviders as render,
  testingLibrary,
  getRouteConfiguration,
  getHostedConfiguration,
} from '../../util/testHelpers';

import enMessages from '../../translations/en.json';
import { storableError } from '../../util/errors';

import {
  LISTING_STATE_PENDING_APPROVAL,
  LISTING_STATE_PUBLISHED,
  LISTING_STATE_CLOSED,
} from '../../util/types';

import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';

import reducer, { showListing, loadData, setInitialValues } from './ListingPage.duck';

import ActionBar from './Notifications/ActionBar';

const { UUID } = sdkTypes;
const { screen, waitFor, within } = testingLibrary;
const noop = () => null;

const logger = actions => () => {
  return next => action => {
    actions.push(action);
    // Call the next dispatch method in the middleware chain.
    return next(action);
  };
};

const listingTypes = [
  {
    id: 'sell-bicycles',
    transactionProcess: {
      name: 'default-purchase',
      alias: 'default-purchase/release-1',
    },
    unitType: 'item',
  },
  {
    id: 'rent-bicycles-nightly',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'night',
  },
];

const capitalizeFirstLetter = str => str.charAt(0).toUpperCase() + str.slice(1);
const addSpaces = str => str.split('-').join(' ');
const labelize = str => addSpaces(capitalizeFirstLetter(str));

const generateCategories = optionStrings => {
  return optionStrings.reduce((converted, entry) => {
    const isArray = Array.isArray(entry);
    const option = isArray
      ? { id: entry[0], name: labelize(entry[0]), subcategories: generateCategories(entry[1]) }
      : { id: entry, name: labelize(entry) };
    return [...converted, option];
  }, []);
};
const categories = generateCategories([
  ['dogs', ['labradors', 'poodles']],
  ['cats', ['burmese', 'egyptian-mau']],
  ['fish', [['freshwater', ['grayling', 'arctic-char', 'pike']], 'saltwater']],
  ['birds', ['parrot', 'macaw']],
]);
//console.log(JSON.stringify(categories, null, 2));

const listingFields = [
  {
    key: 'cat',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['sell-bicycles'],
    },
    categoryConfig: {
      limitToCategoryIds: true,
      categoryIds: ['cats'],
    },
    schemaType: 'enum',
    enumOptions: [{ option: 'cat_1', label: 'Cat 1' }, { option: 'cat_2', label: 'Cat 2' }],
    filterConfig: {
      showFilter: true,
    },
    showConfig: {
      label: 'Cat',
      isDetail: true,
    },
  },
  {
    key: 'amenities',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['rent-bicycles-daily', 'rent-bicycles-nightly', 'rent-bicycles-hourly'],
    },
    schemaType: 'multi-enum',
    enumOptions: [
      { option: 'feat_1', label: 'Feat 1' },
      { option: 'feat_2', label: 'Feat 2' },
      { option: 'feat_3', label: 'Feat 3' },
    ],
    filterConfig: {
      showFilter: true,
    },
    showConfig: {
      label: 'Amenities',
      searchMode: 'has_all',
      group: 'secondary',
    },
  },
];

const getConfig = variantType => {
  const hostedConfig = getHostedConfiguration();
  return {
    ...hostedConfig,
    listingTypes: {
      listingTypes,
    },
    listingFields: {
      listingFields,
    },
    categories: { categories },
    layout: {
      ...hostedConfig.layout,
      listingPage: { variantType },
    },
  };
};

const id = 'listing1';
const slug = 'listing1-title';
const publicData = {
  listingType: 'sell-bicycles', // Ensure listing field can be tied to listing type
  transactionProcessAlias: 'default-purchase/release-1',
  unitType: 'item',
  categoryLevel1: 'cats', // Ensure listing field can be tied to category
  cat: 'cat_1',
};
const listing1 = createListing(id, { publicData }, { author: createUser('user-1') });
const listing1Own = createOwnListing(id, {}, { author: createCurrentUser('user-1') });
const review = createReview(
  'review-id',
  {
    createdAt: new Date(Date.UTC(2023, 5, 19, 11, 34)),
    rating: 4,
    type: 'ofProvider',
    content: 'It was awesome!',
  },
  { author: createUser('reviewerA'), listing: listing1 }
);

// We'll initialize the store with relevant listing data
const initialState = {
  ListingPage: {
    id: listing1.id,
    showListingError: null,
    reviews: [review],
    fetchReviewsError: null,
    monthlyTimeSlots: {
      // '2022-03': {
      //   timeSlots: [],
      //   fetchTimeSlotsError: null,
      //   fetchTimeSlotsInProgress: null,
      // },
    },
    lineItems: null,
    fetchLineItemsInProgress: false,
    fetchLineItemsError: null,
    sendInquiryInProgress: false,
    sendInquiryError: null,
    inquiryModalOpenForListingId: null,
  },
  marketplaceData: {
    entities: {
      listing: {
        listing1,
      },
      ownListing: {
        listing1: listing1Own,
      },
    },
  },
};

describe('ListingPage variants', () => {
  const commonProps = {
    params: { id, slug },
    scrollingDisabled: false,
    onManageDisableScrolling: noop,
    callSetInitialValues: noop,
    setInitialValues: noop,
    onFetchTransactionLineItems: noop,
    onSendInquiry: noop,
    onInitializeCardPaymentData: noop,
    onFetchTimeSlots: noop,
  };

  // The redesigned session page (docs/design/session-page/) has no photo area, so both layout
  // choices in Console render it.
  it.each(['coverPhoto', 'carousel'])('renders the session page in %s mode', async variantType => {
    const config = getConfig(variantType);
    const routeConfiguration = getRouteConfiguration(config.layout);
    const props = { ...commonProps };
    const listingRouteConfig = routeConfiguration.find(conf => conf.name === 'ListingPage');
    const ListingPage = listingRouteConfig.component;

    const { getByRole, queryByRole, getByText } = render(<ListingPage {...props} />, {
      initialState,
      config,
      routeConfiguration,
      messages: enMessages,
    });

    await waitFor(() => {
      // The session page's own top bar: marketing-site links, no search field.
      expect(getByRole('link', { name: 'Find a coach' })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('TopbarSearchForm.placeholder')).not.toBeInTheDocument();

      // No gallery and no cover photo.
      expect(screen.queryByTestId('carousel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hero')).not.toBeInTheDocument();

      // The title in the hero is the page's h1. (The booking panel keeps a second h1 for its phone
      // sheet, hidden by CSS on desktop; job B's concern.)
      expect(screen.getByTestId('session-title').tagName).toBe('H1');
      expect(screen.getByTestId('session-hero')).toBeInTheDocument();

      // The old details list, map and "about the provider" section are gone.
      expect(queryByRole('heading', { name: 'ListingPage.detailsTitle' })).not.toBeInTheDocument();
      expect(queryByRole('heading', { name: 'ListingPage.locationTitle' })).not.toBeInTheDocument();
      expect(
        queryByRole('heading', { name: 'ListingPage.aboutProviderTitle' })
      ).not.toBeInTheDocument();
      expect(queryByRole('heading', { name: /Reviews \(\d+\)/ })).not.toBeInTheDocument();

      // The coach and "Good to know" sections, and this session's reviews.
      expect(screen.getByTestId('session-coach')).toBeInTheDocument();
      expect(screen.getByTestId('session-good')).toBeInTheDocument();
      const reviews = within(screen.getByTestId('session-reviews'));
      expect(reviews.getByText('“It was awesome!”')).toBeInTheDocument();
      expect(getByText('from 1 review')).toBeInTheDocument();
    });
  });
});

describe('Duck', () => {
  const listingFields = [];
  const config = {
    layout: {
      listingImage: {
        aspectWidth: 400,
        aspectHeight: 400,
        variantPrefix: 'listing-card',
      },
    },
    listing: {
      listingFields,
    },
    accessControl: { marketplace: { private: true } },
  };

  describe('reducer', () => {
    it('should have correct initial state', () => {
      const state = reducer(undefined, { type: '@@INIT' });
      expect(state).toEqual({
        id: null,
        showListingError: null,
        reviews: [],
        fetchReviewsError: null,
        monthlyTimeSlots: {},
        timeSlotsForDate: {},
        lineItems: null,
        fetchLineItemsInProgress: false,
        fetchLineItemsError: null,
        sendInquiryInProgress: false,
        sendInquiryError: null,
        inquiryModalOpenForListingId: null,
      });
    });

    it('should handle setInitialValues action', () => {
      // First set up a state with some data
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(state, {
        type: 'ListingPage/showListing/rejected',
        payload: new Error('Test error'),
      });
      state = reducer(state, {
        type: 'ListingPage/fetchReviews/rejected',
        payload: new Error('Reviews error'),
      });
      state = reducer(state, {
        type: 'ListingPage/fetchTimeSlots/rejected',
        payload: new Error('TimeSlots error'),
        meta: {
          arg: {
            useFetchTimeSlotsForDate: false,
            start: new Date('2023-01-01'),
            timeZone: 'UTC',
          },
        },
      });
      state = reducer(state, {
        type: 'ListingPage/fetchTransactionLineItems/fulfilled',
        payload: { test: 'lineItems' },
      });

      // Now test setInitialValues - it should reset to initial state and apply payload
      state = reducer(
        state,
        setInitialValues({
          inquiryModalOpenForListingId: 'test-id',
        })
      );

      // Should reset all errors and clear lineItems
      expect(state.showListingError).toBeNull();
      expect(state.fetchReviewsError).toBeNull();
      expect(state.fetchLineItemsError).toBeNull();
      expect(state.sendInquiryError).toBeNull();
      expect(state.lineItems).toBeNull();
      expect(state.monthlyTimeSlots).toEqual({});
      expect(state.timeSlotsForDate).toEqual({});

      // Should apply the payload
      expect(state.inquiryModalOpenForListingId).toBe('test-id');
    });

    it('should handle showListingThunk.pending', () => {
      const initialState = reducer(undefined, { type: '@@INIT' });
      const state = reducer(initialState, {
        type: 'ListingPage/showListing/pending',
        meta: { arg: { listingId: 'test-listing-id' } },
      });

      expect(state.id).toBe('test-listing-id');
      expect(state.showListingError).toBeNull();
    });

    it('should handle showListingThunk.rejected', () => {
      const initialState = reducer(undefined, { type: '@@INIT' });
      const error = new Error('Test error');
      const state = reducer(initialState, {
        type: 'ListingPage/showListing/rejected',
        payload: error,
      });

      expect(state.showListingError).toBe(error);
    });

    it('should handle fetchReviewsThunk.pending', () => {
      const initialState = reducer(undefined, { type: '@@INIT' });
      const state = reducer(initialState, {
        type: 'ListingPage/fetchReviews/pending',
      });

      expect(state.fetchReviewsError).toBeNull();
    });

    it('should handle fetchReviewsThunk.fulfilled', () => {
      const initialState = reducer(undefined, { type: '@@INIT' });
      const reviews = [{ id: 'review1' }, { id: 'review2' }];
      const state = reducer(initialState, {
        type: 'ListingPage/fetchReviews/fulfilled',
        payload: reviews,
      });

      expect(state.reviews).toEqual(reviews);
    });

    it('should handle fetchReviewsThunk.rejected', () => {
      const initialState = reducer(undefined, { type: '@@INIT' });
      const error = new Error('Reviews error');
      const state = reducer(initialState, {
        type: 'ListingPage/fetchReviews/rejected',
        payload: error,
      });

      expect(state.fetchReviewsError).toBe(error);
    });
  });

  describe('showListing thunk', () => {
    it('should dispatch success and fetch current user', () => {
      const id = new UUID('00000000-0000-0000-0000-000000000000');
      const response = { data: { data: listing1, include: [] } };
      const sdk = {
        listings: { show: jest.fn(() => Promise.resolve(response)) },
        currentUser: { show: jest.fn(() => Promise.resolve({})) },
        authInfo: jest.fn(() => Promise.resolve({})),
      };
      let actions = [];
      const store = configureStore({
        initialState: { ListingPage: reducer(undefined, { type: '@@INIT' }) },
        sdk,
        extraMiddlewares: [logger(actions)],
      });
      const dispatch = store.dispatch;
      const getState = store.getState;

      return showListing(id, config)(dispatch, getState, sdk).then(data => {
        expect(sdk.listings.show.mock.calls).toEqual([
          [
            expect.objectContaining({
              id,
              'imageVariant.listing-card': 'w:400;h:400;fit:crop',
              'imageVariant.listing-card-2x': 'w:800;h:800;fit:crop',
              // The coach's photo in its original shape, cropped in the browser (components/CoachPhoto)
              'imageVariant.scale-small': 'w:400;h:800;fit:scale',
              'imageVariant.scale-large': 'w:800;h:1600;fit:scale',
              'fields.image': expect.arrayContaining([
                'variants.scale-small',
                'variants.scale-large',
              ]),
              include: ['author', 'author.profileImage', 'images', 'currentStock'],
            }),
          ],
        ]);

        const relevantActions = actions.filter(
          action => !action.type.startsWith('user/fetchCurrentUser/')
        );

        // Check that the expected action types are present
        expect(relevantActions[0].type).toBe('ListingPage/showListing/pending');
        expect(relevantActions[0].meta.arg).toEqual({ listingId: id, config, isOwn: false });

        expect(relevantActions[1].type).toBe('marketplaceData/addEntities');
        expect(relevantActions[2].type).toBe('ListingPage/showListing/fulfilled');
        expect(relevantActions[2].payload).toEqual(response);

        // fetchCurrentUser may complete after the main thunk resolves
        const fetchCurrentUserFulfilled = actions.find(
          action => action.type === 'user/fetchCurrentUser/fulfilled'
        );
        expect(fetchCurrentUserFulfilled).toBeDefined();
      });
    });

    it('should dispatch error', () => {
      const id = new UUID('00000000-0000-0000-0000-000000000000');
      const error = new Error('fail');
      const sdk = {
        listings: { show: jest.fn(() => Promise.reject(error)) },
        currentUser: { show: jest.fn(() => Promise.resolve({})) },
        authInfo: jest.fn(() => Promise.resolve({})),
      };
      let actions = [];
      const store = configureStore({
        initialState: { ListingPage: reducer(undefined, { type: '@@INIT' }) },
        sdk,
        extraMiddlewares: [logger(actions)],
      });
      const dispatch = store.dispatch;
      const getState = store.getState;

      return showListing(id, config)(dispatch, getState, sdk).catch(() => {
        expect(sdk.listings.show.mock.calls).toEqual([
          [
            expect.objectContaining({
              id,
              'imageVariant.listing-card': 'w:400;h:400;fit:crop',
              'imageVariant.listing-card-2x': 'w:800;h:800;fit:crop',
              include: ['author', 'author.profileImage', 'images', 'currentStock'],
            }),
          ],
        ]);

        const relevantActions = actions.filter(
          action => !action.type.startsWith('user/fetchCurrentUser/')
        );

        expect(relevantActions[0].type).toBe('ListingPage/showListing/pending');
        expect(relevantActions[0].meta.arg).toEqual({ listingId: id, config, isOwn: false });

        expect(relevantActions[1].type).toBe('ListingPage/showListing/rejected');
        expect(relevantActions[1].payload).toEqual(storableError(error));
      });
    });
  });

  // Shared parameters for viewing rights loadData tests
  const fakeResponse = resource => ({ data: { data: resource, include: [] } });
  const sdkFn = response => jest.fn(() => Promise.resolve(response));

  const sanitizeConfig = { listingFields };

  it("loadData() for currentUser with full viewing rights loads someone else's listing", () => {
    const currentUser = createCurrentUser('currentUser');
    const testInitialState = {
      ...initialState,
      user: { currentUser },
      auth: { isAuthenticated: true },
    };

    // For users with full viewing rights, ListingPage.showListing
    // uses listings.show endpoint
    const sdk = {
      listings: { show: sdkFn(fakeResponse(listing1)) },
      currentUser: { show: sdkFn(fakeResponse(currentUser)) },
      authInfo: sdkFn({}),
      reviews: { query: sdkFn(fakeResponse(review)) },
    };

    let actions = [];
    const store = configureStore({
      initialState: testInitialState,
      sdk,
      extraMiddlewares: [logger(actions)],
    });
    const dispatch = store.dispatch;
    const getState = store.getState;

    // Tests the actions that get dispatched to the Redux store when ListingPage.duck.js
    // loadData() function is called. If you make customizations to the loadData() logic,
    // update the dispatched actions list in this test accordingly!
    return loadData({ id }, null, config)(dispatch, getState, sdk).then(data => {
      const relevantActions = actions.filter(
        action => !action.type.startsWith('user/fetchCurrentUser/')
      );
      expect(relevantActions[0]).toEqual(
        setInitialValues({ inquiryModalOpenForListingId: null, lineItems: null })
      );
      expect(relevantActions[1].type).toBe('ListingPage/showListing/pending');
      expect(relevantActions[2].type).toBe('ListingPage/fetchReviews/pending');
      expect(relevantActions[3]).toEqual(
        addMarketplaceEntities(fakeResponse(listing1), sanitizeConfig)
      );
      expect(relevantActions[4].type).toBe('auth/authInfo/pending');
      expect(relevantActions[5].type).toBe('ListingPage/showListing/fulfilled');
      expect(relevantActions[6].type).toBe('ListingPage/fetchReviews/fulfilled');
      expect(relevantActions[7].type).toBe('auth/authInfo/fulfilled');
    });
  });

  it("loadData() for currentUser with no viewing rights does not load someone else's listing", () => {
    const currentUser = createCurrentUser('currentUser');
    currentUser.effectivePermissionSet.attributes.read = 'permission/deny';
    const testInitialState = {
      ...initialState,
      user: { currentUser },
      auth: { isAuthenticated: true },
    };

    const error = new Error('Request failed with status code 403');
    error.status = 403;
    error.apiErrors = [
      {
        id: new UUID('asdf'),
        status: 403,
        code: 'user-pending-approval',
        title: 'User pending approval',
      },
    ];

    // For viewing rights restricted users, ListingPage.showListing
    // uses ownListings.show endpoint, which throws 403 when accessing
    // a listing that is not the current user's own
    const sdk = {
      ownListings: { show: jest.fn(() => Promise.reject(error)) },
      listings: { show: jest.fn(() => Promise.reject(error)) },
      currentUser: { show: sdkFn(fakeResponse(currentUser)) },
      reviews: { query: jest.fn(() => Promise.reject(error)) },
      authInfo: sdkFn({}),
    };

    let actions = [];
    const store = configureStore({
      initialState: testInitialState,
      sdk,
      extraMiddlewares: [logger(actions)],
    });
    const dispatch = store.dispatch;
    const getState = store.getState;

    // Tests the actions that get dispatched to the Redux store when ListingPage.duck.js
    // loadData() function is called. If you make customizations to the loadData() logic,
    // update the dispatched actions list in this test accordingly!
    return loadData({ id }, null, config)(dispatch, getState, sdk).catch(e => {
      // Note: catch for loadData is on Routes.js component in practice.
      const relevantActions = actions.filter(
        action => !action.type.startsWith('user/fetchCurrentUser/')
      );
      expect(relevantActions[0]).toEqual(
        setInitialValues({ inquiryModalOpenForListingId: null, lineItems: null })
      );
      expect(relevantActions[2].type).toBe('auth/authInfo/pending');
      expect(relevantActions[3].type).toBe('ListingPage/showListing/rejected');
      expect(relevantActions[4].type).toBe('auth/authInfo/fulfilled');
    });
  });

  it("loadData() for currentUser with no viewing rights loads the user's own listing", () => {
    const currentUser = createCurrentUser('currentUser');
    currentUser.effectivePermissionSet.attributes.read = 'permission/deny';
    const testInitialState = {
      ...initialState,
      user: { currentUser },
      auth: { isAuthenticated: true },
    };
    const error = new Error('Request failed with status code 403');

    // For viewing rights restricted users, ListingPage.showListing
    // users ownListings.show endpoint, which fetches the user's
    // own listings successfully.
    const sdk = {
      ownListings: { show: sdkFn(fakeResponse(listing1Own)) },
      listings: { show: jest.fn(() => Promise.reject(error)) },
      currentUser: { show: sdkFn(fakeResponse(currentUser)) },
      authInfo: sdkFn({}),
    };

    let actions = [];
    const store = configureStore({
      initialState: testInitialState,
      sdk,
      extraMiddlewares: [logger(actions)],
    });
    const dispatch = store.dispatch;
    const getState = store.getState;

    // Tests the actions that get dispatched to the Redux store when ListingPage.duck.js
    // loadData() function is called. If you make customizations to the loadData() logic,
    // update the dispatched actions list in this test accordingly!
    return loadData({ id }, null, config)(dispatch, getState, sdk).then(data => {
      const relevantActions = actions.filter(
        action => !action.type.startsWith('user/fetchCurrentUser/')
      );
      expect(relevantActions[0]).toEqual(
        setInitialValues({ inquiryModalOpenForListingId: null, lineItems: null })
      );
      expect(relevantActions[1].type).toBe('ListingPage/showListing/pending');
      expect(relevantActions[2]).toEqual(
        addMarketplaceEntities(fakeResponse(listing1Own), sanitizeConfig)
      );
      expect(relevantActions[3].type).toBe('auth/authInfo/pending');
      expect(relevantActions[4].type).toBe('ListingPage/showListing/fulfilled');
      expect(relevantActions[5].type).toBe('auth/authInfo/fulfilled');
    });
  });
});

describe('ActionBar', () => {
  it('shows users own listing status', () => {
    const listing = createListing('listing-published', {
      state: LISTING_STATE_PUBLISHED,
    });
    render(
      <ActionBar
        isOwnListing
        listing={listing}
        editParams={{ id: 'id1', slug: 'asdf', type: 'edit', tab: 'details' }}
      />
    );

    expect(screen.getByText('ListingPage.ownListing')).toBeInTheDocument();
    expect(screen.getByText('ListingPage.editListing')).toBeInTheDocument();
  });

  it('shows users own pending listing status', () => {
    const listing = createListing('listing-published', {
      state: LISTING_STATE_PENDING_APPROVAL,
    });
    render(
      <ActionBar
        isOwnListing
        listing={listing}
        editParams={{ id: 'id1', slug: 'asdf', type: 'edit', tab: 'details' }}
      />
    );
    expect(screen.getByText('ListingPage.ownListingPendingApproval')).toBeInTheDocument();
    expect(screen.getByText('ListingPage.editListing')).toBeInTheDocument();
  });

  it('shows users own closed listing status', () => {
    const listing = createListing('listing-closed', {
      state: LISTING_STATE_CLOSED,
    });
    render(
      <ActionBar
        isOwnListing
        listing={listing}
        editParams={{ id: 'id1', slug: 'asdf', type: 'edit', tab: 'details' }}
      />
    );
    expect(screen.getByText('ListingPage.ownClosedListing')).toBeInTheDocument();
    expect(screen.getByText('ListingPage.editListing')).toBeInTheDocument();
  });

  it('shows closed listing status', () => {
    const listing = createListing('listing-closed', {
      state: LISTING_STATE_CLOSED,
    });
    render(
      <ActionBar
        isOwnListing={false}
        listing={listing}
        editParams={{ id: 'id1', slug: 'asdf', type: 'edit', tab: 'details' }}
      />
    );
    expect(screen.getByText('ListingPage.closedListing')).toBeInTheDocument();
  });

  it("is missing if listing is published but not user's own", () => {
    const listing = createListing('listing-published', {
      state: LISTING_STATE_PUBLISHED,
    });
    const actionBar = render(
      <ActionBar
        isOwnListing={false}
        listing={listing}
        editParams={{ id: 'id1', slug: 'asdf', type: 'edit', tab: 'details' }}
      />
    );
    expect(actionBar.asFragment().firstChild).toBeNull();
  });
});
