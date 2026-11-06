jest.mock('./db', () => ({
  isAvailable: jest.fn(() => true),
  recordBooking: jest.fn(async () => ({})),
  findByBookingId: jest.fn(async () => null),
  setStatus: jest.fn(async () => ({})),
}));
jest.mock('./integration', () => ({
  isConfigured: jest.fn(() => true),
  applyTransition: jest.fn(async () => ({ ok: true, transaction: {} })),
  getTransactionBasics: jest.fn(async () => ({
    metadata: {},
    lastTransition: 'transition/operator-accept',
  })),
  updateTransactionMetadata: jest.fn(async () => ({ ok: true })),
}));

jest.mock('./bookingRecovery', () => ({
  cancelIfDeclined: jest.fn(async () => false),
}));

const db = require('./db');
const {
  applyTransition,
  getTransactionBasics,
  updateTransactionMetadata,
} = require('./integration');
const { cancelIfDeclined } = require('./bookingRecovery');
const {
  TRANSACTION_FIELD,
  extractTransactionId,
  extractBookingStart,
  handleBookingWebhook,
} = require('./bookingSync');

const TX = 'tx-abc';
const BOOKING = 'bk-1';

beforeEach(() => {
  jest.clearAllMocks();
  db.isAvailable.mockReturnValue(true);
  require('./integration').isConfigured.mockReturnValue(true);
  applyTransition.mockResolvedValue({ ok: true, transaction: {} });
  getTransactionBasics.mockResolvedValue({
    metadata: {},
    lastTransition: 'transition/operator-accept',
  });
  updateTransactionMetadata.mockResolvedValue({ ok: true });
  cancelIfDeclined.mockResolvedValue(false);
});

describe('extractTransactionId()', () => {
  it('reads the confirmed shape: nested under booking_info', () => {
    // Confirmed against Nylas's own mock-payload endpoint and a real webhook delivery - the
    // top-level customFields/custom_fields shapes below were the pre-launch best guess and are
    // kept only as a fallback.
    expect(
      extractTransactionId({ booking_info: { additional_fields: { [TRANSACTION_FIELD]: TX } } })
    ).toBe(TX);
  });

  it('reads the array-of-pairs shape', () => {
    expect(extractTransactionId({ customFields: [{ name: TRANSACTION_FIELD, value: TX }] })).toBe(
      TX
    );
  });

  it('reads the plain-object shape', () => {
    expect(extractTransactionId({ customFields: { [TRANSACTION_FIELD]: TX } })).toBe(TX);
  });

  it('reads the snake_case key Nylas sometimes uses', () => {
    // Their docs and forum posts disagree on this, so both are accepted rather than guessed.
    expect(extractTransactionId({ custom_fields: { [TRANSACTION_FIELD]: TX } })).toBe(TX);
  });

  it('returns null when absent rather than undefined', () => {
    expect(extractTransactionId({})).toBeNull();
    expect(extractTransactionId({ customFields: [{ name: 'other', value: 'x' }] })).toBeNull();
  });
});

describe('extractBookingStart()', () => {
  it('reads the confirmed shape: nested under booking_info', () => {
    const seconds = 1780000000;
    expect(extractBookingStart({ booking_info: { start_time: seconds } }).getTime()).toBe(
      seconds * 1000
    );
  });

  it('treats a number as epoch SECONDS, not milliseconds', () => {
    // Getting this wrong puts the session fifty years out and makes every cancellation look free.
    const seconds = 1780000000;
    expect(extractBookingStart({ start_time: seconds }).getTime()).toBe(seconds * 1000);
  });

  it('accepts an ISO string', () => {
    expect(extractBookingStart({ start: '2026-06-01T12:00:00Z' }).toISOString()).toBe(
      '2026-06-01T12:00:00.000Z'
    );
  });

  it('returns null for missing or unparseable values', () => {
    expect(extractBookingStart({})).toBeNull();
    expect(extractBookingStart({ start: 'nonsense' })).toBeNull();
  });
});

describe('booking.created', () => {
  const created = {
    trigger: 'booking.created',
    grantId: 'g1',
    data: {
      booking_id: BOOKING,
      start_time: 1780000000,
      customFields: { [TRANSACTION_FIELD]: TX },
    },
  };

  it('records the mapping and confirms the transaction', async () => {
    const result = await handleBookingWebhook(created);
    expect(db.recordBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        nylasBookingId: BOOKING,
        sharetribeTransactionId: TX,
        nylasGrantId: 'g1',
        status: 'created',
      })
    );
    expect(applyTransition).toHaveBeenCalledWith(TX, 'transition/operator-accept');
    expect(result).toEqual({ handled: true, action: 'accepted' });
  });

  it('does nothing for a booking made outside Revie checkout', async () => {
    // The Nylas scheduling page is publicly reachable, so a booking can arrive with no transaction
    // and no payment behind it. There is nothing to confirm.
    const result = await handleBookingWebhook({ ...created, data: { booking_id: BOOKING } });
    expect(applyTransition).not.toHaveBeenCalled();
    expect(result).toEqual({ handled: false, reason: 'no-transaction-id' });
  });

  it('treats an already-applied transition as success, not failure', async () => {
    // Nylas redelivers webhooks; Sharetribe rejects a transition it has already made.
    applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
    await expect(handleBookingWebhook(created)).resolves.toEqual({
      handled: true,
      action: 'already-accepted',
    });
  });

  it('cancels the Nylas booking when the transaction was already declined (late webhook)', async () => {
    // bookingRecovery declined the transaction while the booking was in flight; the booking then
    // landed. A real booking is on the coach's calendar for a session that will not happen.
    applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
    cancelIfDeclined.mockResolvedValue(true);
    await expect(handleBookingWebhook(created)).resolves.toEqual({
      handled: true,
      action: 'orphan-cancelled',
    });
    expect(cancelIfDeclined).toHaveBeenCalledWith({ transactionId: TX, bookingId: BOOKING });
  });

  it('throws on a real transition failure so Nylas retries', async () => {
    applyTransition.mockResolvedValue({ ok: false, error: new Error('boom') });
    await expect(handleBookingWebhook(created)).rejects.toThrow('boom');
  });

  it('refuses to act with no database', async () => {
    db.isAvailable.mockReturnValue(false);
    await expect(handleBookingWebhook(created)).resolves.toEqual({
      handled: false,
      reason: 'no-database',
    });
  });
});

describe('booking.cancelled', () => {
  const cancelled = { trigger: 'booking.cancelled', grantId: 'g1', data: { booking_id: BOOKING } };
  const startingIn = hours => new Date(Date.now() + hours * 3600000);
  const mapping = hours =>
    db.findByBookingId.mockResolvedValue({
      sharetribe_transaction_id: TX,
      booking_start: startingIn(hours),
    });
  const tx = (metadata, lastTransition = 'transition/operator-accept') =>
    getTransactionBasics.mockResolvedValue({ metadata, lastTransition });
  const clientNote = { cancelRequestedBy: 'customer' };

  describe('by the coach (no client note)', () => {
    it('refunds the client more than 48 hours out and records the coach as the canceller', async () => {
      mapping(72);
      const result = await handleBookingWebhook(cancelled);
      expect(applyTransition).toHaveBeenCalledWith(TX, 'transition/cancel');
      expect(updateTransactionMetadata).toHaveBeenCalledWith(TX, { cancelledBy: 'provider' });
      expect(result).toEqual({ handled: true, action: 'refunded' });
    });

    it('refunds the client just as fully inside 48 hours - a coach cancellation is never charged', async () => {
      mapping(2);
      const result = await handleBookingWebhook(cancelled);
      expect(applyTransition).toHaveBeenCalledWith(TX, 'transition/cancel');
      expect(applyTransition).not.toHaveBeenCalledWith(TX, 'transition/late-cancel');
      expect(updateTransactionMetadata).toHaveBeenCalledWith(TX, { cancelledBy: 'provider' });
      expect(result.action).toBe('refunded');
    });
  });

  describe('by the client', () => {
    it('refunds a cancellation more than 48 hours out and notes the client', async () => {
      mapping(72);
      tx(clientNote);
      const result = await handleBookingWebhook(cancelled);
      expect(applyTransition).toHaveBeenCalledWith(TX, 'transition/cancel');
      expect(updateTransactionMetadata).toHaveBeenCalledWith(TX, { cancelledBy: 'client' });
      expect(result).toEqual({ handled: true, action: 'refunded' });
    });

    it('runs transition/late-cancel inside 48 hours and never the refunding cancel', async () => {
      mapping(12);
      tx(clientNote);
      const result = await handleBookingWebhook(cancelled);
      expect(applyTransition).toHaveBeenCalledTimes(1);
      expect(applyTransition).toHaveBeenCalledWith(TX, 'transition/late-cancel');
      expect(updateTransactionMetadata).toHaveBeenCalledWith(TX, {
        cancelledBy: 'client',
        lateCancelledAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      expect(result).toEqual({ handled: true, action: 'charged-late-cancellation' });
    });

    it('on a release-3 transaction (409, still accepted) changes nothing in Sharetribe but records it in metadata', async () => {
      mapping(12);
      tx(clientNote, 'transition/operator-accept');
      applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
      await handleBookingWebhook(cancelled);
      expect(applyTransition).toHaveBeenCalledTimes(1);
      expect(updateTransactionMetadata).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({
          cancelledBy: 'client',
          lateCancelledAt: expect.any(String),
        })
      );
    });

    it('does not move the timestamp when the webhook is delivered again', async () => {
      mapping(12);
      tx(
        { ...clientNote, cancelledBy: 'client', lateCancelledAt: '2026-11-05T23:49:33.000Z' },
        'transition/late-cancel'
      );
      applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
      await handleBookingWebhook(cancelled);
      expect(updateTransactionMetadata).not.toHaveBeenCalled();
    });

    it('leaves a transaction alone that something else has already moved on', async () => {
      mapping(12);
      tx(clientNote, 'transition/cancel');
      applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
      await handleBookingWebhook(cancelled);
      expect(updateTransactionMetadata).not.toHaveBeenCalled();
    });

    it('fails the webhook if the metadata cannot be written, so Nylas delivers it again', async () => {
      mapping(12);
      tx(clientNote);
      updateTransactionMetadata.mockResolvedValue({ ok: false, error: new Error('boom') });
      await expect(handleBookingWebhook(cancelled)).rejects.toThrow('boom');
    });

    it('fails the webhook when late-cancel itself fails for a real reason', async () => {
      mapping(12);
      tx(clientNote);
      applyTransition.mockResolvedValue({ ok: false, error: new Error('stripe down') });
      await expect(handleBookingWebhook(cancelled)).rejects.toThrow('stripe down');
    });
  });

  it('always marks the booking cancelled, whichever side of the window', async () => {
    mapping(12);
    await handleBookingWebhook(cancelled);
    expect(db.setStatus).toHaveBeenCalledWith(BOOKING, 'cancelled');
  });

  it('does nothing for a booking it has never seen', async () => {
    db.findByBookingId.mockResolvedValue(null);
    await expect(handleBookingWebhook(cancelled)).resolves.toEqual({
      handled: false,
      reason: 'unknown-booking',
    });
  });

  it('throws rather than guessing when there is no start time', async () => {
    // Without it there is no way to tell a free cancellation from a chargeable one.
    db.findByBookingId.mockResolvedValue({ sharetribe_transaction_id: TX, booking_start: null });
    await expect(handleBookingWebhook(cancelled)).rejects.toThrow(/no booking start time/);
  });
});

describe('booking.rescheduled', () => {
  const rescheduled = {
    trigger: 'booking.rescheduled',
    grantId: 'g1',
    data: {
      booking_id: BOOKING,
      booking_info: { start_time: 1790000000, end_time: 1790003600 },
    },
  };

  it('updates the stored time and status, without touching Sharetribe', async () => {
    db.findByBookingId.mockResolvedValue({
      sharetribe_transaction_id: TX,
      nylas_grant_id: 'g1',
      booking_start: new Date('2026-06-01T12:00:00Z'),
      booking_end: new Date('2026-06-01T13:00:00Z'),
    });
    const result = await handleBookingWebhook(rescheduled);
    expect(db.recordBooking).toHaveBeenCalledWith({
      nylasBookingId: BOOKING,
      sharetribeTransactionId: TX,
      nylasGrantId: 'g1',
      bookingStart: new Date(1790000000 * 1000),
      bookingEnd: new Date(1790003600 * 1000),
      status: 'rescheduled',
    });
    expect(applyTransition).not.toHaveBeenCalled();
    expect(result).toEqual({ handled: true, action: 'rescheduled' });
  });

  it('falls back to the previously stored time if the payload carries none', async () => {
    const existingStart = new Date('2026-06-01T12:00:00Z');
    const existingEnd = new Date('2026-06-01T13:00:00Z');
    db.findByBookingId.mockResolvedValue({
      sharetribe_transaction_id: TX,
      nylas_grant_id: 'g1',
      booking_start: existingStart,
      booking_end: existingEnd,
    });
    await handleBookingWebhook({ ...rescheduled, data: { booking_id: BOOKING } });
    expect(db.recordBooking).toHaveBeenCalledWith(
      expect.objectContaining({ bookingStart: existingStart, bookingEnd: existingEnd })
    );
  });

  it('does nothing for a booking it has never seen', async () => {
    db.findByBookingId.mockResolvedValue(null);
    await expect(handleBookingWebhook(rescheduled)).resolves.toEqual({
      handled: false,
      reason: 'unknown-booking',
    });
    expect(db.recordBooking).not.toHaveBeenCalled();
  });
});
