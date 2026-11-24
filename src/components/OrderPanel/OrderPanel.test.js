import React from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../util/sdkLoader';
import {
  createCurrentUser,
  createListing,
  createStock,
  createUser,
  fakeIntl,
} from '../../util/testData';
import {
  renderWithProviders as render,
  testingLibrary,
  getRouteConfiguration,
  getHostedConfiguration,
} from '../../util/testHelpers';
import { TIME_SLOT_TIME } from '../../util/types';

import * as calendarConnection from '../../util/calendarConnection';
import OrderPanel from './OrderPanel';

const { screen, waitFor } = testingLibrary;

const { Money, UUID } = sdkTypes;
const noop = () => null;

const today = new Date();
const currentYear = today.getUTCFullYear();
const m = today.getUTCMonth() + 1;
const currentMonth = m < 10 ? `0${m}` : m;
const currentDay = today.getUTCDate();

const listingTypes = [
  {
    id: 'rent-bicycles-daily',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'day',
  },
  {
    id: 'rent-bicycles-nightly',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'night',
  },
  {
    id: 'rent-bicycles-hourly',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'hour',
  },
  {
    id: 'sell-bicycles',
    transactionProcess: {
      name: 'default-purchase',
      alias: 'default-purchase/release-1',
    },
    unitType: 'item',
    stockType: 'multipleItems',
  },
];

const listingFields = [
  {
    key: 'cat',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['sell-bicycles'],
    },
    schemaType: 'enum',
    enumOptions: [{ option: 'cat_1', label: 'Cat 1' }, { option: 'cat_2', label: 'Cat 2' }],
    filterConfig: {
      showFilter: true,
      label: 'Cat',
      group: 'primary',
    },
    showConfig: {
      label: 'Cat',
    },
    saveConfig: {
      label: 'Cat',
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
    enumOptions: [{ option: 'dog_1', label: 'Dog 1' }, { option: 'dog_2', label: 'Dog 2' }],
    filterConfig: {
      showFilter: true,
      label: 'Amenities',
      //searchMode: 'has_all',
      group: 'secondary',
    },
    showConfig: {
      label: 'Category',
    },
    saveConfig: {
      label: 'Category',
    },
  },
];

const timeSlots = [
  {
    id: new UUID(1),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-14T09:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth}-14T10:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
  {
    id: new UUID(2),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-14T16:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth}-14T20:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
  {
    id: new UUID(3),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-20T09:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth}-22T18:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
  {
    id: new UUID(4),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-17T09:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth}-17T18:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
  {
    id: new UUID(5),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-28T09:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth + 1}-03T18:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
];

const getConfig = () => {
  const hostedConfig = getHostedConfiguration();
  return {
    ...hostedConfig,
    listingFields: {
      listingFields,
    },
    listingTypes: {
      listingTypes,
    },
  };
};

const monthlyId = `${currentYear}-${currentMonth}`;
const monthlyTimeSlots = {
  [monthlyId]: {
    timeSlots,
    fetchTimeSlotsError: null,
    fetchTimeSlotsInProgress: null,
  },
};

const dayId = `${currentYear}-${currentMonth}-${currentDay}`;
const timeSlotsForDate = {
  [dayId]: {
    timeSlots,
    fetchTimeSlotsError: null,
    fetchTimeSlotsInProgress: null,
    fetchedAt: new Date().getTime(),
  },
};

const commonProps = {
  author: createUser('john-author'),
  authorLink: null,
  onSubmit: noop,
  title: 'title!',
  titleDesktop: null,
  subTitle: 'subtitle!',
  onManageDisableScrolling: noop,

  onFetchTimeSlots: noop,
  monthlyTimeSlots,
  onFetchTransactionLineItems: noop,
  onContactUser: noop,
  lineItems: [],
  fetchLineItemsInProgress: false,
  fetchLineItemsError: null,
  marketplaceCurrency: 'USD',
  dayCountAvailableForBooking: 90,
  marketplaceName: 'Test marketplace',
  showListingImage: true,

  history: {
    push: noop,
  },
  location: {
    search: '',
  },
  intl: fakeIntl,
};

describe('OrderPanel', () => {
  const config = getConfig();
  const routeConfiguration = getRouteConfiguration(config.layout);
  const stockTypeMaybe = stockType => (stockType ? { stockType } : {});
  const validListingTypes = config.listingTypes.listingTypes.map(({ id, ...rest }) => ({
    listingType: id,
    transactionType: {
      process: rest?.transactionProcess?.name,
      alias: rest?.transactionProcess?.alias,
      unitType: rest.unitType,
    },
    ...stockTypeMaybe(rest?.stockType),
  }));

  it('Booking: daily', async () => {
    const listing = createListing('listing-day', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),
      availabilityPlan: {
        type: 'availability-plan/time',
        timezone: 'Etc/UTC',
        entries: [
          { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 0 },
        ],
      },

      publicData: {
        listingType: 'rent-bicycles-daily',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'day',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
      },
    });

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });
    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('BookingDatesForm.bookingStartTitle')).toBeInTheDocument();
      expect(getByText('BookingDatesForm.bookingEndTitle')).toBeInTheDocument();
      expect(getByText('BookingDatesForm.requestToBook')).toBeInTheDocument();
      expect(getByText('OrderPanel.youWontBeChargedInfo')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessageBooking')).toBeInTheDocument();
    });
  });

  it('Booking: nightly', async () => {
    const listing = createListing('listing-night', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),
      availabilityPlan: {
        type: 'availability-plan/time',
        timezone: 'Etc/UTC',
        entries: [
          { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 0 },
        ],
      },

      publicData: {
        listingType: 'rent-bicycles-nighlty',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'night',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
      },
    });

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });
    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('BookingDatesForm.bookingStartTitle')).toBeInTheDocument();
      expect(getByText('BookingDatesForm.bookingEndTitle')).toBeInTheDocument();
      expect(getByText('BookingDatesForm.requestToBook')).toBeInTheDocument();
      expect(getByText('OrderPanel.youWontBeChargedInfo')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessageBooking')).toBeInTheDocument();
    });
  });

  it('Booking: hourly', async () => {
    const listing = createListing('listing-hourly', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),
      availabilityPlan: {
        type: 'availability-plan/time',
        timezone: 'Etc/UTC',
        entries: [
          { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 0 },
        ],
      },

      publicData: {
        listingType: 'rent-bicycles-hourly',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'hour',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
      },
    });

    const props = {
      ...commonProps,
      timeSlotsForDate,
      listing,
      isOwnListing: false,
      validListingTypes,
    };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('BookingTimeForm.bookingStartTitle')).toBeInTheDocument();
      expect(getByText('FieldDateAndTimeInput.startTime')).toBeInTheDocument();
      expect(getByText('FieldDateAndTimeInput.endTime')).toBeInTheDocument();
      expect(getByText('BookingTimeForm.requestToBook')).toBeInTheDocument();
      expect(getByText('OrderPanel.youWontBeChargedInfo')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessageBooking')).toBeInTheDocument();
    });
  });

  const fixedListing = (publicDataExtra = {}) => {
    return createListing('listing-fixed', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),
      availabilityPlan: {
        type: 'availability-plan/time',
        timezone: 'Etc/UTC',
        entries: [
          { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 0 },
        ],
      },

      publicData: {
        listingType: 'rent-bicycles-fixed',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'fixed',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
        priceVariants: [
          {
            price: new Money(1000, 'USD'),
            bookingLengthInMinutes: 30,
          },
        ],
        startTimeInterval: 'quarterHour',
        ...publicDataExtra,
      },
    });
  };

  const renderFixed = (props, options = {}) =>
    render(
      <OrderPanel
        {...commonProps}
        timeSlotsForDate={timeSlotsForDate}
        validListingTypes={validListingTypes}
        {...props}
      />,
      { config, routeConfiguration, ...options }
    );

  const connectedUser = {
    user: {
      currentUser: createCurrentUser('coach1', {
        profile: { publicData: { calendarConnected: true }, privateData: { nylasGrantId: 'g' } },
      }),
    },
  };

  it('Booking: fixed, not set up for calendar booking: says the coach is not taking bookings, not the stock form', async () => {
    const { getByText, queryByText } = renderFixed({
      listing: fixedListing(),
      isOwnListing: false,
    });

    await waitFor(() => {
      expect(getByText('OrderPanel.notTakingBookings')).toBeInTheDocument();
    });
    expect(queryByText('BookingFixedDurationForm.bookingStartTitle')).not.toBeInTheDocument();
    expect(queryByText('BookingFixedDurationForm.requestToBook')).not.toBeInTheDocument();
  });

  it('Booking: fixed, no availability plan yet (a listing the server has not reached): still the message, not an empty panel', async () => {
    const listing = fixedListing();
    listing.attributes.availabilityPlan = null;
    const { getByText } = renderFixed({ listing, isOwnListing: false });
    await waitFor(() => {
      expect(getByText('OrderPanel.notTakingBookings')).toBeInTheDocument();
    });
  });

  // The coach's own session listing, by what they have done so far. `stripeConnected` is the user
  // attribute Sharetribe sets once payout details exist.
  const coach = ({ calendar, payouts }) => ({
    user: {
      currentUser: createCurrentUser('coach1', {
        stripeConnected: !!payouts,
        profile: calendar
          ? { publicData: { calendarConnected: true }, privateData: { nylasGrantId: 'g' } }
          : {},
      }),
    },
  });

  const stepButton = name => screen.queryByRole('button', { name });
  const CALENDAR = 'OrderPanel.setupConnectCalendar';
  const PAYOUTS = 'OrderPanel.setupAddPayoutDetails';

  it('Booking: fixed, own listing, neither step done: one card with two buttons', async () => {
    renderFixed(
      { listing: fixedListing(), isOwnListing: true },
      { initialState: coach({ calendar: false, payouts: false }) }
    );

    await waitFor(() => {
      expect(screen.getByText('OrderPanel.setupCardHeading')).toBeInTheDocument();
    });
    expect(screen.getByText('OrderPanel.setupCardIntro')).toBeInTheDocument();
    expect(stepButton(CALENDAR)).toBeInTheDocument();
    expect(stepButton(PAYOUTS)).toBeInTheDocument();
    // No ticks, and none of the old red messages.
    expect(screen.queryByText('OrderPanel.setupStepDone')).not.toBeInTheDocument();
    expect(screen.queryByText('OrderPanel.notTakingBookings')).not.toBeInTheDocument();
    expect(screen.queryByText('OrderPanel.ownListingSettingUp')).not.toBeInTheDocument();
  });

  it('Booking: fixed, own listing, calendar done: that step is ticked with no button, payouts still has one', async () => {
    renderFixed(
      { listing: fixedListing(), isOwnListing: true },
      { initialState: coach({ calendar: true, payouts: false }) }
    );

    await waitFor(() => {
      expect(screen.getByText('OrderPanel.setupCardHeading')).toBeInTheDocument();
    });
    expect(stepButton(CALENDAR)).not.toBeInTheDocument();
    expect(screen.getByText(CALENDAR)).toBeInTheDocument();
    expect(screen.getAllByText('OrderPanel.setupStepDone')).toHaveLength(1);
    expect(stepButton(PAYOUTS)).toBeInTheDocument();
  });

  it('Booking: fixed, own listing, payouts done: that step is ticked with no button, calendar still has one', async () => {
    renderFixed(
      { listing: fixedListing(), isOwnListing: true },
      { initialState: coach({ calendar: false, payouts: true }) }
    );

    await waitFor(() => {
      expect(screen.getByText('OrderPanel.setupCardHeading')).toBeInTheDocument();
    });
    expect(stepButton(PAYOUTS)).not.toBeInTheDocument();
    expect(screen.getByText(PAYOUTS)).toBeInTheDocument();
    expect(stepButton(CALENDAR)).toBeInTheDocument();
  });

  it('Booking: fixed, own listing, both done: no card (only a quiet note while the server finishes setting it up)', async () => {
    renderFixed(
      { listing: fixedListing(), isOwnListing: true },
      { initialState: coach({ calendar: true, payouts: true }) }
    );

    await waitFor(() => {
      expect(screen.getByText('OrderPanel.ownListingSettingUp')).toBeInTheDocument();
    });
    expect(screen.queryByText('OrderPanel.setupCardHeading')).not.toBeInTheDocument();
    expect(stepButton(CALENDAR)).not.toBeInTheDocument();
    expect(stepButton(PAYOUTS)).not.toBeInTheDocument();
  });

  it('Booking: fixed, own listing, both done and already set up for calendar booking: no card at all', async () => {
    renderFixed(
      { listing: fixedListing({ calendarBookingEnabled: true }), isOwnListing: true },
      { initialState: coach({ calendar: true, payouts: true }) }
    );

    await waitFor(() => {
      expect(screen.getAllByText('title!').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('OrderPanel.setupCardHeading')).not.toBeInTheDocument();
    expect(screen.queryByText('OrderPanel.ownListingSettingUp')).not.toBeInTheDocument();
  });

  // A coach whose Google connection broke: the server has switched their sessions off
  // (calendarBookingEnabled false) and marked their user reconnect_needed.
  const brokenCoach = {
    user: {
      currentUser: createCurrentUser('coach1', {
        stripeConnected: true,
        profile: {
          publicData: { calendarConnected: true },
          privateData: { nylasGrantId: 'g', calendarStatus: 'reconnect_needed' },
        },
      }),
    },
  };

  it('Booking: fixed, own listing, Google connection broke: the calendar row is not done and offers Reconnect', async () => {
    renderFixed({ listing: fixedListing(), isOwnListing: true }, { initialState: brokenCoach });

    await waitFor(() => {
      expect(screen.getByText('OrderPanel.setupCardHeadingReconnect')).toBeInTheDocument();
    });
    expect(screen.getByText('OrderPanel.setupCardIntroReconnect')).toBeInTheDocument();
    expect(stepButton('OrderPanel.setupReconnectCalendar')).toBeInTheDocument();
    // Not the first-time wording, and not ticked.
    expect(stepButton(CALENDAR)).not.toBeInTheDocument();
    expect(screen.queryByText('OrderPanel.setupStepDone')).toBeInTheDocument(); // payouts are done
    expect(screen.getAllByText('OrderPanel.setupStepDone')).toHaveLength(1);
  });

  it('Booking: fixed, own listing, the Reconnect row goes straight to the Google connect route', async () => {
    const goToUrl = jest.spyOn(calendarConnection, 'goToUrl').mockImplementation(() => {});
    try {
      renderFixed({ listing: fixedListing(), isOwnListing: true }, { initialState: brokenCoach });
      const button = await screen.findByRole('button', {
        name: 'OrderPanel.setupReconnectCalendar',
      });
      button.click();
      expect(goToUrl).toHaveBeenCalledWith(
        '/api/nylas/connect?provider=google&returnPath=%2Faccount%2Fcalendar'
      );
    } finally {
      goToUrl.mockRestore();
    }
  });

  it('Booking: fixed, Google connection broke: a client sees "isn\'t taking bookings yet" and no booking form', async () => {
    // The listing is switched off by the server, which is what the client's page reads.
    renderFixed({ listing: fixedListing(), isOwnListing: false });
    expect(await screen.findByText('OrderPanel.notTakingBookings')).toBeInTheDocument();
    expect(screen.queryByText('BookingFixedDurationForm.requestToBook')).not.toBeInTheDocument();
    expect(screen.queryByText('OrderPanel.setupCardHeadingReconnect')).not.toBeInTheDocument();
  });

  it('Booking: fixed, own listing, reconnected: no reconnect card, the session is set up again', async () => {
    const reconnected = {
      user: {
        currentUser: createCurrentUser('coach1', {
          stripeConnected: true,
          profile: {
            publicData: { calendarConnected: true },
            privateData: { nylasGrantId: 'g', calendarStatus: 'connected' },
          },
        }),
      },
    };
    renderFixed(
      { listing: fixedListing({ calendarBookingEnabled: true }), isOwnListing: true },
      { initialState: reconnected }
    );
    await waitFor(() => {
      expect(screen.getAllByText('title!').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('OrderPanel.setupCardHeadingReconnect')).not.toBeInTheDocument();
  });

  it('Booking: fixed, a client or visitor: the plain "isn\'t taking bookings yet" line, never the card', async () => {
    renderFixed({ listing: fixedListing(), isOwnListing: false });

    const line = await screen.findByText('OrderPanel.notTakingBookings');
    expect(line).toBeInTheDocument();
    expect(screen.queryByText('OrderPanel.setupCardHeading')).not.toBeInTheDocument();
    expect(stepButton(CALENDAR)).not.toBeInTheDocument();
    // Body text, not the red error style.
    expect(line.className).not.toMatch(/error/i);
  });

  it('Purchase: item ', async () => {
    const listing = createListing(
      'listing-product',
      {
        title: 'the listing',
        description: 'Lorem ipsum',
        price: new Money(1000, 'USD'),

        publicData: {
          listingType: 'sell-bicycles',
          transactionProcessAlias: 'default-purchase/release-1',
          unitType: 'item',
          amenities: ['dog_1'],
          location: {
            address: 'Main Street 123',
            building: 'A 1',
          },
          pickupEnabled: true,
        },
      },
      {
        currentStock: createStock('stock-id', { quantity: 5 }),
      }
    );

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('ProductOrderForm.quantityLabel')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.deliveryMethodLabel')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.pickupOption')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.breakdownTitle')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.ctaButton')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.finePrint')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessagePurchase')).toBeInTheDocument();
    });
  });

  it('Purchase: item (no delivery method set)', async () => {
    const listing = createListing(
      'listing-product',
      {
        title: 'the listing',
        description: 'Lorem ipsum',
        price: new Money(1000, 'USD'),

        publicData: {
          listingType: 'sell-bicycles',
          transactionProcessAlias: 'default-purchase/release-1',
          unitType: 'item',
          amenities: ['dog_1'],
          location: {
            address: 'Main Street 123',
            building: 'A 1',
          },
        },
      },
      {
        currentStock: createStock('stock-id', { quantity: 5 }),
      }
    );

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('ProductOrderForm.noDeliveryMethodSet')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessagePurchase')).toBeInTheDocument();
    });
  });

  it('Inquiry: inquiry ', async () => {
    const listing = createListing('listing-inquiry', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),

      publicData: {
        listingType: 'inquiry',
        transactionProcessAlias: 'default-inquiry/release-1',
        unitType: 'inquiry',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
      },
    });

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('InquiryWithoutPaymentForm.ctaButton')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessageInquiry')).toBeInTheDocument();
    });
  });

  // "Finish your profile": the third row of the coach's setup card. The coach's language, location,
  // identity tags and communication style are what their sessions are searched by.
  describe('Booking: fixed, own listing: the profile row', () => {
    const traitField = (key, schemaType = 'multi-enum') => ({
      key,
      label: key,
      scope: 'public',
      schemaType,
      showConfig: { label: key },
      saveConfig: { label: key },
      enumOptions: [{ option: 'x', label: 'X' }],
      userTypeConfig: { limitToUserTypeIds: true, userTypeIds: ['coach'] },
    });
    // Console's shape (hosted asset), which the test provider merges into the app config.
    const withTraitFields = {
      ...config,
      userTypes: {
        userTypes: [
          { id: 'coach', label: 'Coach', roles: { provider: true, customer: false } },
          { id: 'client', label: 'Client', roles: { provider: false, customer: true } },
        ],
      },
      userFields: {
        userFields: [
          ...(config.userFields?.userFields || []),
          traitField('personality_identifier'),
          traitField('languages'),
          traitField('location', 'enum'),
          traitField('communication_style'),
        ],
      },
    };
    const ALL = {
      personality_identifier: ['x'],
      languages: ['x'],
      location: 'x',
      communication_style: ['x'],
    };
    const coachWith = traits => ({
      user: {
        currentUser: createCurrentUser('coach1', {
          stripeConnected: true,
          profile: {
            publicData: { calendarConnected: true, userType: 'coach', ...traits },
            privateData: { nylasGrantId: 'g' },
          },
        }),
      },
    });
    const PROFILE = 'OrderPanel.setupFinishProfile';
    const button = name => screen.queryByRole('button', { name });

    it('calendar and payouts done but the profile not: still the card, with a button to the profile', async () => {
      renderFixed(
        { listing: fixedListing({ calendarBookingEnabled: true }), isOwnListing: true },
        { initialState: coachWith({ languages: ['x'] }), config: withTraitFields }
      );
      await waitFor(() => {
        expect(screen.getByText('OrderPanel.setupCardHeadingFindable')).toBeInTheDocument();
      });
      expect(button(PROFILE)).toBeInTheDocument();
      expect(button('OrderPanel.setupConnectCalendar')).not.toBeInTheDocument();
      expect(button('OrderPanel.setupAddPayoutDetails')).not.toBeInTheDocument();
      expect(screen.queryByText('OrderPanel.setupCardHeading')).not.toBeInTheDocument();
    });

    it('any one of the four missing counts as not finished', async () => {
      const { location, ...withoutLocation } = ALL;
      renderFixed(
        { listing: fixedListing({ calendarBookingEnabled: true }), isOwnListing: true },
        { initialState: coachWith(withoutLocation), config: withTraitFields }
      );
      await waitFor(() => {
        expect(button(PROFILE)).toBeInTheDocument();
      });
    });

    it('all four answered: the row is ticked and, with the rest done, the card is gone', async () => {
      renderFixed(
        { listing: fixedListing({ calendarBookingEnabled: true }), isOwnListing: true },
        { initialState: coachWith(ALL), config: withTraitFields }
      );
      await waitFor(() => {
        expect(screen.queryByText('OrderPanel.setupCardHeading')).not.toBeInTheDocument();
      });
      expect(screen.queryByText('OrderPanel.setupCardHeadingFindable')).not.toBeInTheDocument();
      expect(button(PROFILE)).not.toBeInTheDocument();
    });

    it('with nothing else done, the profile is the third row in the usual card', async () => {
      renderFixed(
        { listing: fixedListing(), isOwnListing: true },
        {
          initialState: {
            user: { currentUser: createCurrentUser('coach1', { stripeConnected: false }) },
          },
          config: withTraitFields,
        }
      );
      await waitFor(() => {
        expect(screen.getByText('OrderPanel.setupCardHeading')).toBeInTheDocument();
      });
      expect(button('OrderPanel.setupConnectCalendar')).toBeInTheDocument();
      expect(button('OrderPanel.setupAddPayoutDetails')).toBeInTheDocument();
      expect(button(PROFILE)).toBeInTheDocument();
    });

    it('where Console has none of the four profile fields, there is no profile row at all', async () => {
      renderFixed(
        { listing: fixedListing(), isOwnListing: true },
        { initialState: coachWith({}), config }
      );
      await waitFor(() => {
        expect(screen.queryByText('OrderPanel.setupCardHeading')).not.toBeInTheDocument();
      });
      expect(button(PROFILE)).not.toBeInTheDocument();
    });
  });
});
