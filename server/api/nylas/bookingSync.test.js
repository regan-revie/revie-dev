jest.mock('../../log', () => ({ error: jest.fn() }));
jest.mock('./db', () => ({
  isAvailable: jest.fn(() => true),
  recordBooking: jest.fn(async () => ({})),
  findByBookingId: jest.fn(async () => null),
  setStatus: jest.fn(async () => ({})),
  recordBookingEvent: jest.fn(async () => ({})),
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

jest.mock('./sessionEmails', () => ({
  safeScheduleReminders: jest.fn(async () => ({})),
  safeRescheduleEmails: jest.fn(async () => ({})),
  safeCancelBookingEmails: jest.fn(async () => 0),
}));
jest.mock('./bookingTimeSync', () => ({ applyBookingTime: jest.fn() }));
jest.mock('./bookingRecovery', () => ({
  cancelIfDeclined: jest.fn(async () => false),
}));

const log = require('../../log');
const db = require('./db');
const {
  applyTransition,
  getTransactionBasics,
  updateTransactionMetadata,
} = require('./integration');
const { cancelIfDeclined } = require('./bookingRecovery');
const { applyBookingTime } = require('./bookingTimeSync');
const {
  safeScheduleReminders,
  safeRescheduleEmails,
  safeCancelBookingEmails,
} = require('./sessionEmails');
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
  applyBookingTime.mockResolvedValue({ outcome: 'updated' });
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

describe('booking.rescheduled, inside 48 hours of the session (a coach moving the event)', () => {
  const HOUR = 3600000;
  const oldStart = new Date(Date.now() + 10 * HOUR); // 10 hours away: a client could not move this
  const newSeconds = Math.floor((Date.now() + 100 * HOUR) / 1000);
  const rescheduled = {
    trigger: 'booking.rescheduled',
    grantId: 'g1',
    data: {
      booking_id: BOOKING,
      booking_info: { start_time: newSeconds, end_time: newSeconds + 3600 },
    },
  };
  const row = (status = 'created') => ({
    sharetribe_transaction_id: TX,
    nylas_grant_id: 'g1',
    booking_start: oldStart,
    booking_end: new Date(oldStart.getTime() + HOUR),
    status,
  });

  it('is applied as before: the coach is not limited, the new time is recorded and the emails go out', async () => {
    db.findByBookingId.mockResolvedValue(row());
    const result = await handleBookingWebhook(rescheduled);
    expect(result.action).toBe('rescheduled');
    expect(db.recordBooking).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rescheduled' })
    );
    expect(safeRescheduleEmails).toHaveBeenCalledTimes(1);
  });

  it('leaves a note on the transaction for the Activity list: the new times and when, nothing about who', async () => {
    db.findByBookingId.mockResolvedValue(row());
    await handleBookingWebhook(rescheduled);
    const call = updateTransactionMetadata.mock.calls.find(c => c[1].reschedules);
    expect(call[0]).toBe(TX);
    expect(call[1].reschedules).toHaveLength(1);
    expect(call[1].reschedules[0]).toEqual({
      at: expect.any(String),
      fromStart: oldStart.toISOString(),
      toStart: new Date(newSeconds * 1000).toISOString(),
      toEnd: new Date((newSeconds + 3600) * 1000).toISOString(),
    });
  });

  it('adds to earlier notes, and does not add the same move twice when the webhook is redelivered', async () => {
    db.findByBookingId.mockResolvedValue(row());
    const earlier = { at: 'x', fromStart: 'a', toStart: 'b', toEnd: 'c' };
    getTransactionBasics.mockResolvedValue({
      metadata: { reschedules: [earlier] },
      lastTransition: 'transition/operator-accept',
    });
    await handleBookingWebhook(rescheduled);
    const written = updateTransactionMetadata.mock.calls.find(c => c[1].reschedules)[1].reschedules;
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual(earlier);

    updateTransactionMetadata.mockClear();
    getTransactionBasics.mockResolvedValue({
      metadata: { reschedules: written },
      lastTransition: 'transition/operator-accept',
    });
    await handleBookingWebhook(rescheduled);
    expect(updateTransactionMetadata.mock.calls.find(c => c[1].reschedules)).toBeUndefined();
  });

  it('never fails the webhook because the note could not be written', async () => {
    db.findByBookingId.mockResolvedValue(row());
    updateTransactionMetadata.mockResolvedValue({ ok: false, error: new Error('sharetribe down') });
    const result = await handleBookingWebhook(rescheduled);
    expect(result.action).toBe('rescheduled');
    expect(log.error.mock.calls.some(c => c[1] === 'nylas-reschedule-note-failed')).toBe(true);
  });

  it("moves Sharetribe's booking to the new time after Nylas's, last, with the same times", async () => {
    db.findByBookingId.mockResolvedValue(row());
    await handleBookingWebhook(rescheduled);
    expect(applyBookingTime).toHaveBeenCalledWith({
      transactionId: TX,
      bookingId: BOOKING,
      start: new Date(newSeconds * 1000),
      end: new Date((newSeconds + 3600) * 1000),
    });
    // Our row and the emails come first, so a failure of the Sharetribe step repeats only safe work.
    expect(db.recordBooking.mock.invocationCallOrder[0]).toBeLessThan(
      applyBookingTime.mock.invocationCallOrder[0]
    );
    expect(safeRescheduleEmails.mock.invocationCallOrder[0]).toBeLessThan(
      applyBookingTime.mock.invocationCallOrder[0]
    );
  });

  it('fails the webhook (so Nylas delivers it again) when the Sharetribe update fails', async () => {
    db.findByBookingId.mockResolvedValue(row());
    applyBookingTime.mockRejectedValue(new Error('sharetribe down'));
    await expect(handleBookingWebhook(rescheduled)).rejects.toThrow('sharetribe down');
  });

  it("does not touch Sharetribe's booking for a booking that was cancelled in the meantime", async () => {
    db.findByBookingId.mockResolvedValue(row('cancelled'));
    await handleBookingWebhook(rescheduled);
    expect(applyBookingTime).not.toHaveBeenCalled();
  });

  it('writes no note for a booking that was cancelled in the meantime', async () => {
    db.findByBookingId.mockResolvedValue(row('cancelled'));
    await handleBookingWebhook(rescheduled);
    expect(updateTransactionMetadata.mock.calls.find(c => c[1].reschedules)).toBeUndefined();
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
  const paid = (amount, currency = 'USD') => ({ amount, currency });

  describe('the amount the cancellation email shows', () => {
    const basics = (metadata, payinTotal) =>
      getTransactionBasics.mockResolvedValue({
        metadata,
        lastTransition: 'transition/operator-accept',
        payinTotal,
      });

    it('is written, in major units, with who cancelled, BEFORE the refund runs (the email is rendered by the transition)', async () => {
      mapping(72);
      basics({}, paid(5000));
      await handleBookingWebhook(cancelled);

      expect(updateTransactionMetadata).toHaveBeenCalledWith(TX, {
        cancelledBy: 'provider',
        refundAmount: 50,
        refundCurrency: 'USD',
      });
      expect(updateTransactionMetadata.mock.invocationCallOrder[0]).toBeLessThan(
        applyTransition.mock.invocationCallOrder[0]
      );
    });

    it('is the same for a client cancelling more than 48 hours ahead', async () => {
      mapping(72);
      basics(clientNote, paid(5000));
      await handleBookingWebhook(cancelled);
      expect(updateTransactionMetadata).toHaveBeenCalledWith(TX, {
        cancelledBy: 'client',
        refundAmount: 50,
        refundCurrency: 'USD',
      });
    });

    it("uses the currency's own decimals (a zero-decimal currency is not divided by 100)", async () => {
      mapping(72);
      basics({}, paid(5000, 'JPY'));
      await handleBookingWebhook(cancelled);
      expect(updateTransactionMetadata).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({ refundAmount: 5000, refundCurrency: 'JPY' })
      );
    });

    it('is not overwritten by a redelivery that arrives after the refund, when the total reads zero', async () => {
      mapping(72);
      getTransactionBasics.mockResolvedValue({
        metadata: { cancelledBy: 'provider', refundAmount: 50, refundCurrency: 'USD' },
        lastTransition: 'transition/cancel',
        payinTotal: paid(0),
      });
      applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
      const result = await handleBookingWebhook(cancelled);

      expect(updateTransactionMetadata).not.toHaveBeenCalled();
      expect(result.action).toBe('already-cancelled');
      expect(log.error).not.toHaveBeenCalled();
    });

    it.each([
      ['after the payout', 'transition/complete'],
      ['still accepted (the refund did not happen)', 'transition/operator-accept'],
    ])(
      'is reported to Sentry as nylas-cancel-refused when Sharetribe refuses the cancel and the transaction is %s',
      async (_, lastTransition) => {
        mapping(72);
        basics({}, paid(5000));
        applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
        getTransactionBasics.mockResolvedValue({ metadata: {}, lastTransition });
        const result = await handleBookingWebhook(cancelled);

        expect(result).toEqual({ handled: true, action: 'cancel-refused' });
        expect(log.error).toHaveBeenCalledTimes(1);
        const [error, code, data] = log.error.mock.calls[0];
        expect(code).toBe('nylas-cancel-refused');
        expect(error.message).toContain(TX);
        expect(data).toMatchObject({ transactionId: TX, bookingId: BOOKING, lastTransition });
      }
    );

    it('is reported too when the transaction cannot be read to check', async () => {
      mapping(72);
      applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
      getTransactionBasics.mockResolvedValueOnce({ metadata: {}, lastTransition: 'x' });
      getTransactionBasics.mockRejectedValueOnce(new Error('sharetribe down'));
      const result = await handleBookingWebhook(cancelled);
      expect(result.action).toBe('cancel-refused');
      expect(log.error.mock.calls[0][1]).toBe('nylas-cancel-refused');
    });

    it('writes no amount when there is nothing to refund, rather than a zero', async () => {
      mapping(72);
      basics({}, paid(0));
      await handleBookingWebhook(cancelled);
      expect(updateTransactionMetadata).toHaveBeenCalledWith(TX, { cancelledBy: 'provider' });
    });

    it('is not written for a late cancellation, which is not refunded', async () => {
      mapping(12);
      basics(clientNote, paid(5000));
      await handleBookingWebhook(cancelled);
      const written = updateTransactionMetadata.mock.calls.map(c => c[1]);
      written.forEach(fields => expect(fields.refundAmount).toBeUndefined());
    });
  });

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

  it('throws rather than guessing when a client cancelled and there is no start time', async () => {
    // Without it there is no way to tell a free cancellation from a chargeable one.
    db.findByBookingId.mockResolvedValue({ sharetribe_transaction_id: TX, booking_start: null });
    tx(clientNote);
    await expect(handleBookingWebhook(cancelled)).rejects.toThrow(/no booking start time/);
  });

  it('refunds a coach cancellation even with no start time on record: it never needs one', async () => {
    db.findByBookingId.mockResolvedValue({ sharetribe_transaction_id: TX, booking_start: null });
    const result = await handleBookingWebhook(cancelled);
    expect(applyTransition).toHaveBeenCalledWith(TX, 'transition/cancel');
    expect(result.action).toBe('refunded');
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

describe('the calendar event id in a booking notice', () => {
  const noticeWith = (trigger, eventId) => ({
    trigger,
    grantId: 'g1',
    data: {
      booking_id: BOOKING,
      booking_info: {
        event_id: eventId,
        additional_fields: { [TRANSACTION_FIELD]: TX },
      },
    },
  });

  it("is stored as soon as a booking is confirmed, marked as coming from Nylas, under the notice's grant", async () => {
    await handleBookingWebhook(noticeWith('booking.created', 'ev-real'));
    expect(db.recordBookingEvent).toHaveBeenCalledWith({
      nylasBookingId: BOOKING,
      nylasEventId: 'ev-real',
      nylasGrantId: 'g1',
      verified: true,
    });
  });

  it('is stored again when a booking is rescheduled', async () => {
    db.findByBookingId.mockResolvedValue({
      sharetribe_transaction_id: TX,
      nylas_grant_id: 'g1',
      booking_start: new Date(),
      booking_end: new Date(),
      status: 'created',
    });
    await handleBookingWebhook(noticeWith('booking.rescheduled', 'ev-moved'));
    expect(db.recordBookingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ nylasEventId: 'ev-moved', verified: true })
    );
  });

  it('is simply skipped when the notice carries none, and a failure to store it never breaks the booking', async () => {
    await handleBookingWebhook(noticeWith('booking.created', undefined));
    expect(db.recordBookingEvent).not.toHaveBeenCalled();

    db.recordBookingEvent.mockRejectedValueOnce(new Error('db down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handleBookingWebhook(noticeWith('booking.created', 'ev-real'));
    expect(result.action).toBe('accepted');
    spy.mockRestore();
  });
});

describe('session emails (Postmark)', () => {
  const startSeconds = Math.floor(Date.parse('2026-12-01T15:00:00Z') / 1000);
  const created = {
    trigger: 'booking.created',
    grantId: 'g1',
    data: {
      booking_id: BOOKING,
      booking_info: {
        start_time: startSeconds,
        end_time: startSeconds + 3600,
        additional_fields: { [TRANSACTION_FIELD]: TX },
      },
    },
  };

  it('queues the reminders once a booking is confirmed, from the real session time', async () => {
    await handleBookingWebhook(created);
    expect(safeScheduleReminders).toHaveBeenCalledTimes(1);
    const { bookingId, sessionStart } = safeScheduleReminders.mock.calls[0][0];
    expect(bookingId).toBe(BOOKING);
    expect(new Date(sessionStart).toISOString()).toBe('2026-12-01T15:00:00.000Z');
  });

  it('asks again on a redelivery (the reminders are keyed, so this changes nothing) but not for an orphaned booking', async () => {
    applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
    cancelIfDeclined.mockResolvedValue(false);
    await handleBookingWebhook(created);
    expect(safeScheduleReminders).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    applyTransition.mockResolvedValue({ ok: false, alreadyApplied: true });
    cancelIfDeclined.mockResolvedValue(true);
    await handleBookingWebhook(created);
    expect(safeScheduleReminders).not.toHaveBeenCalled();
  });

  it('queues nothing for a booking that is only pending, or that could not be confirmed', async () => {
    await handleBookingWebhook({ ...created, trigger: 'booking.pending' });
    expect(safeScheduleReminders).not.toHaveBeenCalled();

    applyTransition.mockResolvedValue({ ok: false, error: new Error('stripe down') });
    await expect(handleBookingWebhook(created)).rejects.toThrow('stripe down');
    expect(safeScheduleReminders).not.toHaveBeenCalled();
  });

  describe('a reschedule', () => {
    const oldStart = new Date('2026-12-01T15:00:00Z');
    const newSeconds = Math.floor(Date.parse('2026-12-03T10:00:00Z') / 1000);
    const rescheduled = {
      trigger: 'booking.rescheduled',
      grantId: 'g1',
      data: {
        booking_id: BOOKING,
        booking_info: {
          start_time: newSeconds,
          end_time: newSeconds + 3600,
          old_start_time: Math.floor(oldStart.getTime() / 1000),
          old_end_time: Math.floor(oldStart.getTime() / 1000) + 3600,
        },
      },
    };
    const row = (status = 'created') => ({
      sharetribe_transaction_id: TX,
      nylas_grant_id: 'g1',
      booking_start: oldStart,
      booking_end: new Date(oldStart.getTime() + 3600000),
      status,
    });

    it('moves the reminders and confirms the change, with the old time from the notice', async () => {
      db.findByBookingId.mockResolvedValue(row());
      const result = await handleBookingWebhook(rescheduled);

      expect(result.action).toBe('rescheduled');
      expect(safeRescheduleEmails).toHaveBeenCalledTimes(1);
      const args = safeRescheduleEmails.mock.calls[0][0];
      expect(args.bookingId).toBe(BOOKING);
      expect(new Date(args.oldStart).toISOString()).toBe('2026-12-01T15:00:00.000Z');
      expect(new Date(args.newStart).toISOString()).toBe('2026-12-03T10:00:00.000Z');
      expect(new Date(args.newEnd).toISOString()).toBe('2026-12-03T11:00:00.000Z');
    });

    it('uses our own row for the old time when the notice does not say', async () => {
      db.findByBookingId.mockResolvedValue(row());
      const bare = {
        ...rescheduled,
        data: {
          booking_id: BOOKING,
          booking_info: { start_time: newSeconds, end_time: newSeconds + 3600 },
        },
      };
      await handleBookingWebhook(bare);
      expect(new Date(safeRescheduleEmails.mock.calls[0][0].oldStart).toISOString()).toBe(
        '2026-12-01T15:00:00.000Z'
      );
    });

    it('sends nothing for a booking that was cancelled in the meantime', async () => {
      db.findByBookingId.mockResolvedValue(row('cancelled'));
      await handleBookingWebhook(rescheduled);
      expect(safeRescheduleEmails).not.toHaveBeenCalled();
      expect(db.recordBooking).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled' })
      );
    });
  });

  describe('a cancellation', () => {
    it('cancels the pending reminders, whichever way the booking was cancelled', async () => {
      db.findByBookingId.mockResolvedValue({
        sharetribe_transaction_id: TX,
        booking_start: new Date(Date.now() + 72 * 3600000),
      });
      await handleBookingWebhook({
        trigger: 'booking.cancelled',
        grantId: 'g1',
        data: { booking_id: BOOKING },
      });
      expect(safeCancelBookingEmails).toHaveBeenCalledWith(BOOKING);
    });
  });
});
