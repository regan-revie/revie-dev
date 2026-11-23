/**
 * The pg pool is mocked: these tests check the order of statements and what happens on each path
 * (lock, judge, insert, commit or roll back), not Postgres itself. The row lock and the counts are
 * verified against Render's database in the HANDOFF's test steps.
 */
const makeClient = script => {
  const log = [];
  const client = {
    log,
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      const text = sql.replace(/\s+/g, ' ').trim();
      log.push(text);
      return script(text, params) || { rows: [] };
    }),
  };
  return client;
};

const load = client => {
  jest.resetModules();
  jest.doMock('../nylas/db', () => ({
    isAvailable: () => true,
    query: jest.fn(async () => ({ rows: [] })),
    getPool: () => ({ connect: async () => client }),
  }));
  return require('./store');
};

const NOW = Date.parse('2026-12-01T12:00:00Z');
const row = (extra = {}) => ({
  code: 'NEWYEAR15',
  percent_off: '15.00',
  expires_at: null,
  max_total_uses: 50,
  max_uses_per_customer: 1,
  first_session_only: false,
  active: true,
  ...extra,
});
const counts = (extra = {}) => ({
  total: 0,
  customer_paid: 0,
  customer_reserved: 0,
  customer_first_session: 0,
  ...extra,
});
const scripted = ({ promo = row(), live = counts() } = {}) => text => {
  if (text.startsWith('SELECT * FROM promo_codes')) return { rows: promo ? [promo] : [] };
  if (text.includes('FROM promo_redemptions r JOIN promo_codes')) return { rows: [live] };
  if (text.startsWith('INSERT INTO promo_redemptions')) return { rows: [{ id: 41 }] };
  return null;
};
const args = {
  code: 'newyear15',
  customerId: 'u1',
  hasEarlierPaidBooking: false,
  commissionPercent: 20,
  now: NOW,
};

describe('reserving a use', () => {
  it('locks the code row first, judges, inserts a reserved use and commits', async () => {
    const client = makeClient(scripted());
    const store = load(client);
    const result = await store.reserve(args);

    expect(result).toEqual({ ok: true, percentOff: 15, redemptionId: '41' });
    expect(client.log[0]).toBe('BEGIN');
    expect(client.log[1]).toContain('FOR UPDATE');
    expect(client.log.some(q => q.startsWith('INSERT INTO promo_redemptions'))).toBe(true);
    expect(client.log[client.log.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('counts reserved uses against the total cap, so the last use cannot be taken twice', async () => {
    const client = makeClient(scripted({ live: counts({ total: 50 }) }));
    const result = await load(client).reserve(args);
    expect(result).toEqual({ ok: false, reason: 'used-up' });
    expect(client.log).toContain('ROLLBACK');
    expect(client.log.some(q => q.startsWith('INSERT INTO promo_redemptions'))).toBe(false);
  });

  it('refuses a client who has used it already or has one in progress', async () => {
    const used = makeClient(scripted({ live: counts({ customer_paid: 1 }) }));
    expect((await load(used).reserve(args)).reason).toBe('already-used');
    const inProgress = makeClient(scripted({ live: counts({ customer_reserved: 1 }) }));
    expect((await load(inProgress).reserve(args)).reason).toBe('in-progress');
  });

  it('refuses an unknown code without inserting anything', async () => {
    const client = makeClient(scripted({ promo: null }));
    expect(await load(client).reserve(args)).toEqual({ ok: false, reason: 'invalid' });
    expect(client.log).toContain('ROLLBACK');
  });

  it('rolls back and rethrows if something fails mid-way', async () => {
    const client = makeClient(text => {
      if (text.startsWith('INSERT')) throw new Error('boom');
      return scripted()(text);
    });
    await expect(load(client).reserve(args)).rejects.toThrow('boom');
    expect(client.log).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('a use becoming paid', () => {
  it("goes up on the code's counter only when a reserved use really became paid", async () => {
    const paid = makeClient(text =>
      text.startsWith('UPDATE promo_redemptions') ? { rows: [{ code: 'NEWYEAR15' }] } : null
    );
    expect(await load(paid).markPaid('41')).toBe(true);
    expect(paid.log.some(q => q.includes('uses_so_far = uses_so_far + 1'))).toBe(true);

    const again = makeClient(() => ({ rows: [] }));
    expect(await load(again).markPaid('41')).toBe(false);
    expect(again.log.some(q => q.includes('uses_so_far'))).toBe(false);
  });
});

describe('a use being released', () => {
  it("a paid use comes off the code's counter; a merely reserved one never went on", async () => {
    const wasPaid = makeClient(text =>
      text.startsWith('UPDATE promo_redemptions')
        ? { rows: [{ code: 'NEWYEAR15', was: 'paid' }] }
        : null
    );
    expect(await load(wasPaid).release('41')).toBe(true);
    expect(wasPaid.log.some(q => q.includes('GREATEST(uses_so_far - 1, 0)'))).toBe(true);

    const wasReserved = makeClient(text =>
      text.startsWith('UPDATE promo_redemptions')
        ? { rows: [{ code: 'NEWYEAR15', was: 'reserved' }] }
        : null
    );
    await load(wasReserved).release('41');
    expect(wasReserved.log.some(q => q.includes('uses_so_far'))).toBe(false);
  });

  it('releasing twice does nothing the second time', async () => {
    const client = makeClient(() => ({ rows: [] }));
    expect(await load(client).release('41')).toBe(false);
  });
});
