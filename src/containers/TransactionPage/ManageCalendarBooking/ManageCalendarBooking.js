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
import { formatTimeZoneName } from '../../../components/OrderPanel/NylasBookingForm/nylasSlots';

import { H4, Modal, PrimaryButton, SecondaryButton, InlineTextButton } from '../../../components';

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

// How long after the confirm dialog opens a click on "Confirm new time" is ignored. A double-click on
// a time opens the dialog with its second click, which would otherwise land on the confirm button.
const CONFIRM_GUARD_MS = 500;
// A session this close to its start is inside the window where it cannot be moved again and
// cancelling is charged (the same 48 hours the server applies, server/api/nylas/scheduler.js).
const LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;
const MODAL_ID = 'ManageCalendarBookingConfirmMove';

const ManageCalendarBooking = ({
  transactionId: transactionIdMaybe,
  listingId: listingIdMaybe,
  onCancelled,
  onManageDisableScrolling = () => {},
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
  // The time the client has clicked and not yet confirmed (nothing is sent until they do). It is what
  // the confirm dialog is open for. The picker underneath is left exactly as it was.
  const [pendingSlot, setPendingSlot] = useState(null);
  // When clicks on "Confirm new time" start to count (see CONFIRM_GUARD_MS).
  const confirmReadyAt = useRef(0);

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

  // A click on a time only opens the confirm dialog: the request is sent by its confirm button.
  const chooseSlot = slot => {
    setActionError(null);
    confirmReadyAt.current = Date.now() + CONFIRM_GUARD_MS;
    setPendingSlot(slot);
  };

  // "Cancel" in the dialog, its close button and Escape: back to the picker, as it was. Not while the
  // request is in flight.
  const closeConfirm = () => {
    if (rescheduleInFlight.current) return;
    const tooLate = actionError && actionError.code === 'reschedule-too-late';
    setPendingSlot(null);
    setActionError(null);
    // Nothing left to pick for when the session has just moved inside the 48 hours.
    if (tooLate) setMode('idle');
  };

  const confirmMove = () => {
    if (Date.now() < confirmReadyAt.current) return;
    handleReschedule(pendingSlot);
  };

  const startReschedule = () => {
    setMode('reschedule');
    setPendingSlot(null);
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
          // Someone else took that time (or Nylas no longer offers it). The message stays in the
          // dialog; the free times are fetched again quietly, ready for the picker behind it.
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
          // Inside the 48 hours now: said in the dialog, and the card behind it is brought up to date.
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
  // "Fri, Nov 20, 2:30 – 3:30 PM", in the client's own timezone.
  const formatSession = (start, end) =>
    intl.formatDateTimeRange(new Date(start), new Date(end), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  // The same, with the zone named the way people say it: "... (Pacific Time)".
  const formatSessionWithZone = (start, end) =>
    `${formatSession(start, end)} (${formatTimeZoneName(timeZone, start, intl.locale)})`;

  // Until the status endpoint has caught up with a reschedule, show the time just chosen.
  const showingChosen = justRescheduled && !justRescheduled.settled;
  const sessionStart = showingChosen ? justRescheduled.start : status.bookingStart;
  const sessionEnd = showingChosen ? justRescheduled.end : status.bookingEnd;
  const formattedTime =
    sessionStart && sessionEnd ? formatSessionWithZone(sessionStart, sessionEnd) : null;
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
        // Only after a reschedule in this visit: on reload it is gone, and the Activity list keeps
        // the record.
        <p className={css.rescheduledNote} role="status">
          <FormattedMessage id="ManageCalendarBooking.rescheduledNote" />
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
          <FormattedMessage id="ManageCalendarBooking.rescheduleLocked" />
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
              onSelectSlot={chooseSlot}
            />
          )}
          <SecondaryButton disabled={actionInProgress} onClick={() => setMode('idle')}>
            <FormattedMessage id="ManageCalendarBooking.cancelRescheduleButton" />
          </SecondaryButton>
        </div>
      ) : null}

      <Modal
        id={MODAL_ID}
        containerClassName={css.modalRoot}
        contentClassName={css.modalContent}
        isOpen={mode === 'reschedule' && !!pendingSlot}
        onClose={closeConfirm}
        onManageDisableScrolling={onManageDisableScrolling}
        usePortal
      >
        {pendingSlot ? (
          actionInProgress ? (
            <p className={css.modalMessage} role="status">
              <FormattedMessage id="ManageCalendarBooking.reschedulingInProgress" />
            </p>
          ) : (
            <>
              <H4 as="h2" className={css.modalTitle}>
                <FormattedMessage id="ManageCalendarBooking.confirmMoveHeading" />
              </H4>
              <p className={css.modalMessage}>
                <FormattedMessage
                  id="ManageCalendarBooking.confirmMoveFrom"
                  values={{ time: formatSession(sessionStart, sessionEnd) }}
                />
              </p>
              <p className={css.modalMessage}>
                <FormattedMessage
                  id="ManageCalendarBooking.confirmMoveTo"
                  values={{
                    time: formatSession(pendingSlot.start, pendingSlot.end),
                    timeZone: formatTimeZoneName(timeZone, pendingSlot.start, intl.locale),
                  }}
                />
              </p>
              {new Date(pendingSlot.start).getTime() - Date.now() < LOCK_WINDOW_MS ? (
                <p className={css.modalMessage}>
                  <FormattedMessage id="ManageCalendarBooking.confirmMoveInsideLockWindow" />
                </p>
              ) : null}
              {actionError ? (
                <p className={css.error} role="alert">
                  {errorLine}
                </p>
              ) : null}
              <div className={css.actions}>
                {!['reschedule-slot-unavailable', 'reschedule-too-late'].includes(
                  actionError?.code
                ) ? (
                  <PrimaryButton onClick={confirmMove}>
                    <FormattedMessage id="ManageCalendarBooking.confirmMoveButton" />
                  </PrimaryButton>
                ) : null}
                <SecondaryButton onClick={closeConfirm}>
                  <FormattedMessage id="ManageCalendarBooking.confirmMoveCancel" />
                </SecondaryButton>
              </div>
            </>
          )
        ) : null}
      </Modal>
    </div>
  );
};

export default ManageCalendarBooking;
