/**
 * A fake Sharetribe Integration SDK for the grant-status tests: users and listings kept in memory,
 * with the few calls grantStatus.js and grantHealth.js make. Not used outside tests.
 */

const makeFakeSdk = ({ users = [], listings = [] } = {}) => {
  const store = {
    users: Object.fromEntries(users.map(u => [u.id, JSON.parse(JSON.stringify(u))])),
    listings: Object.fromEntries(listings.map(l => [l.id, JSON.parse(JSON.stringify(l))])),
  };
  const asUser = u => ({
    id: { uuid: u.id },
    attributes: {
      email: u.email,
      profile: {
        firstName: u.firstName,
        displayName: u.displayName,
        privateData: { ...(u.privateData || {}) },
      },
    },
  });
  const asListing = l => ({
    id: { uuid: l.id },
    attributes: { publicData: { ...(l.publicData || {}) } },
  });

  const sdk = {
    store,
    users: {
      show: jest.fn(async ({ id }) => ({ data: { data: asUser(store.users[id]) } })),
      query: jest.fn(async ({ perPage = 100, page = 1 }) => {
        const all = Object.values(store.users).map(asUser);
        const slice = all.slice((page - 1) * perPage, page * perPage);
        return {
          data: { data: slice, meta: { totalPages: Math.max(1, Math.ceil(all.length / perPage)) } },
        };
      }),
      updateProfile: jest.fn(async ({ id, privateData }) => {
        store.users[id].privateData = { ...(store.users[id].privateData || {}), ...privateData };
        return { data: { data: asUser(store.users[id]) } };
      }),
    },
    listings: {
      query: jest.fn(async ({ authorId }) => ({
        data: {
          data: Object.values(store.listings)
            .filter(l => l.authorId === authorId)
            .map(asListing),
          meta: { totalPages: 1 },
        },
      })),
      update: jest.fn(async ({ id, publicData }) => {
        const key = id.uuid || id;
        store.listings[key].publicData = {
          ...(store.listings[key].publicData || {}),
          ...publicData,
        };
        return { data: { data: asListing(store.listings[key]) } };
      }),
    },
  };
  return sdk;
};

const coach = (id, privateData = {}, extra = {}) => ({
  id,
  email: `${id}@coach.example`,
  firstName: 'Sam',
  displayName: 'Sam Coach',
  privateData: {
    nylasGrantId: `grant-${id}`,
    nylasGrantEmail: `${id}@gmail.example`,
    ...privateData,
  },
  ...extra,
});

const sessionListing = (id, authorId, enabled = true) => ({
  id,
  authorId,
  publicData: { calendarBookingEnabled: enabled, nylasConfigurationIds: { 60: 'cfg' } },
});

module.exports = { makeFakeSdk, coach, sessionListing };
