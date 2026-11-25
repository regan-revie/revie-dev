import React from 'react';

import { FormattedMessage } from '../../../util/reactIntl';
import { NamedLink } from '../../../components';
import { IconCancelling } from '../../ListingPage/SessionPage/SessionIcons';

import logoAvatar from '../../../assets/revie-logo-avatar.svg';

import css from './CheckoutChrome.module.css';

/**
 * The checkout's own top bar: the Revie avatar and "Secure checkout" with a lock, and nothing else.
 * No navigation, so there is nowhere to wander off to while paying (docs/design/checkout/).
 */
export const CheckoutTopbar = () => (
  <header className={css.topbar}>
    <NamedLink name="LandingPage" className={css.logo} ariaLabel="Revie home">
      <img src={logoAvatar} alt="Revie" className={css.logoImage} />
    </NamedLink>
    <span className={css.secure}>
      <IconCancelling size={20} />
      <FormattedMessage id="CheckoutPage.secureCheckout" />
    </span>
  </header>
);

/** The one-line footer: who to write to, and the company line. */
export const CheckoutFooter = () => (
  <footer className={css.footer}>
    <span>
      <FormattedMessage id="CheckoutPage.footerQuestions" />{' '}
      <a href="mailto:hello@heyrevie.com">hello@heyrevie.com</a>
    </span>
    <span>
      <FormattedMessage
        id="CheckoutPage.footerCompany"
        values={{ year: new Date().getFullYear() }}
      />
    </span>
  </footer>
);
