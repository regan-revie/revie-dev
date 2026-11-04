import React, { useEffect, useState } from 'react';

/**
 * Styleguide-only helper. Wraps a component so its calls to our own /api/nylas/* endpoints are
 * answered with fixtures instead of the network, which lets the booking-path screens be shown (and
 * checked for contrast) without a coach, a calendar or a login.
 *
 * `routes` maps a path fragment to the JSON body to return. The real fetch is restored on unmount,
 * and anything that matches no route goes through untouched.
 */
export const withStubbedFetch = (Component, routes) => {
  const Wrapped = props => {
    const [ready, setReady] = useState(false);

    useEffect(() => {
      const realFetch = window.fetch;
      window.fetch = (url, options) => {
        const match = Object.keys(routes).find(fragment => String(url).includes(fragment));
        if (!match) return realFetch(url, options);
        const body = typeof routes[match] === 'function' ? routes[match](url) : routes[match];
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      };
      setReady(true);
      return () => {
        window.fetch = realFetch;
      };
    }, []);

    return ready ? <Component {...props} /> : null;
  };
  return Wrapped;
};
