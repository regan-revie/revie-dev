/**
 * The client's "You're booked" email, session reminders and reschedule confirmations, sent through
 * Postmark.
 *
 * Everything is a row in Postgres (`session_emails`), never a timer in memory, and the existing
 * sweeper tick (server/jobs/) sends what is due, so a restart or a second worker cannot lose or
 * double an email.
 *
 *  - "You're booked" goes to the client once per booking, as soon as the booking is confirmed and
 *    its Google Meet link exists (up to ten minutes' wait, then it goes without), with a calendar
 *    file attached. It is sent any time until the session starts; one that could not be sent by then
 *    is reported. (The coach's booked email is still Sharetribe's.)
 *  - A reminder goes to the client and to the coach 24 hours before a confirmed session. A booking
 *    made less than 24 hours ahead gets none, and the client's is skipped when their "You're booked"
 *    went out less than two hours before it was due.
 *  - Moving the session cancels its pending reminders and queues new ones from the new time, and
 *    sends both people a confirmation of the change (the client's carries the moved calendar file).
 *  - Cancelling it, from any side and by any route (our button, the Scheduler, the coach deleting
 *    the calendar event and the five-minute wait ending), cancels everything still pending.
 *
 * Each email has a key made of what it is, the booking, the recipient and the session time it was
 * for, so asking for the same one twice does nothing. Claiming marks a row `sending` before anything
 * is sent and nothing ever picks a `sending` row up again, so an email is sent at most once: if a
 * worker dies mid-send, that one is not repeated (and is visible in the table as stuck `sending`).
 * A send that fails cleanly is put back and tried on the next tick, three tries in all.
 *
 * Sending is off unless POSTMARK_SENDING_ENABLED=true (server/email/postmark.js). Scheduling goes on
 * regardless, so switching it on later finds the reminders ready. Logs carry ids and the recipient's
 * domain, never a body or an address.
 */

const log = require('../../log');
const db = require('./db');
const integration = require('./integration');
const { nylasRequest } = require('./client');
const { lookupEventId } = require('./eventIdBackfill');
const postmark = require('../../email/postmark');
const { buildSessionEmailModel } = require('./sessionEmailModel');
const { TEMPLATE_ALIASES } = require('../../email/templates');
const { buildIcs, icsAttachment } = require('../../email/calendarFile');

const HOUR = 60 * 60 * 1000;
const REMINDER_LEAD_MS = 24 * HOUR;
// The client's earlier reminder, with the date and when it is free to cancel or move until.
const REMINDER_60H_LEAD_MS = 60 * HOUR;
// Transactions that mean the session is still on (not cancelled, declined, expired or refunded).
const LIVE_TRANSITIONS = ['transition/operator-accept', 'transition/update-booking'];
// Too close to the session for a reminder to still be a reminder.
const TOO_LATE_MS = 2 * HOUR;
// A reschedule confirmation that has waited this long (sending was off, or down) is no longer news.
const CONFIRMATION_STALE_MS = 6 * HOUR;
// How long "You're booked" waits for the Google Meet link, which Google creates a moment after the
// event. Past this it goes without one (a coach on another calendar will never have one).
const MEET_WAIT_MS = 10 * 60 * 1000;
const POSTPONE_SECONDS = 60;
// A reminder this soon after "You're booked" would only repeat it.
const CONFIRMATION_REMINDER_GAP_MS = 2 * HOUR;
// A "You're booked" still unsent this long after it was due is reported.
const OVERDUE_CONFIRMATION_MINUTES = 30;
// Bookings older than this are never given a "You're booked" by the catch-up.
const CONFIRMATION_BACKFILL_HOURS = 24;
const MAX_ATTEMPTS = 3;
const RECIPIENTS = ['client', 'coach'];
const ACTIVE = ['created', 'rescheduled'];

const iso = value => new Date(value).toISOString();

/** Anything that goes wrong scheduling is logged and swallowed: it must never break a booking. */
const safely = (label, fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (e) {
    console.error(`[postmark] Could not ${label}: ${e.message}`);
    return null;
  }
};

/**
 * Queue the 24-hour reminders for a session. Skipped if the session is less than 24 hours away.
 *
 * @returns {Promise<{queued: number, skipped?: string}>}
 */
const scheduleReminders = async ({ bookingId, sessionStart, now = Date.now() }) => {
  const start = new Date(sessionStart);
  if (!Number.isFinite(start.getTime())) return { queued: 0, skipped: 'no-start-time' };

  const sendAt = new Date(start.getTime() - REMINDER_LEAD_MS);
  if (sendAt.getTime() <= now) return { queued: 0, skipped: 'under-24h' };

  let queued = 0;
  for (const recipient of RECIPIENTS) {
    // eslint-disable-next-line no-await-in-loop
    const added = await db.queueSessionEmail({
      dedupeKey: `reminder:${bookingId}:${recipient}:${iso(start)}`,
      kind: 'reminder',
      nylasBookingId: bookingId,
      recipient,
      sendAt,
      sessionStart: start,
    });
    if (added) queued += 1;
  }
  return { queued };
};

const confirmationKey = bookingId => `confirmed:${bookingId}:client`;

/**
 * Queue the client's "You're booked": once per booking (the key has no time in it, so moving the
 * session never sends it again). Due at once; the sender waits for the Meet link.
 *
 * @returns {Promise<{queued: number}>}
 */
const queueConfirmation = async ({ bookingId, sessionStart, now = Date.now() }) => {
  const start = new Date(sessionStart);
  const added = await db.queueSessionEmail({
    dedupeKey: confirmationKey(bookingId),
    kind: 'confirmed',
    nylasBookingId: bookingId,
    recipient: 'client',
    sendAt: new Date(now),
    sessionStart: Number.isFinite(start.getTime()) ? start : null,
  });
  return { queued: added ? 1 : 0 };
};

/**
 * Queue the client's 60-hour reminder: once per booking and session time (the key carries the start,
 * so a move queues a fresh one). Not queued when the 60-hour mark has already passed, which is also
 * what leaves out a booking made inside 60 hours: its "You're booked" already says when it is free
 * to cancel or move until.
 *
 * @returns {Promise<{queued: number, skipped?: string}>}
 */
const schedule60hReminder = async ({ bookingId, sessionStart, now = Date.now() }) => {
  const start = new Date(sessionStart);
  if (!Number.isFinite(start.getTime())) return { queued: 0, skipped: 'no-start-time' };
  const sendAt = new Date(start.getTime() - REMINDER_60H_LEAD_MS);
  if (sendAt.getTime() <= now) return { queued: 0, skipped: 'under-60h' };
  const added = await db.queueSessionEmail({
    dedupeKey: `reminder60:${bookingId}:client:${iso(start)}`,
    kind: 'reminder60',
    nylasBookingId: bookingId,
    recipient: 'client',
    sendAt,
    sessionStart: start,
  });
  return { queued: added ? 1 : 0 };
};

/**
 * The session moved: drop the pending reminders, queue new ones from the new time, and queue a
 * confirmation to each person.
 */
const rescheduleEmails = async ({
  bookingId,
  oldStart,
  oldEnd,
  newStart,
  newEnd,
  now = Date.now(),
}) => {
  await db.cancelSessionEmails(bookingId, ['reminder', 'reminder60']);
  const reminders = await scheduleReminders({ bookingId, sessionStart: newStart, now });
  await schedule60hReminder({ bookingId, sessionStart: newStart, now });

  const start = new Date(newStart);
  const sameTime = oldStart && new Date(oldStart).getTime() === start.getTime();
  if (!Number.isFinite(start.getTime()) || !oldStart || sameTime) {
    return { reminders, confirmations: 0 };
  }

  // The calendar file of this move is one newer than the last, so an app updates the event it has.
  const sequence = (await db.countRescheduleEmails(bookingId)) + 1;

  let confirmations = 0;
  for (const recipient of RECIPIENTS) {
    // eslint-disable-next-line no-await-in-loop
    const added = await db.queueSessionEmail({
      dedupeKey: `rescheduled:${bookingId}:${recipient}:${iso(start)}`,
      kind: 'rescheduled',
      nylasBookingId: bookingId,
      recipient,
      sendAt: new Date(now),
      sessionStart: start,
      details: {
        oldStart: iso(oldStart),
        oldEnd: oldEnd ? iso(oldEnd) : null,
        newStart: iso(start),
        newEnd: newEnd ? iso(newEnd) : null,
        sequence,
      },
    });
    if (added) confirmations += 1;
  }
  return { reminders, confirmations };
};

/** The booking is cancelled (any way): nothing still pending should go out. */
const cancelBookingEmails = bookingId => db.cancelSessionEmails(bookingId);

/**
 * Queue reminders for confirmed upcoming sessions that never had any (booked before this existed, or
 * the webhook could not queue them). A few per tick.
 */
const backfillReminders = async ({ limit = 20, now = Date.now() } = {}) => {
  const rows = await db.findBookingsMissingReminders(24, limit);
  let queued = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const result = await scheduleReminders({
      bookingId: row.nylas_booking_id,
      sessionStart: row.booking_start,
      now,
    });
    queued += result.queued;
  }
  return { checked: rows.length, queued };
};

/**
 * Queue "You're booked" for confirmed recent bookings that never had one queued (the webhook died
 * between accepting and queueing). Each one is reported: it means the normal path failed.
 */
const backfillConfirmations = async ({ limit = 20, now = Date.now() } = {}) => {
  const rows = await db.findBookingsMissingConfirmation(CONFIRMATION_BACKFILL_HOURS, limit);
  let queued = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const result = await queueConfirmation({
      bookingId: row.nylas_booking_id,
      sessionStart: row.booking_start,
      now,
    });
    if (result.queued) {
      queued += 1;
      log.error(
        new Error('A confirmed booking had no "You\'re booked" email queued; queued it now'),
        'postmark-confirmation-not-queued',
        { bookingId: row.nylas_booking_id }
      );
    }
  }
  return { checked: rows.length, queued };
};

/**
 * "You're booked" emails still unsent well after they were due, reported once each. Only while
 * sending is on: with it off, nothing is expected to go out and a report per booking would be noise.
 */
const reportOverdueConfirmations = async () => {
  if (!db.isAvailable() || !postmark.isSendingEnabled() || !postmark.isConfigured()) return 0;
  const rows = await db.claimOverdueConfirmations(OVERDUE_CONFIRMATION_MINUTES);
  rows.forEach(row => {
    log.error(
      new Error(
        `A "You're booked" email has not gone out ${OVERDUE_CONFIRMATION_MINUTES} minutes after it was due`
      ),
      'postmark-confirmation-overdue',
      { bookingId: row.nylas_booking_id, status: row.status, attempts: row.attempts }
    );
  });
  return rows.length;
};

// --- sending -----------------------------------------------------------------------------------

/** The Google Meet link of the session's calendar event, or '' if there is none or it cannot be read. */
const meetLinkFor = async ({ bookingId, transactionId, grantId, calendarId }) => {
  try {
    // Only an id Nylas itself has given us is trusted. If there is none yet (the backfill has not
    // reached this booking), ask Nylas now and keep the answer, so the link does not depend on timing.
    let eventId = await db.findVerifiedEventIdForBooking(bookingId);
    if (!eventId && grantId) {
      eventId = await lookupEventId({
        nylas_booking_id: bookingId,
        sharetribe_transaction_id: transactionId,
      });
      await db.recordBookingEvent({
        nylasBookingId: bookingId,
        nylasEventId: eventId,
        nylasGrantId: grantId,
        verified: true,
      });
    }
    if (!eventId || !grantId || !calendarId) return '';
    const event = await nylasRequest(
      `/v3/grants/${encodeURIComponent(grantId)}/events/${encodeURIComponent(
        eventId
      )}?calendar_id=${encodeURIComponent(calendarId)}`
    );
    return (
      (event &&
        event.conferencing &&
        event.conferencing.details &&
        event.conferencing.details.url) ||
      ''
    );
  } catch (e) {
    return ''; // the email goes out without the link rather than not at all
  }
};

const root = () => String(process.env.REACT_APP_MARKETPLACE_ROOT_URL || '').replace(/\/+$/, '');

/** The same for every calendar file about one booking, so an app updates its event, not adds one. */
const calendarUid = bookingId => `booking-${bookingId}@heyrevie.com`;

/** What goes into the client's calendar event: title, the Meet link and the booking link. */
const calendarEventFor = ({ sessionName, coachName, manageUrl, meetLink, start, end }) => ({
  start,
  end,
  summary: `${sessionName} with ${coachName}`,
  description: [
    `Your session with ${coachName}.`,
    meetLink && `Join on Google Meet: ${meetLink}`,
    `Your booking: ${manageUrl}`,
  ]
    .filter(Boolean)
    .join('\n'),
  location: meetLink,
  url: manageUrl,
});

/** The "Add to calendar" link in the client's "You're booked": the booking's own unguessable token. */
const calendarUrlFor = async bookingId =>
  `${root()}/api/nylas/calendar/${await db.getOrCreateCalendarToken(bookingId)}/revie-session.ics`;

/**
 * The booking's calendar file as it stands now: the session's current time (a reschedule shows), the
 * Meet link as it is now, the same UID as the file attached to the email, and a SEQUENCE one higher
 * for each move, so a calendar updates the event it has. Served by calendarLinkEndpoint.js.
 *
 * @param {object} params
 * @param {object} params.mapping the nylas_bookings row
 * @returns {Promise<string>} the .ics text
 */
const buildBookingCalendar = async ({ mapping, now = Date.now() }) => {
  const { tx, listing, provider } = await integration.loadTransactionAsOperator(
    mapping.sharetribe_transaction_id
  );
  const meetLink = await meetLinkFor({
    bookingId: mapping.nylas_booking_id,
    transactionId: mapping.sharetribe_transaction_id,
    grantId: mapping.nylas_grant_id,
    calendarId: listing?.attributes?.publicData?.nylasCalendarId,
  });
  const event = calendarEventFor({
    sessionName: listing?.attributes?.title || 'your session',
    coachName: provider?.attributes?.profile?.displayName || 'your coach',
    manageUrl: `${root()}/order/${tx.id.uuid || tx.id}`,
    meetLink,
    start: mapping.booking_start,
    end: mapping.booking_end,
  });
  return buildIcs({
    uid: calendarUid(mapping.nylas_booking_id),
    sequence: await db.countRescheduleEmails(mapping.nylas_booking_id),
    ...event,
    now,
  });
};

/** Everything needed to write one email: who, what and when. */
const loadEmailContext = async ({ row, mapping, now }) => {
  const { tx, listing, customer, provider } = await integration.loadTransactionAsOperator(
    mapping.sharetribe_transaction_id
  );
  const publicData = listing?.attributes?.publicData || {};
  const providerPrivate = provider?.attributes?.profile?.privateData || {};
  const txId = tx.id.uuid || tx.id;

  const details = row.details || {};
  const start = row.kind === 'rescheduled' ? details.newStart : mapping.booking_start;
  const end =
    row.kind === 'rescheduled' ? details.newEnd || mapping.booking_end : mapping.booking_end;

  const recipientUser = row.recipient === 'coach' ? provider : customer;
  const meetLink = await meetLinkFor({
    bookingId: mapping.nylas_booking_id,
    transactionId: mapping.sharetribe_transaction_id,
    grantId: mapping.nylas_grant_id,
    calendarId: publicData.nylasCalendarId,
  });

  const sessionName = listing?.attributes?.title || 'your session';
  const coachName = provider?.attributes?.profile?.displayName || 'your coach';
  const manageUrl = `${root()}/${row.recipient === 'coach' ? 'sale' : 'order'}/${txId}`;

  // The client's calendar: a file attached for any app, and (in "You're booked") an "Add to calendar"
  // link that serves the same file. Google Calendar users already have the event. The same UID goes in
  // every file about this booking, with a higher SEQUENCE after each move, so an app updates its event
  // instead of adding another.
  const wantsCalendar =
    row.recipient === 'client' && (row.kind === 'confirmed' || row.kind === 'rescheduled');
  const calendarEvent = calendarEventFor({
    sessionName,
    coachName,
    manageUrl,
    meetLink,
    start,
    end,
  });
  const attachments = wantsCalendar
    ? [
        icsAttachment(
          buildIcs({
            uid: calendarUid(mapping.nylas_booking_id),
            sequence: row.kind === 'rescheduled' ? Number(details.sequence) || 1 : 0,
            ...calendarEvent,
            now,
          })
        ),
      ]
    : [];
  const calendarUrl =
    row.kind === 'confirmed' ? await calendarUrlFor(mapping.nylas_booking_id) : undefined;

  const model = buildSessionEmailModel({
    recipient: row.recipient,
    sessionName,
    coachName,
    clientName: customer?.attributes?.profile?.displayName || 'your client',
    start,
    end,
    oldStart: row.kind === 'rescheduled' ? details.oldStart : undefined,
    oldEnd: row.kind === 'rescheduled' ? details.oldEnd : undefined,
    coachTimeZone:
      listing?.attributes?.availabilityPlan?.timezone || providerPrivate.bookingHours?.timeZone,
    clientTimeZone: tx?.attributes?.protectedData?.clientTimeZone,
    meetLink,
    manageUrl,
    payinTotal: row.kind === 'confirmed' ? tx?.attributes?.payinTotal : undefined,
    // Revie promo code: the client's confirmation shows the discount as its own line.
    lineItems: row.kind === 'confirmed' ? tx?.attributes?.lineItems : undefined,
    promoCode: row.kind === 'confirmed' ? tx?.attributes?.metadata?.promo?.code : undefined,
    calendarUrl,
    now,
  });

  return {
    to: recipientUser?.attributes?.email,
    model,
    attachments,
    lastTransition: tx?.attributes?.lastTransition,
    now,
  };
};

const templateAliasFor = row => TEMPLATE_ALIASES[`${row.kind}-${row.recipient}`];

/**
 * Was this client's "You're booked" sent (or about to be) less than two hours before this reminder is
 * due? Then the reminder would only repeat it.
 */
const confirmationJustSent = async row => {
  const confirmation = await db.getSessionEmail(confirmationKey(row.nylas_booking_id));
  if (!confirmation || ['cancelled', 'failed', 'skipped'].includes(confirmation.status)) {
    return false;
  }
  const at = new Date(confirmation.sent_at || confirmation.send_at).getTime();
  return new Date(row.send_at).getTime() - at < CONFIRMATION_REMINDER_GAP_MS;
};

/**
 * Send what is due. Run every minute from the sweeper's tick.
 *
 * @returns {Promise<{checked: number, sent: number, skipped: number, retried: number, failed: number, disabled?: boolean}>}
 */
const processDueSessionEmails = async ({
  now = Date.now(),
  send = postmark.sendTemplateEmail,
} = {}) => {
  const summary = { checked: 0, sent: 0, skipped: 0, retried: 0, failed: 0, postponed: 0 };
  if (!db.isAvailable() || !integration.isConfigured()) return summary;
  // Off, or no token: nothing is claimed, so everything waits untouched until it is switched on.
  if (!postmark.isSendingEnabled() || !postmark.isConfigured())
    return { ...summary, disabled: true };

  const due = await db.claimDueSessionEmails();
  summary.checked = due.length;

  for (const row of due) {
    const bookingId = row.nylas_booking_id;
    let domain = 'unknown';
    try {
      // eslint-disable-next-line no-await-in-loop
      const mapping = await db.findByBookingId(bookingId);

      // Decide whether it is still wanted before spending anything on it.
      let skip = null;
      if (!mapping || !ACTIVE.includes(mapping.status)) skip = 'inactive';
      else if (row.kind === 'reminder') {
        const start = new Date(row.session_start).getTime();
        if (start !== new Date(mapping.booking_start).getTime()) skip = 'moved';
        else if (start - now < TOO_LATE_MS) skip = 'too-late';
        // eslint-disable-next-line no-await-in-loop
        else if (row.recipient === 'client' && (await confirmationJustSent(row))) {
          skip = 'confirmation-just-sent';
        }
      } else if (row.kind === 'reminder60') {
        const start = new Date(row.session_start).getTime();
        if (start !== new Date(mapping.booking_start).getTime()) skip = 'moved';
      } else if (row.kind === 'confirmed') {
        // Sent any time until the session starts: a late "You're booked" is still the only
        // confirmation the client gets. Only a session already under way is too late.
        if (new Date(mapping.booking_start).getTime() <= now) skip = 'started';
      } else if (now - new Date(row.send_at).getTime() > CONFIRMATION_STALE_MS) skip = 'stale';

      if (skip) {
        // eslint-disable-next-line no-await-in-loop
        await db.finishSessionEmail(row.dedupe_key, 'skipped', skip);
        summary.skipped += 1;
        if (row.kind === 'confirmed' && skip === 'started') {
          log.error(
            new Error('A "You\'re booked" email never went out: the session started first'),
            'postmark-confirmation-missed',
            { bookingId }
          );
        }
        continue; // eslint-disable-line no-continue
      }

      // eslint-disable-next-line no-await-in-loop
      const { to, model, attachments, lastTransition } = await loadEmailContext({
        row,
        mapping,
        now,
      });
      if (!to) throw new Error('the recipient has no email address on record');

      // The 60-hour reminder goes only to a session that is still on, and while the free window it
      // describes is still open (sending can have been off, or late, for hours).
      if (row.kind === 'reminder60') {
        const reason = !LIVE_TRANSITIONS.includes(lastTransition)
          ? 'not-accepted'
          : !model.freeUntilOpen
          ? 'free-window-closed'
          : null;
        if (reason) {
          // eslint-disable-next-line no-await-in-loop
          await db.finishSessionEmail(row.dedupe_key, 'skipped', reason);
          summary.skipped += 1;
          continue; // eslint-disable-line no-continue
        }
      }
      domain = postmark.domainOf(to);

      // "You're booked" waits for the Meet link (Google adds it a moment after the event). A wait is
      // not a failure: it is put back without using a try, and goes without the link after ten minutes.
      if (
        row.kind === 'confirmed' &&
        !model.hasMeetLink &&
        now - new Date(mapping.created_at).getTime() < MEET_WAIT_MS
      ) {
        // eslint-disable-next-line no-await-in-loop
        await db.postponeSessionEmail(row.dedupe_key, POSTPONE_SECONDS);
        summary.postponed += 1;
        continue; // eslint-disable-line no-continue
      }

      // A value the email should print that could not be worked out: it still goes (a confirmation
      // with a gap beats none), and it is reported so it is never a silent blank.
      if (row.kind === 'confirmed') {
        const missing = [!model.totalPaid && 'totalPaid', !model.freeUntil && 'freeUntil'].filter(
          Boolean
        );
        if (missing.length > 0) {
          log.error(
            new Error(`"You're booked" for booking ${bookingId} is missing: ${missing.join(', ')}`),
            'postmark-confirmation-missing-field',
            { bookingId, fields: missing }
          );
        }
      }

      const templateAlias = templateAliasFor(row);
      if (!templateAlias) {
        throw new Error(
          `There is no Postmark template for a ${row.kind} email to the ${row.recipient}`
        );
      }

      // eslint-disable-next-line no-await-in-loop
      await send({
        to,
        templateAlias,
        model,
        tag: row.kind,
        ...(attachments && attachments.length ? { attachments } : {}),
      });
      // eslint-disable-next-line no-await-in-loop
      await db.finishSessionEmail(row.dedupe_key, 'sent');
      summary.sent += 1;
      console.log(
        `[postmark] sent ${row.kind} to ${row.recipient} (${domain}) booking=${bookingId}`
      );
    } catch (e) {
      log.error(e, 'postmark-send-failed', {
        kind: row.kind,
        recipient: row.recipient,
        bookingId,
        attempt: row.attempts,
        domain,
        templateAlias: templateAliasFor(row) || null,
      });
      if (row.attempts >= MAX_ATTEMPTS) {
        // eslint-disable-next-line no-await-in-loop
        await db.finishSessionEmail(row.dedupe_key, 'failed', e.message).catch(() => {});
        summary.failed += 1;
        if (row.kind === 'reminder60') {
          log.error(e, 'postmark-reminder-60h-failed', { bookingId, domain });
        }
        if (row.kind === 'confirmed') {
          // Once Sharetribe's booked email is switched off, this is the client's only confirmation.
          log.error(e, 'postmark-confirmation-failed', { bookingId, domain });
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        await db.retrySessionEmail(row.dedupe_key, e.message).catch(() => {});
        summary.retried += 1;
      }
    }
  }
  return summary;
};

module.exports = {
  queueConfirmation,
  backfillConfirmations,
  reportOverdueConfirmations,
  scheduleReminders,
  schedule60hReminder,
  rescheduleEmails,
  cancelBookingEmails,
  backfillReminders,
  processDueSessionEmails,
  // For bookingSync: the same calls that cannot throw.
  buildBookingCalendar,
  safeScheduleReminders: safely('queue reminders', scheduleReminders),
  safeSchedule60hReminder: safely('queue the 60-hour reminder', schedule60hReminder),
  safeQueueConfirmation: safely('queue the booked email', queueConfirmation),
  safeRescheduleEmails: safely('queue reschedule emails', rescheduleEmails),
  safeCancelBookingEmails: safely('cancel session emails', cancelBookingEmails),
  REMINDER_LEAD_MS,
  MAX_ATTEMPTS,
  MEET_WAIT_MS,
  CONFIRMATION_REMINDER_GAP_MS,
};
