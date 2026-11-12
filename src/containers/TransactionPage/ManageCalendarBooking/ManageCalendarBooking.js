import React, { useEffect, useState } from 'react';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { getDefaultTimeZoneOnBrowser } from '../../../util/dates';
import {
  nylasAvailability,
  nylasBookingStatus,
  nylasCancelBooking,
  nylasRescheduleBooking,
} from '../../../util/api';
import NylasSlotPicker from '../../../components/OrderPanel/NylasBookingForm/NylasSlotPicker';

import { H4, PrimaryButton, SecondaryButton, InlineTextButton } from '../../../components';

import css from './ManageCalendarBooking.module.css';

/**
 * Cancel/reschedule for a calendar-booking session, on the customer's own transaction page.
 *
 * Exists as a self-contained component with its own local state rather than threading into
 * TransactionPage's Redux duck and generic transition-button machinery, because neither cancel nor
 * reschedule here is a Sharetribe transition: both call our own server, which talks to Nylas, and
 * the actual Sharetribe-side effect (a refund, or nothing) happens later via the booking.cancelled
 * webhook - see server/api/nylas/cancelBookingEndpoint.js for why Nylas's own hosted cancel/
 * reschedule links cannot be used instead.
 *
 * The displayed time comes from GET /api/nylas/booking-status, not from the transaction's own
 * booking dates: a reschedule updates our database, never Sharetribe's immutable booking record,
 * so that is the only place the current time can be read from once one has happened.
 */
const ManageCalendarBooking = ({
  transactionId: transactionIdMaybe,
  listingId: listingIdMaybe,
  coachFirstName,
  onCancelled,
}) => {
  // Callers pass the SDK entities' own .id (transaction.id, listing.id), which may be a UUID
  // object or already a plain string - normalised here rather than pushed onto every caller.
  const transactionId = transactionIdMaybe?.uuid || transactionIdMaybe;
  const listingId = listingIdMaybe?.uuid || listingIdMaybe;
  const intl = useIntl();
  const [status, setStatus] = useState({ state: 'loading' });
  const [mode, setMode] = useState('idle'); // 'idle' | 'confirm-cancel' | 'reschedule'
  const [availability, setAvailability] = useState({ state: 'idle', slots: [] });
  const [actionInProgress, setActionInProgress] = useState(false);
  const [actionError, setActionError] = useState(null);
  // Set the moment our own cancel succeeds. The booking-status endpoint only learns of the
  // cancellation when Nylas's webhook arrives a moment later, so the page cannot wait for it to
  // say "cancelled" - and the refund outcome shown is the one the client was told when confirming.
  const [justCancelled, setJustCancelled] = useState(null);
  // Set the moment our own reschedule succeeds: the time the client picked. Like a cancellation, the
  // new time reaches booking-status only when Nylas's webhook arrives a moment later, so until it
  // does the page shows what was just chosen instead of the old time.
  const [justRescheduled, setJustRescheduled] = useState(null);

  const loadStatus = () => {
    setStatus({ state: 'loading' });
    nylasBookingStatus({ transactionId })
      .then(data => setStatus({ state: 'loaded', ...data }))
      .catch(() => setStatus({ state: 'error' }));
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  // After a reschedule, ask again every few seconds until the status shows the new time (or give up
  // after about a minute and leave the chosen time on screen - it is right either way).
  useEffect(() => {
    if (!justRescheduled || justRescheduled.settled) return undefined;
    let attempts = 0;
    let cancelled = false;
    let timer = null;
    const check = () => {
      attempts += 1;
      nylasBookingStatus({ transactionId })
        .then(data => {
          if (cancelled) return;
          const arrived =
            data.bookingStart &&
            Math.abs(new Date(data.bookingStart) - new Date(justRescheduled.start)) < 60000;
          if (arrived) {
            setStatus({ state: 'loaded', ...data });
            setJustRescheduled(current => (current ? { ...current, settled: true } : current));
          } else if (attempts < 20) {
            timer = setTimeout(check, 3000);
          }
        })
        .catch(() => {
          if (!cancelled && attempts < 20) timer = setTimeout(check, 3000);
        });
    };
    timer = setTimeout(check, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justRescheduled, transactionId]);

  const durationMinutes =
    status.state === 'loaded' && status.bookingStart && status.bookingEnd
      ? Math.round((new Date(status.bookingEnd) - new Date(status.bookingStart)) / 60000)
      : null;

  const startReschedule = () => {
    setMode('reschedule');
    setActionError(null);
    setAvailability({ state: 'loading', slots: [] });
    // The booked length picks the Nylas configuration, so only slots of that length come back.
    nylasAvailability({ listingId, ...(durationMinutes ? { lengthMinutes: durationMinutes } : {}) })
      .then(data => {
        const slots = (data.slots || []).filter(
          s => !durationMinutes || Math.round((s.end - s.start) / 60000) === durationMinutes
        );
        setAvailability({ state: 'loaded', slots });
      })
      .catch(() => setAvailability({ state: 'error', slots: [] }));
  };

  const handleCancel = () => {
    setActionInProgress(true);
    setActionError(null);
    nylasCancelBooking({ transactionId })
      .then(() => {
        setActionInProgress(false);
        setMode('idle');
        // What the confirmation step promised, so the page cannot contradict it afterwards.
        setJustCancelled({ free: status.freeCancellationNow ?? null });
        // Lets the page re-read the transaction: a late cancellation is recorded on it by the
        // booking.cancelled webhook a few seconds from now, and the heading depends on that.
        if (onCancelled) onCancelled();
      })
      .catch(e => {
        setActionInProgress(false);
        setActionError(e);
      });
  };

  const handleReschedule = slot => {
    setActionInProgress(true);
    setActionError(null);
    nylasRescheduleBooking({
      transactionId,
      start: new Date(slot.start).toISOString(),
      end: new Date(slot.end).toISOString(),
    })
      .then(() => {
        setActionInProgress(false);
        setMode('idle');
        setJustRescheduled({ start: slot.start, end: slot.end, settled: false });
      })
      .catch(e => {
        setActionInProgress(false);
        setActionError(e);
        // The server turned it down because the session is now inside the 48 hours: say so and show
        // the page as it really is, instead of leaving a button that cannot work.
        if (e && e.code === 'reschedule-too-late') {
          setMode('idle');
          loadStatus();
        }
      });
  };

  if (status.state === 'loading' || status.state === 'error') {
    return null;
  }

  const timeZone = getDefaultTimeZoneOnBrowser();
  const formatSession = (start, end) =>
    `${intl.formatDate(new Date(start), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })}, ${intl.formatTime(new Date(start))} – ${intl.formatTime(new Date(end))}`;

  // Until the status endpoint has caught up with a reschedule, show the time just chosen.
  const showingChosen = justRescheduled && !justRescheduled.settled;
  const sessionStart = showingChosen ? justRescheduled.start : status.bookingStart;
  const sessionEnd = showingChosen ? justRescheduled.end : status.bookingEnd;
  const formattedTime = sessionStart && sessionEnd ? formatSession(sessionStart, sessionEnd) : null;
  // "Fri, Nov 20, 11:30 AM": the confirmation names the start, which is what people look for.
  const rescheduledTo = justRescheduled
    ? `${intl.formatDate(new Date(justRescheduled.start), {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })}, ${intl.formatTime(new Date(justRescheduled.start))}`
    : null;

  // Moving a session is allowed while cancelling it is still free; the server decides and enforces
  // it (rescheduleBookingEndpoint.js). Only a definite "no" disables the button.
  const rescheduleLocked = status.rescheduleAllowed === false;

  const cancelledState = justCancelled
    ? justCancelled.free
    : status.status === 'cancelled'
    ? status.freeCancellation ?? null
    : undefined;
  const isCancelled = cancelledState !== undefined;

  // A session that has already happened has nothing left to change.
  const sessionIsOver = status.bookingEnd && new Date(status.bookingEnd) < new Date();
  if (!isCancelled && sessionIsOver) {
    return null;
  }

  if (isCancelled) {
    const messageId =
      cancelledState === true
        ? 'ManageCalendarBooking.cancelledFree'
        : cancelledState === false
        ? 'ManageCalendarBooking.cancelledCharged'
        : 'ManageCalendarBooking.cancelledUnknown';
    return (
      <div className={css.root}>
        <H4 as="h2" className={css.heading}>
          <FormattedMessage id="ManageCalendarBooking.heading" />
        </H4>
        {formattedTime ? <p className={css.time}>{formattedTime}</p> : null}
        <p className={css.cancelledMessage} role="status">
          <FormattedMessage id={messageId} />
        </p>
      </div>
    );
  }

  return (
    <div className={css.root}>
      <H4 as="h2" className={css.heading}>
        <FormattedMessage id="ManageCalendarBooking.heading" />
      </H4>

      {formattedTime ? <p className={css.time}>{formattedTime}</p> : null}

      {justRescheduled ? (
        <p className={css.rescheduledMessage} role="status">
          <FormattedMessage
            id="ManageCalendarBooking.rescheduled"
            values={{ time: rescheduledTo }}
          />
        </p>
      ) : null}

      {actionError ? (
        <p className={css.error}>
          <FormattedMessage
            id={
              actionError.code === 'reschedule-too-soon'
                ? 'ManageCalendarBooking.rescheduleTooSoon'
                : 'ManageCalendarBooking.genericError'
            }
          />
        </p>
      ) : null}

      {rescheduleLocked && mode === 'idle' ? (
        <p className={css.lockedNote}>
          <FormattedMessage
            id="ManageCalendarBooking.rescheduleLocked"
            values={{ coachFirstName: coachFirstName || 'your coach' }}
          />
        </p>
      ) : null}

      {mode === 'idle' ? (
        <div className={css.actions}>
          <SecondaryButton onClick={startReschedule} disabled={rescheduleLocked}>
            <FormattedMessage id="ManageCalendarBooking.rescheduleButton" />
          </SecondaryButton>
          <InlineTextButton
            className={css.cancelLink}
            onClick={() => {
              setActionError(null);
              setMode('confirm-cancel');
            }}
          >
            <FormattedMessage id="ManageCalendarBooking.cancelButton" />
          </InlineTextButton>
        </div>
      ) : null}

      {mode === 'confirm-cancel' ? (
        <div className={css.confirmCancel}>
          <p>
            <FormattedMessage
              id={
                status.freeCancellationNow === true
                  ? 'ManageCalendarBooking.confirmCancelTextFree'
                  : status.freeCancellationNow === false
                  ? 'ManageCalendarBooking.confirmCancelTextCharged'
                  : 'ManageCalendarBooking.confirmCancelText'
              }
            />
          </p>
          <div className={css.actions}>
            <PrimaryButton inProgress={actionInProgress} onClick={handleCancel}>
              <FormattedMessage
                id={
                  status.freeCancellationNow === false
                    ? 'ManageCalendarBooking.confirmCancelButtonCharged'
                    : 'ManageCalendarBooking.confirmCancelButton'
                }
              />
            </PrimaryButton>
            <SecondaryButton disabled={actionInProgress} onClick={() => setMode('idle')}>
              <FormattedMessage id="ManageCalendarBooking.keepBookingButton" />
            </SecondaryButton>
          </div>
        </div>
      ) : null}

      {mode === 'reschedule' ? (
        <div className={css.reschedule}>
          {availability.state === 'loading' ? (
            <p>
              <FormattedMessage id="ManageCalendarBooking.loadingSlots" />
            </p>
          ) : availability.state === 'error' || availability.slots.length === 0 ? (
            <p className={css.error}>
              <FormattedMessage id="ManageCalendarBooking.noSlots" />
            </p>
          ) : (
            // Same calendar + time-list picker as the original booking flow (NylasBookingForm),
            // so a client picks a new time the same way they picked the first one.
            <NylasSlotPicker
              slots={availability.slots}
              timeZone={timeZone}
              onSelectSlot={handleReschedule}
            />
          )}
          <SecondaryButton disabled={actionInProgress} onClick={() => setMode('idle')}>
            <FormattedMessage id="ManageCalendarBooking.cancelRescheduleButton" />
          </SecondaryButton>
        </div>
      ) : null}
    </div>
  );
};

export default ManageCalendarBooking;
