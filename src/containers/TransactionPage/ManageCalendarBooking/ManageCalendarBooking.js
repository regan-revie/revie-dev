import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { getDefaultTimeZoneOnBrowser } from '../../../util/dates';
import {
  nylasAvailability,
  nylasBookingStatus,
  nylasCancelBooking,
  nylasRescheduleBooking,
} from '../../../util/api';
import NylasSlotSteps from '../../../components/OrderPanel/NylasBookingForm/NylasSlotSteps';
import { IconCalendarStar, IconVideoCall } from '../../ListingPage/SessionPage/SessionIcons';
import {
  formatFreeUntil,
  formatSessionDay,
  formatSessionTimes,
  formatSessionWhen,
  sessionMinutes,
} from '../BookingConfirmation/bookingFormat';

import css from './ManageCalendarBooking.module.css';

/**
 * The "Your session" card on a client's booking page (docs/design/booking-confirmation/): when the
 * session is, how to join it, adding it to a calendar, and moving or cancelling it.
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
 *
 * The page's hero and its "cancelled" section need to know what this card knows (the time now, and
 * whether the session was just cancelled), so it reports them through `onViewChange`.
 */
// What the server's error codes (rescheduleBookingEndpoint.js) say to the client.
const ERROR_MESSAGE_IDS = {
  'reschedule-too-late': 'ManageCalendarBooking.rescheduleLocked',
  'reschedule-too-soon': 'ManageCalendarBooking.rescheduleTooSoon',
  'reschedule-slot-unavailable': 'ManageCalendarBooking.rescheduleSlotUnavailable',
  'booking-cancelled': 'ManageCalendarBooking.sessionCancelled',
  'being-cancelled-by-coach': 'ManageCalendarBooking.beingCancelledByCoach',
};

// How long after the confirm panel opens a click on "Confirm new time" is ignored. A double-click on
// a time opens the panel with its second click, which would otherwise land on the confirm button.
const CONFIRM_GUARD_MS = 500;
// A session this close to its start is inside the window where it cannot be moved again and
// cancelling is charged (the same 48 hours the server applies, server/api/nylas/scheduler.js).
const LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;

const boldTag = chunks => <b>{chunks}</b>;

const ManageCalendarBooking = ({
  transactionId: transactionIdMaybe,
  listingId: listingIdMaybe,
  onCancelled,
  onViewChange,
  // What a free cancellation gives back, as money text ("$93.50"), for the confirm panel.
  refundText,
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
  // the confirm panel is open for. The picker underneath is kept, exactly as it was.
  const [pendingSlot, setPendingSlot] = useState(null);
  // When clicks on "Confirm new time" start to count (see CONFIRM_GUARD_MS).
  const confirmReadyAt = useRef(0);

  // The first load also asks for the Meet link and the "Add to calendar" link; the polling after a
  // reschedule does not (it would ask Nylas every few seconds), and keeps what it has.
  const loadStatus = () => {
    setStatus({ state: 'loading' });
    nylasBookingStatus({ transactionId, links: true })
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
            setStatus(current => ({ ...current, state: 'loaded', ...data }));
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

  // Until the status endpoint has caught up with a reschedule, show the time just chosen.
  const showingChosen = !!justRescheduled && !justRescheduled.settled;
  const sessionStart = showingChosen ? justRescheduled.start : status.bookingStart;
  const sessionEnd = showingChosen ? justRescheduled.end : status.bookingEnd;

  const cancelledState = justCancelled
    ? justCancelled.free
    : status.status === 'cancelled'
    ? status.freeCancellation ?? null
    : undefined;
  const isCancelled = cancelledState !== undefined;

  // What the page around this card needs: the time now, and the cancellation if there is one.
  const startMs = sessionStart ? new Date(sessionStart).getTime() : null;
  const endMs = sessionEnd ? new Date(sessionEnd).getTime() : null;
  useEffect(() => {
    if (!onViewChange || status.state !== 'loaded') return;
    onViewChange({
      start: startMs,
      end: endMs,
      isCancelled,
      // true: refunded; false: charged; null: not known
      cancelFree: isCancelled ? cancelledState : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.state, startMs, endMs, isCancelled, cancelledState]);

  // A click on a time only opens the confirm panel: the request is sent by its confirm button.
  const chooseSlot = slot => {
    setActionError(null);
    confirmReadyAt.current = Date.now() + CONFIRM_GUARD_MS;
    setPendingSlot(slot);
  };

  // "Pick a different time": back to the picker, as it was. Not while the request is in flight.
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
          // panel; the free times are fetched again quietly, ready for the picker behind it.
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
          // Inside the 48 hours now: said in the panel, and the card behind it is brought up to date.
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
  const hasTime = Number.isFinite(startMs) && Number.isFinite(endMs);
  // Moving a session is allowed while cancelling it is still free; the server decides and enforces
  // it (rescheduleBookingEndpoint.js). Only a definite "no" hides the button.
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

  // The cancelled session is shown by the page itself (its heading, and the refund section).
  if (isCancelled) {
    return null;
  }

  // A session that has already happened has nothing left to change.
  const sessionIsOver = status.bookingEnd && new Date(status.bookingEnd) < new Date();
  if (sessionIsOver) {
    return null;
  }

  const minutes = hasTime ? sessionMinutes(startMs, endMs) : null;
  const confirmingMove = mode === 'reschedule' && !!pendingSlot;
  const pickingTime = mode === 'reschedule';
  const showButtons = !coachCancelling;

  return (
    <section className={css.root} aria-labelledby="your-session-title">
      <div className={css.eyebrow}>
        <span id="your-session-title">
          <FormattedMessage id="ManageCalendarBooking.heading" />
        </span>
        <span aria-hidden="true" className={css.eyebrowRule} />
      </div>

      {hasTime ? (
        <div className={css.whenBlock}>
          <p className={css.when} data-testid="session-when">
            <span>{formatSessionDay(startMs, timeZone)}</span>
            <span aria-hidden="true" className={css.whenDot}>
              {' · '}
            </span>
            <span>{formatSessionTimes(startMs, endMs, timeZone)}</span>
          </p>
          {minutes ? (
            <span className={css.quiet}>
              <FormattedMessage id="ManageCalendarBooking.videoCall" values={{ minutes }} />
            </span>
          ) : null}
        </div>
      ) : null}

      {justRescheduled ? (
        // Only after a reschedule in this visit: on reload it is gone, and the Activity list keeps
        // the record.
        <p className={css.moved} role="status">
          <svg
            aria-hidden="true"
            focusable="false"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <FormattedMessage id="ManageCalendarBooking.rescheduledNote" />
        </p>
      ) : null}

      <div className={css.linkButtons}>
        {status.meetLink ? (
          <a
            href={status.meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className={css.joinButton}
          >
            <IconVideoCall size={22} />
            <FormattedMessage id="ManageCalendarBooking.join" />
          </a>
        ) : null}
        {status.calendarUrl ? (
          <a href={status.calendarUrl} className={css.calendarButton}>
            <IconCalendarStar size={20} />
            <FormattedMessage id="ManageCalendarBooking.addToCalendar" />
          </a>
        ) : null}
      </div>
      {status.calendarUrl ? (
        <span className={css.help}>
          <FormattedMessage id="ManageCalendarBooking.calendarHelp" />
        </span>
      ) : null}

      <hr className={css.rule} />

      {actionError && !pendingSlot && mode !== 'confirm-cancel' ? (
        <p className={css.error} role="alert">
          {errorLine}
        </p>
      ) : null}

      {coachCancelling ? (
        <p className={css.lockedNote} role="status">
          <FormattedMessage id="ManageCalendarBooking.beingCancelledByCoach" />
        </p>
      ) : null}

      {rescheduleLocked && !coachCancelling && mode === 'idle' ? (
        <div className={css.lockedBox}>
          <span aria-hidden="true" className={css.lockedMark}>
            !
          </span>
          <span>
            <FormattedMessage id="ManageCalendarBooking.rescheduleLocked" />
          </span>
        </div>
      ) : null}

      {mode === 'idle' && showButtons ? (
        <div className={css.actionRow}>
          {!rescheduleLocked && hasTime ? (
            <span className={css.freeUntil}>
              <FormattedMessage
                id="ManageCalendarBooking.freeUntil"
                values={{ date: formatFreeUntil(startMs, timeZone), b: boldTag }}
              />
            </span>
          ) : null}
          <div className={css.actionLinks}>
            {!rescheduleLocked ? (
              <button type="button" className={css.linkButton} onClick={startReschedule}>
                <FormattedMessage id="ManageCalendarBooking.rescheduleButton" />
              </button>
            ) : null}
            <button
              type="button"
              className={css.linkButton}
              onClick={() => {
                setActionError(null);
                setMode('confirm-cancel');
              }}
            >
              <FormattedMessage id="ManageCalendarBooking.cancelButton" />
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'confirm-cancel' ? (
        <div className={css.cancelPanel}>
          <h3 className={css.panelHeading}>
            <FormattedMessage
              id="ManageCalendarBooking.confirmCancelHeading"
              values={{ b: boldTag }}
            />
          </h3>
          <p className={css.panelText}>
            {status.freeCancellationNow === true ? (
              refundText ? (
                <FormattedMessage
                  id="ManageCalendarBooking.confirmCancelTextFree"
                  values={{ amount: refundText }}
                />
              ) : (
                <FormattedMessage id="ManageCalendarBooking.confirmCancelTextFreeNoAmount" />
              )
            ) : status.freeCancellationNow === false ? (
              <FormattedMessage id="ManageCalendarBooking.confirmCancelTextCharged" />
            ) : (
              <FormattedMessage id="ManageCalendarBooking.confirmCancelText" />
            )}
          </p>
          {actionError ? (
            <p className={css.panelError} role="alert">
              {errorLine}
            </p>
          ) : null}
          <div className={css.panelActions}>
            <button
              type="button"
              className={css.lavenderButton}
              disabled={actionInProgress}
              onClick={handleCancel}
            >
              <FormattedMessage
                id={
                  status.freeCancellationNow === false
                    ? 'ManageCalendarBooking.confirmCancelButtonCharged'
                    : 'ManageCalendarBooking.confirmCancelButton'
                }
              />
            </button>
            <button
              type="button"
              className={classNames(css.linkButton, css.onDark)}
              disabled={actionInProgress}
              onClick={() => setMode('idle')}
            >
              <FormattedMessage id="ManageCalendarBooking.keepBookingButton" />
            </button>
          </div>
        </div>
      ) : null}

      {pickingTime ? (
        <div className={css.reschedule}>
          {/* Kept in place while the confirm panel is open, so "Pick a different time" brings back
              the picker exactly as it was (the day that was open). */}
          <div className={css.pickPanel} hidden={confirmingMove}>
            <h3 className={css.pickHeading}>
              <FormattedMessage id="ManageCalendarBooking.pickNewTime" />
            </h3>
            {availability.state === 'loading' ? (
              <p>
                <FormattedMessage id="ManageCalendarBooking.loadingSlots" />
              </p>
            ) : availability.state === 'error' || availability.slots.length === 0 ? (
              <p className={css.error}>
                <FormattedMessage id="ManageCalendarBooking.noSlots" />
              </p>
            ) : (
              // The same days and times as the original booking panel, so a client picks a new time
              // the way they picked the first one.
              <NylasSlotSteps
                slots={availability.slots}
                timeZone={timeZone}
                plainTitles
                dayStepNumber={1}
                onSelectSlot={chooseSlot}
              />
            )}
            <div>
              <button
                type="button"
                className={css.linkButton}
                disabled={actionInProgress}
                onClick={() => setMode('idle')}
              >
                <FormattedMessage id="ManageCalendarBooking.cancelRescheduleButton" />
              </button>
            </div>
          </div>

          {confirmingMove ? (
            <div className={css.movePanel} data-testid="confirm-move">
              {actionInProgress ? (
                <p className={css.panelText} role="status">
                  <FormattedMessage id="ManageCalendarBooking.reschedulingInProgress" />
                </p>
              ) : (
                <>
                  <h3 className={css.panelHeading}>
                    <FormattedMessage
                      id="ManageCalendarBooking.confirmMoveHeading"
                      values={{ b: boldTag }}
                    />
                  </h3>
                  <div className={css.moveTimes}>
                    <s className={css.oldTime}>
                      <span className={css.visuallyHidden}>
                        <FormattedMessage id="ManageCalendarBooking.currentTime" />{' '}
                      </span>
                      {formatSessionWhen(startMs, endMs, timeZone)}
                    </s>
                    <span className={css.newTime}>
                      <svg
                        aria-hidden="true"
                        focusable="false"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                      <span className={css.visuallyHidden}>
                        <FormattedMessage id="ManageCalendarBooking.newTime" />{' '}
                      </span>
                      {formatSessionWhen(
                        new Date(pendingSlot.start).getTime(),
                        new Date(pendingSlot.end).getTime(),
                        timeZone
                      )}
                    </span>
                  </div>
                  {new Date(pendingSlot.start).getTime() - Date.now() < LOCK_WINDOW_MS ? (
                    <p className={css.panelNote}>
                      <FormattedMessage id="ManageCalendarBooking.confirmMoveInsideLockWindow" />
                    </p>
                  ) : null}
                  {actionError ? (
                    <p className={css.panelError} role="alert">
                      {errorLine}
                    </p>
                  ) : null}
                  <div className={css.panelActions}>
                    {!['reschedule-slot-unavailable', 'reschedule-too-late'].includes(
                      actionError?.code
                    ) ? (
                      <button type="button" className={css.chartreuseButton} onClick={confirmMove}>
                        <FormattedMessage id="ManageCalendarBooking.confirmMoveButton" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={classNames(css.linkButton, css.onDarkBlue)}
                      onClick={closeConfirm}
                    >
                      <FormattedMessage id="ManageCalendarBooking.confirmMoveCancel" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default ManageCalendarBooking;
