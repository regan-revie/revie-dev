import React from 'react';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { validPrepLink } from '../../util/prepLink';
import { FieldTextInput } from '../../components';

import css from './PrepLinkField.module.css';

/**
 * The session editor's "Prep link (optional)": a link to the coach's own prep questionnaire. The
 * label comes from the field's Console config; the help line is ours. Checked as a web link, so a
 * client is never sent to a `javascript:` address.
 *
 * @param {Object} props
 * @param {string} props.formId prefix for the input id
 * @param {string} props.name the form field name (`pub_prep_link`)
 * @param {Object} [props.fieldConfig] the Console config (for the label and placeholder)
 */
const PrepLinkField = props => {
  const { formId, name, fieldConfig } = props;
  const intl = useIntl();
  const label =
    fieldConfig?.saveConfig?.label ||
    fieldConfig?.label ||
    intl.formatMessage({ id: 'PrepLinkField.label' });

  return (
    <div className={css.root}>
      <FieldTextInput
        id={formId ? `${formId}.${name}` : name}
        name={name}
        type="text"
        label={label}
        placeholder={
          fieldConfig?.saveConfig?.placeholderMessage ||
          intl.formatMessage({ id: 'PrepLinkField.placeholder' })
        }
        autoComplete="off"
        validate={validPrepLink(intl.formatMessage({ id: 'PrepLinkField.notALink' }))}
      />
      <p className={css.help}>
        <FormattedMessage id="PrepLinkField.help" />
      </p>
    </div>
  );
};

export default PrepLinkField;
