import React from 'react';

import { FormattedMessage } from '../../../util/reactIntl';
import {
  LISTING_STATE_CLOSED,
  LISTING_STATE_DRAFT,
  LISTING_STATE_PENDING_APPROVAL,
} from '../../../util/types';
import { NamedLink } from '../../../components';

import css from './SessionNoticeStrip.module.css';

const Strip = ({ messageId, linkId, routeName, routeParams, testId }) => (
  <div className={css.strip} data-testid={testId}>
    <p className={css.text}>
      <FormattedMessage id={messageId} />
    </p>
    {linkId ? (
      <NamedLink name={routeName} params={routeParams} className={css.link}>
        <FormattedMessage id={linkId} />
        <span aria-hidden="true"> →</span>
      </NamedLink>
    ) : null}
  </div>
);

/**
 * The slim strip directly under the topbar that tells the coach she is looking at her own session
 * (and where to edit it), or that a session is closed. Replaces the template's big floating block.
 *
 * Own session: "This is your session." with "Edit session →" ("Finish session →" for a draft). A
 * session waiting for approval or closed says so instead. A closed session shows to everyone else
 * too, without a link. Missing payout details get their own strip with a link to add them.
 */
const SessionNoticeStrip = props => {
  const { mounted, listing, isOwnListing, noPayoutDetailsSetWithOwnListing, editParams } = props;

  // Server-rendered pages and the first browser render show nothing, as the template's bar did.
  if (!mounted || !listing?.id) {
    return null;
  }

  const state = listing.attributes.state;
  const isPendingApproval = state === LISTING_STATE_PENDING_APPROVAL;
  const isClosed = state === LISTING_STATE_CLOSED;
  const isDraft = state === LISTING_STATE_DRAFT;

  if (isOwnListing) {
    const messageId = isPendingApproval
      ? 'SessionNoticeStrip.pendingApproval'
      : isClosed
      ? 'SessionNoticeStrip.closed'
      : isDraft
      ? 'SessionNoticeStrip.draft'
      : 'SessionNoticeStrip.own';
    return (
      <>
        {noPayoutDetailsSetWithOwnListing ? (
          <Strip
            testId="notice-payout"
            messageId="SessionNoticeStrip.payoutMissing"
            linkId="SessionNoticeStrip.addPayout"
            routeName="StripePayoutPage"
          />
        ) : null}
        <Strip
          testId="notice-own"
          messageId={messageId}
          linkId={isDraft ? 'SessionNoticeStrip.finish' : 'SessionNoticeStrip.edit'}
          routeName="EditListingPage"
          routeParams={editParams}
        />
      </>
    );
  }

  return isClosed ? (
    <Strip testId="notice-closed" messageId="SessionNoticeStrip.closedForClients" />
  ) : null;
};

export default SessionNoticeStrip;
