const { decide } = require('./reconcile');

const t = (...names) => names.map(transition => ({ transition }));

describe("what happens to a use, from its booking's history", () => {
  it('a reserved use becomes paid once the booking is accepted', () => {
    expect(
      decide({
        status: 'reserved',
        transitions: t(
          'transition/request-payment',
          'transition/confirm-payment',
          'transition/operator-accept'
        ),
      })
    ).toBe('pay');
  });

  it.each(['transition/expire-payment', 'transition/operator-decline', 'transition/expire'])(
    'a reserved use is released when the booking ended in %s',
    last => {
      expect(
        decide({ status: 'reserved', transitions: t('transition/request-payment', last) })
      ).toBe('release');
    }
  );

  it('a reserved use stays reserved while payment is pending or the booking is being made', () => {
    expect(decide({ status: 'reserved', transitions: t('transition/request-payment') })).toBe(
      'keep'
    );
    expect(
      decide({
        status: 'reserved',
        transitions: t('transition/request-payment', 'transition/confirm-payment'),
      })
    ).toBe('keep');
  });

  it('a paid use is released when the client is refunded in full', () => {
    expect(
      decide({ status: 'paid', transitions: t('transition/operator-accept', 'transition/cancel') })
    ).toBe('release');
  });

  it('a paid use stays used after a late cancellation, a payout or a reschedule', () => {
    [
      'transition/late-cancel',
      'transition/complete-late-cancelled',
      'transition/complete',
      'transition/update-booking',
    ].forEach(last =>
      expect(decide({ status: 'paid', transitions: t('transition/operator-accept', last) })).toBe(
        'keep'
      )
    );
  });

  it('leaves a released use alone', () => {
    expect(decide({ status: 'released', transitions: t('transition/cancel') })).toBe('keep');
  });
});

describe('the reconcile loop', () => {
  const NOW = Date.parse('2026-12-01T12:00:00Z');
  const load = ({ rows, transactions = {} }) => {
    jest.resetModules();
    const store = {
      findOpenRedemptions: jest.fn(async () => rows),
      markPaid: jest.fn(async () => true),
      release: jest.fn(async () => true),
      touchChecked: jest.fn(async () => {}),
    };
    jest.doMock('./store', () => store);
    jest.doMock('../nylas/db', () => ({ isAvailable: () => true }));
    jest.doMock('../../log', () => ({ error: jest.fn() }));
    jest.doMock('../nylas/integration', () => ({
      getIntegrationSdk: () => ({
        transactions: {
          show: async ({ id }) => {
            const found = transactions[id];
            if (found instanceof Error) throw found;
            return { data: { data: { attributes: { transitions: found } } } };
          },
        },
      }),
    }));
    return { store, run: require('./reconcile').runPromoReconcile };
  };
  const reserved = (id, tx, ageMs = 0) => ({
    id,
    status: 'reserved',
    transaction_id: tx,
    created_at: new Date(NOW - ageMs),
  });

  it('marks accepted bookings paid and releases expired ones', async () => {
    const { store, run } = load({
      rows: [reserved(1, 'a'), reserved(2, 'b')],
      transactions: {
        a: t('transition/confirm-payment', 'transition/operator-accept'),
        b: t('transition/request-payment', 'transition/expire-payment'),
      },
    });
    const summary = await run({ now: NOW });
    expect(store.markPaid).toHaveBeenCalledWith(1);
    expect(store.release).toHaveBeenCalledWith(2);
    expect(summary).toMatchObject({ checked: 2, paid: 1, released: 1, failed: 0 });
  });

  it('releases a reservation whose booking was never created, but only after 30 minutes', async () => {
    const young = load({ rows: [reserved(1, null, 5 * 60 * 1000)] });
    await young.run({ now: NOW });
    expect(young.store.release).not.toHaveBeenCalled();

    const old = load({ rows: [reserved(2, null, 31 * 60 * 1000)] });
    await old.run({ now: NOW });
    expect(old.store.release).toHaveBeenCalledWith(2);
  });

  it('releases a paid use when the client was refunded in full, and keeps a late-cancelled one', async () => {
    const paid = id => ({
      id,
      status: 'paid',
      transaction_id: `tx${id}`,
      created_at: new Date(NOW),
    });
    const { store, run } = load({
      rows: [paid(1), paid(2)],
      transactions: {
        tx1: t('transition/operator-accept', 'transition/cancel'),
        tx2: t('transition/operator-accept', 'transition/late-cancel'),
      },
    });
    await run({ now: NOW });
    expect(store.release).toHaveBeenCalledWith(1);
    expect(store.release).not.toHaveBeenCalledWith(2);
    expect(store.touchChecked).toHaveBeenCalledWith(2);
  });

  it('one booking failing to load does not stop the others', async () => {
    const boom = Object.assign(new Error('500'), { status: 500 });
    const { store, run } = load({
      rows: [reserved(1, 'bad'), reserved(2, 'good')],
      transactions: {
        bad: boom,
        good: t('transition/confirm-payment', 'transition/operator-accept'),
      },
    });
    const summary = await run({ now: NOW });
    expect(summary.failed).toBe(1);
    expect(store.markPaid).toHaveBeenCalledWith(2);
  });

  it('releases a reserved use whose booking no longer exists', async () => {
    const gone = Object.assign(new Error('404'), { status: 404 });
    const { store, run } = load({ rows: [reserved(1, 'gone')], transactions: { gone } });
    await run({ now: NOW });
    expect(store.release).toHaveBeenCalledWith(1);
  });
});
