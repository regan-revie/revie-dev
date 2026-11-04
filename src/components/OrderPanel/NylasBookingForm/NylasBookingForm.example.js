import { withStubbedFetch } from '../../../util/stubFetchForExamples';
import NylasBookingForm from './NylasBookingForm';
import PriceVariantPicker from '../PriceVariantPicker/PriceVariantPicker';

// Two weeks of half-hourly slots, 9:00 to 16:30, weekdays only, so the calendar shows blocked days.
const slots = (minutes = 60) => {
  const out = [];
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  for (let d = 3; d < 17; d += 1) {
    const date = new Date(day.getTime() + d * 86400000);
    if ([0, 6].includes(date.getDay())) continue;
    for (let m = 9 * 60; m + minutes <= 17 * 60; m += 30) {
      const start = date.getTime() + m * 60000;
      out.push({ start, end: start + minutes * 60000 });
    }
  }
  return out;
};

const Previewed = withStubbedFetch(NylasBookingForm, {
  '/api/nylas/availability': url => ({
    slots: slots(String(url).includes('Deep') ? 90 : 60),
    connected: true,
  }),
});

// The booking form a client sees on a coach's page, with fixture times.
export const Preview = {
  component: Previewed,
  props: {
    listingId: 'preview-listing',
    isOwnListing: false,
    price: { amount: 9000, currency: 'GBP' },
    marketplaceName: 'Revie',
    isPriceVariationsInUse: true,
    priceVariantFieldComponent: PriceVariantPicker,
    priceVariants: [
      { name: 'Standard', bookingLengthInMinutes: 60, priceInSubunits: 9000 },
      { name: 'Deep', bookingLengthInMinutes: 90, priceInSubunits: 13000 },
    ],
    onFetchTransactionLineItems: () => {},
    onSubmit: values => console.log('submit', values),
  },
  group: 'booking',
};
