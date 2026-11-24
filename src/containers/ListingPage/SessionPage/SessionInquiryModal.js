import React from 'react';

import { Modal } from '../../../components';
import InquiryForm from '../InquiryForm/InquiryForm';

import css from '../ListingPage.module.css';

const CONTACT_USER_LINK = 'inquiryModalContactUserLink';

/**
 * The "message the coach" dialog, kept from the template's author section. The redesigned session
 * page has no author section (the coach is in the hero and "Get to know" instead), so this is the
 * dialog on its own: it opens when something calls `onContactUser` (job B adds the "Message {name}"
 * button in the booking panel that does). Signed-out visitors are sent to sign up first, by
 * `handleContactUser`, so the dialog only ever opens for a signed-in client.
 */
const SessionInquiryModal = props => {
  const {
    title,
    authorDisplayName,
    isOpen,
    onClose,
    sendInquiryError,
    sendInquiryInProgress,
    onSubmitInquiry,
    onManageDisableScrolling,
  } = props;

  return (
    <Modal
      id="ListingPage.inquiry"
      contentClassName={css.inquiryModalContent}
      isOpen={isOpen}
      onClose={onClose}
      usePortal
      onManageDisableScrolling={onManageDisableScrolling}
      focusElementId={CONTACT_USER_LINK}
    >
      <InquiryForm
        className={css.inquiryForm}
        submitButtonWrapperClassName={css.inquirySubmitButtonWrapper}
        listingTitle={title}
        authorDisplayName={authorDisplayName}
        sendInquiryError={sendInquiryError}
        onSubmit={onSubmitInquiry}
        inProgress={sendInquiryInProgress}
      />
    </Modal>
  );
};

export default SessionInquiryModal;
