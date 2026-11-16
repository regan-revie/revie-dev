/**
 * The answer both client actions (cancel and reschedule) give while the coach's deletion of the
 * session's calendar event is in its five-minute wait: the session is about to be cancelled and the
 * client refunded in full, so the client may neither move it nor cancel it.
 *
 * Cancelling is refused for a money reason, not only a tidy one: a client cancelling inside 48 hours
 * would be recorded as the canceller (`cancelRequestedBy`) and take the late-cancellation path -
 * charged in full - for something the coach did. The refusal comes before that note is written.
 */

const COACH_CANCELLING = {
  code: 'being-cancelled-by-coach',
  error: "This session is being cancelled by the coach. You'll get a full refund.",
};

module.exports = { COACH_CANCELLING };
