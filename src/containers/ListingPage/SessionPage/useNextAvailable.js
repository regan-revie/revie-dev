import { useEffect, useState } from 'react';

import { nylasAvailability } from '../../../util/api';

/**
 * The start of the earliest bookable slot for a session, in epoch milliseconds, or null while
 * loading, when there is none, or when it cannot be found (a quick fact is left out rather than
 * shown wrong, so a failed request is not an error on the page).
 *
 * Asks our own server (the same endpoint the booking panel uses), which applies the coach's notice
 * period and working hours; the slots are read for the session's first length. Browser only: it
 * runs in an effect, so server-side rendering shows no date and the client fills it in.
 */
const useNextAvailable = ({ listingId, priceVariantName, enabled }) => {
  const [nextStart, setNextStart] = useState(null);

  useEffect(() => {
    if (!enabled || !listingId) {
      setNextStart(null);
      return undefined;
    }
    let cancelled = false;
    nylasAvailability({ listingId, priceVariantName })
      .then(response => {
        if (cancelled) {
          return;
        }
        const starts = (response?.slots || [])
          .map(slot => Number(slot.start))
          .filter(Number.isFinite);
        setNextStart(starts.length > 0 ? Math.min(...starts) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setNextStart(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, listingId, priceVariantName]);

  return nextStart;
};

export default useNextAvailable;
