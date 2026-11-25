import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { createSlug } from '../../../util/urlHelpers';
import { CoachPhoto, IconSpinner, NamedLink } from '../../../components';
import { IconPrep } from '../../ListingPage/SessionPage/SessionIcons';
import { safeExternalUrl } from '../../ListingPage/SessionPage/sessionPageHelpers';

import css from './BookingConfirmation.module.css';

const boldTag = chunks => <b>{chunks}</b>;

/**
 * "What happens next." Three numbered steps: check your inbox; "Before your session" (the session's
 * own `pre_work` text, and an outlined button to its prep link if it has one: left out when it has
 * neither); join from here or the invite. The numbers close up when the middle step is left out.
 */
export const NextSteps = ({ preWork, prepLink }) => {
  const text = typeof preWork === 'string' ? preWork.trim() : '';
  const href = safeExternalUrl(prepLink);
  const hasPrep = text.length > 0 || !!href;
  const steps = ['inbox', ...(hasPrep ? ['prep'] : []), 'join'];

  return (
    <section aria-labelledby="next-steps-title" className={css.next}>
      <h2 id="next-steps-title" className={css.nextHeading}>
        <FormattedMessage id="BookingConfirmation.nextHeading" values={{ b: boldTag }} />
      </h2>
      <ol className={css.steps}>
        {steps.map((step, index) => (
          <li key={step} className={css.step}>
            <span aria-hidden="true" className={css.stepNumber}>
              {index + 1}
            </span>
            <div>
              {step === 'inbox' ? (
                <>
                  <b>
                    <FormattedMessage id="BookingConfirmation.stepInboxTitle" />
                  </b>
                  <br />
                  <FormattedMessage id="BookingConfirmation.stepInboxText" />
                </>
              ) : null}
              {step === 'prep' ? (
                <>
                  <b>
                    <FormattedMessage id="BookingConfirmation.stepPrepTitle" />
                  </b>
                  {text ? (
                    <>
                      <br />
                      <span className={css.prepText}>{text}</span>
                    </>
                  ) : null}
                  {href ? (
                    <>
                      <br />
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={css.prepButton}
                      >
                        <IconPrep size={18} />
                        <FormattedMessage id="BookingConfirmation.prepButton" />
                      </a>
                    </>
                  ) : null}
                </>
              ) : null}
              {step === 'join' ? (
                <>
                  <b>
                    <FormattedMessage id="BookingConfirmation.stepJoinTitle" />
                  </b>
                  <br />
                  <FormattedMessage id="BookingConfirmation.stepJoinText" />
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};

/**
 * "Message Maya": the latest two messages (three lines each at most), the way to the whole
 * conversation, and a box to write one. The note the client wrote when booking is the first thing
 * they said, so it leads the conversation here.
 *
 * @param {Object} props
 * @param {Array} props.messages message entities, oldest first
 * @param {string} [props.note] the note written at checkout
 * @param {string} props.currentUserId the client's own user id
 * @param {string} props.coachName
 * @param {string} props.coachFirstName
 * @param {Object} [props.coachImage]
 * @param {boolean} props.canSend false when messaging is not allowed (a banned or deleted user)
 * @param {(text: string, form: {reset: Function}) => void} props.onSend
 * @param {boolean} [props.sending]
 * @param {Object} [props.sendError]
 */
export const MessageCard = props => {
  const {
    messages = [],
    note,
    currentUserId,
    coachName,
    coachFirstName,
    coachImage,
    canSend,
    onSend,
    sending,
    sendError,
  } = props;
  const intl = useIntl();
  const [text, setText] = useState('');

  const bubbles = [
    ...(note ? [{ id: 'note', content: note, mine: true }] : []),
    ...messages.map(m => ({
      id: m.id?.uuid || m.id,
      content: m.attributes?.content,
      mine: !!currentUserId && m.sender?.id?.uuid === currentUserId,
    })),
  ]
    .filter(b => b.content)
    .slice(-2);

  const submit = event => {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    onSend(value, { reset: () => setText('') });
  };

  return (
    <section aria-labelledby="message-card-title" className={css.messageCard}>
      <div className={css.messageHead}>
        <CoachPhoto className={css.messagePhoto} image={coachImage} name={coachName} sizes="48px" />
        <h2 id="message-card-title" className={css.messageTitle}>
          <FormattedMessage
            id="BookingConfirmation.messageTitle"
            values={{ name: coachFirstName }}
          />
        </h2>
      </div>

      {bubbles.length > 0 ? (
        <div className={css.bubbles} data-testid="message-bubbles">
          {bubbles.map(b => (
            <div key={b.id} className={classNames(css.bubble, b.mine ? css.mine : css.theirs)}>
              {b.content}
            </div>
          ))}
        </div>
      ) : null}

      <NamedLink name="InboxPage" params={{ tab: 'orders' }} className={css.inboxLink}>
        <FormattedMessage id="BookingConfirmation.wholeConversation" />
      </NamedLink>

      {canSend ? (
        <form className={css.sendRow} onSubmit={submit}>
          <label htmlFor="booking-message" className={css.visuallyHidden}>
            <FormattedMessage id="BookingConfirmation.messageLabel" />
          </label>
          <input
            id="booking-message"
            type="text"
            className={css.sendInput}
            value={text}
            placeholder={intl.formatMessage({ id: 'BookingConfirmation.messagePlaceholder' })}
            onChange={e => setText(e.target.value)}
          />
          <button type="submit" className={css.sendButton} disabled={!text.trim() || sending}>
            <FormattedMessage id="BookingConfirmation.send" />
          </button>
        </form>
      ) : (
        <p className={css.cantSend}>
          <FormattedMessage id="TransactionPanel.sendingMessageNotAllowed" />
        </p>
      )}
      {sendError ? (
        <p className={css.sendError} role="alert">
          <FormattedMessage id="BookingConfirmation.sendFailed" />
        </p>
      ) : null}
    </section>
  );
};

/** The payment box: the session's price, a promo discount if there was one, the total paid. */
export const PaymentBox = ({ sessionPriceText, promoCode, discountText, totalText }) => (
  <section aria-labelledby="payment-title" className={css.payment}>
    <h2 id="payment-title" className={css.paymentTitle}>
      <FormattedMessage id="BookingConfirmation.paymentTitle" />
    </h2>
    {sessionPriceText ? (
      <div className={css.paymentRow}>
        <span>
          <FormattedMessage id="BookingConfirmation.sessionPrice" />
        </span>
        <span data-testid="payment-session">{sessionPriceText}</span>
      </div>
    ) : null}
    {discountText ? (
      <div className={css.paymentRow}>
        <span>
          <FormattedMessage id="CheckoutPage.promo.applied" values={{ code: promoCode || '' }} />
        </span>
        <span data-testid="payment-discount">{discountText}</span>
      </div>
    ) : null}
    <div className={classNames(css.paymentRow, css.paymentTotal)}>
      <b>
        <FormattedMessage id="BookingConfirmation.totalPaid" />
      </b>
      <b data-testid="payment-total">{totalText}</b>
    </div>
  </section>
);

/**
 * What a cancelled session says, by who cancelled and whether the client was charged. 'refunded': the
 * client cancelled early. 'late': the client cancelled inside 48 hours and was charged. 'coach': the
 * coach cancelled, and the client is refunded in full. 'unknown': cancelled, and the outcome is
 * not known yet.
 */
export const CancelledSection = ({ kind, coachFirstName, refundText, listingId, listingTitle }) => {
  const showRefund = kind === 'refunded' || kind === 'coach';
  const againId =
    kind === 'coach' ? 'BookingConfirmation.bookAnotherTime' : 'BookingConfirmation.bookAgain';
  return (
    <section className={css.cancelled} role="status" data-testid="cancelled-section">
      {showRefund ? (
        <h2 className={css.cancelledTitle}>
          <FormattedMessage id="BookingConfirmation.refundTitle" />
        </h2>
      ) : null}
      <p className={css.cancelledText}>
        <FormattedMessage
          id={`BookingConfirmation.cancelled.${kind}`}
          values={{ name: coachFirstName, amount: refundText || '' }}
        />
      </p>
      <div className={css.cancelledActions}>
        <NamedLink
          name="ListingPage"
          params={{ id: listingId, slug: createSlug(listingTitle || '') }}
          className={css.primaryLink}
        >
          <FormattedMessage id={againId} values={{ name: coachFirstName }} />
        </NamedLink>
        <NamedLink name="SearchPage" className={css.outlineLink}>
          <FormattedMessage id="BookingConfirmation.findACoach" />
        </NamedLink>
      </div>
    </section>
  );
};

/**
 * The two states before there is a booking to show: "Confirming your **session…**" (right after
 * paying, a few seconds) and "Uh-oh! That one **didn't go through.**" (the time was taken, or the
 * payment was not finished: not charged, with a way to pick another time).
 */
export const StatePanel = ({ kind, coachFirstName, listingId, listingTitle }) => (
  <section className={css.stateBand} data-testid={`state-${kind}`}>
    <div className={css.stateCard}>
      {kind === 'confirming' ? (
        <>
          <span className={css.stateSpinner} aria-hidden="true">
            <IconSpinner />
          </span>
          <h1 className={css.stateHeading}>
            <FormattedMessage id="BookingConfirmation.confirmingTitle" values={{ b: boldTag }} />
          </h1>
          <p className={css.stateText} role="status">
            <FormattedMessage
              id="BookingConfirmation.confirmingText"
              values={{ name: coachFirstName }}
            />
          </p>
        </>
      ) : (
        <>
          <h1 className={css.stateHeading}>
            <FormattedMessage id="BookingConfirmation.declinedTitle" values={{ b: boldTag }} />
          </h1>
          <p className={css.stateText}>
            <FormattedMessage id="BookingConfirmation.declinedText" />
          </p>
          <NamedLink
            name="ListingPage"
            params={{ id: listingId, slug: createSlug(listingTitle || '') }}
            className={css.lavenderLink}
          >
            <FormattedMessage id="BookingConfirmation.pickAnotherTime" />
          </NamedLink>
        </>
      )}
    </div>
  </section>
);
