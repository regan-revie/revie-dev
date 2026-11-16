import React, { useEffect, useRef, useState } from 'react';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { getDefaultTimeZoneOnBrowser } from '../../../util/dates';
import {
  nylasAvailability,
  nylasBookingStatus,
  nylasCancelBooking,
  nylasRescheduleBooking,
} from '../../../util/api';
import NylasSlotPicker from '../../../components/OrderPanel/NylasBookingForm/NylasSlotPicker';
import {
  dayKeyOf,
  formatTimeZoneName,
} from '../../../components/OrderPanel/NylasBookingForm/nylasSlots';

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
// What the server's error codes (rescheduleBookingEndpoint.js) say to the client.
const ERROR_MESSAGE_IDS = {
  'reschedule-too-late': 'ManageCalendarBooking.rescheduleLocked',
  'reschedule-too-soon': 'ManageCalendarBooking.rescheduleTooSoon',
  'reschedule-slot-unavailable': 'ManageCalendarBooking.rescheduleSlotUnavailable',
  'booking-cancelled': 'ManageCalendarBooking.sessionCancelled',
  'being-cancelled-by-coach': 'ManageCalendarBooking.beingCancelledByCoach',
};

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
  // One reschedule at a time. State updates are not instant, so a second click (or a second call of
  // the handler) before the first has answered could still get through; a ref cannot be late.
  const rescheduleInFlight = useRef(false);
  // The time the client has clicked and not yet confirmed (nothing is sent until they do), and the
  // day the picker should reopen on if they decide to pick a different one.
  const [pendingSlot, setPendingSlot] = useState(null);
  const [pickerDayKey, setPickerDayKey] = useState(null);

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

  // A click on a time only asks to confirm it: the request is sent by the confirm button.
  const chooseSlot = slot => {
    setActionError(null);
    setPickerDayKey(dayKeyOf(slot.start, getDefaultTimeZoneOnBrowser()));
    setPendingSlot(slot);
  };

  const pickDifferentTime = () => {
    setActionError(null);
    setPendingSlot(null);
  };

  const startReschedule = () => {
    setMode('reschedule');
    setPendingSlot(null);
    setPickerDayKey(null);
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
        if (e && e.code === 'being-cancelled-by-coach') {
          // The coach got there first: the page says so itself once it has re-read the session.
          setActionError(null);
          setMode('idle');
          loadStatus();
          return;
        }
        setActionError(e);
      });
  };

  const handleReschedule = slot => {
    if (rescheduleInFlight.current) return;
    rescheduleInFlight.current = true;
    setActionInProgress(true);
    setActionError(null);
    nylasRescheduleBooking({
      transactionId,
      start: new Date(slot.start).toISOString(),
      end: new Date(slot.end).toISOString(),
    })
      .then(() => {
        rescheduleInFlight.current = false;
        setActionInProgress(false);
        setPendingSlot(null);
        setMode('idle');
        setJustRescheduled({ start: slot.start, end: slot.end, settled: false });
      })
      .catch(e => {
        rescheduleInFlight.current = false;
        setActionInProgress(false);
        const code = e && e.code;
        setActionError(e);
        if (code === 'reschedule-slot-unavailable') {
          // Someone else took that time (or Nylas no longer offers it). The message stays on the
          // confirm panel; the free times are fetched again quietly, ready for "Pick a different time".
          nylasAvailability({
            listingId,
            ...(durationMinutes ? { lengthMinutes: durationMinutes } : {}),
          })
            .then(data => {
              const slots = (data.slots || []).filter(
                s => !durationMinutes || Math.round((s.end - s.start) / 60000) === durationMinutes
              );
              setAvailability({ state: 'loaded', slots });
            })
            .catch(() => {});
        } else if (code === 'reschedule-too-late') {
          // Inside the 48 hours now: said on the panel, and the card behind it is brought up to date.
          setStatus(current => ({ ...current, rescheduleAllowed: false }));
        } else if (['booking-cancelled', 'being-cancelled-by-coach'].includes(code)) {
          // The session is not what the page thought: say so and show it as it really is.
          setPendingSlot(null);
          if (code === 'being-cancelled-by-coach') setActionError(null);
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
  // The coach has deleted the event and the five-minute wait is running: the session is about to be
  // cancelled and refunded in full, so nothing is offered. If the coach puts the event back, the
  // buttons return on their own. Cancel is hidden too: a client cancelling inside 48 hours would be
  // charged for something the coach did.
  const coachCancelling = status.cancellationPending === true;

  // What the server's refusal says, in words; shown above the buttons, or on the confirm panel when
  // that is where the client is.
  const errorLine = actionError ? (
    <FormattedMessage
      id={ERROR_MESSAGE_IDS[actionError.code] || 'ManageCalendarBooking.genericError'}
      values={{ coachFirstName: coachFirstName || 'your coach' }}
    />
  ) : null;

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

      {actionError && !pendingSlot ? <p className={css.error}>{errorLine}</p> : null}

      {coachCancelling ? (
        <p className={css.lockedNote} role="status">
          <FormattedMessage id="ManageCalendarBooking.beingCancelledByCoach" />
        </p>
      ) : null}

      {rescheduleLocked && !coachCancelling && mode === 'idle' ? (
        <p className={css.lockedNote}>
          <FormattedMessage
            id="ManageCalendarBooking.rescheduleLocked"
            values={{ coachFirstName: coachFirstName || 'your coach' }}
          />
        </p>
      ) : null}

      {mode === 'idle' && !coachCancelling ? (
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
          {actionInProgress ? (
            <p role="status">
              <FormattedMessage id="ManageCalendarBooking.reschedulingInProgress" />
            </p>
          ) : pendingSlot ? (
            // Clicking a time only brings us here; the request is sent by "Confirm new time".
            <div className={css.confirmMove}>
              <H4 as="h3" className={css.confirmHeading}>
                <FormattedMessage id="ManageCalendarBooking.confirmMoveHeading" />
              </H4>
              <p className={css.confirmLine}>
                <FormattedMessage
                  id="ManageCalendarBooking.confirmMoveFrom"
                  values={{ time: formatSession(sessionStart, sessionEnd) }}
                />
              </p>
              <p className={css.confirmLine}>
                <FormattedMessage
                  id="ManageCalendarBooking.confirmMoveTo"
                  values={{
                    time: formatSession(pendingSlot.start, pendingSlot.end),
                    timeZone: formatTimeZoneName(timeZone, pendingSlot.start, intl.locale),
                  }}
                />
              </p>
              {actionError ? (
                <p className={css.error} role="alert">
                  {errorLine}
                </p>
              ) : null}
              <div className={css.actions}>
                {!['reschedule-slot-unavailable', 'reschedule-too-late'].includes(
                  actionError?.code
                ) ? (
                  <PrimaryButton onClick={() => handleReschedule(pendingSlot)}>
                    <FormattedMessage id="ManageCalendarBooking.confirmMoveButton" />
                  </PrimaryButton>
                ) : null}
                {actionError?.code === 'reschedule-too-late' ? (
                  <SecondaryButton
                    onClick={() => {
                      setPendingSlot(null);
                      setActionError(null);
                      setMode('idle');
                    }}
                  >
                    <FormattedMessage id="ManageCalendarBooking.cancelRescheduleButton" />
                  </SecondaryButton>
                ) : (
                  <InlineTextButton className={css.cancelLink} onClick={pickDifferentTime}>
                    <FormattedMessage id="ManageCalendarBooking.pickDifferentTime" />
                  </InlineTextButton>
                )}
              </div>
            </div>
          ) : availability.state === 'loading' ? (
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
              initialDayKey={pickerDayKey}
              onSelectSlot={chooseSlot}
            />
          )}
          {!pendingSlot ? (
            <SecondaryButton disabled={actionInProgress} onClick={() => setMode('idle')}>
              <FormattedMessage id="ManageCalendarBooking.cancelRescheduleButton" />
            </SecondaryButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default ManageCalendarBooking;
