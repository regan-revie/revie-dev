import React from 'react';
import { useField } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { composeValidators } from '../../util/validators';
import {
  OUTCOME_KEYS,
  OUTCOME_MAX_LENGTH,
  outcomeLength,
  outcomeNotTooLong,
  requiredOutcome,
} from '../../util/sessionOutcomes';
import { FieldTextInput } from '../../components';

import css from './SessionOutcomes.module.css';

const EXAMPLE_IDS = [
  'SessionOutcomesField.example1',
  'SessionOutcomesField.example2',
  'SessionOutcomesField.example3',
];

// "34 / 90", turning to a warning colour as the limit gets close.
const CharacterCount = ({ name }) => {
  const { input } = useField(name, { subscription: { value: true } });
  const count = outcomeLength(input.value);
  const nearLimit = count >= OUTCOME_MAX_LENGTH - 10;
  return (
    <p
      className={classNames(css.count, { [css.countNearLimit]: nearLimit })}
      aria-live="off"
      data-testid={`${name}-count`}
    >
      <FormattedMessage
        id="SessionOutcomesField.characterCount"
        values={{ count, max: OUTCOME_MAX_LENGTH }}
      />
    </p>
  );
};

/**
 * Three short "what will your client leave with" fields for the session editor: Outcome 1
 * (required), Outcomes 2 and 3 (optional), each at most 90 characters, with a live character count
 * and Revie's help text and examples. The examples are shown as a list for inspiration, not as
 * placeholders, so no field looks filled in when it is empty.
 *
 * Replaces the three generic custom-field inputs for outcome_1..3 (see EditListingDetailsForm).
 *
 * @param {Object} props
 * @param {string} props.formId prefix for input ids
 * @param {Object} [props.fieldConfigs] Console field configs by key, used only for labels
 */
const SessionOutcomesField = props => {
  const { formId, fieldConfigs = {} } = props;
  const intl = useIntl();

  const requiredMessage = intl.formatMessage({ id: 'SessionOutcomesField.outcomeRequired' });
  const tooLongMessage = intl.formatMessage(
    { id: 'SessionOutcomesField.outcomeTooLong' },
    { max: OUTCOME_MAX_LENGTH }
  );
  const tooLong = outcomeNotTooLong(tooLongMessage);

  return (
    <fieldset className={css.root}>
      <legend className={css.legend}>
        <FormattedMessage id="SessionOutcomesField.legend" />
      </legend>
      <p className={css.helpText}>
        <FormattedMessage id="SessionOutcomesField.helpText" />
      </p>

      {OUTCOME_KEYS.map((key, index) => {
        const name = `pub_${key}`;
        const config = fieldConfigs[key];
        const label =
          config?.saveConfig?.label ||
          config?.label ||
          intl.formatMessage({ id: 'SessionOutcomesField.outcomeLabel' }, { number: index + 1 });
        const isFirst = index === 0;
        return (
          <div key={key} className={css.outcome}>
            <FieldTextInput
              id={formId ? `${formId}.${name}` : name}
              name={name}
              type="text"
              label={label}
              // The browser stops typing at the limit; the validator is the backstop for pasted or
              // previously saved text that is longer.
              maxLength={OUTCOME_MAX_LENGTH}
              validate={
                isFirst ? composeValidators(requiredOutcome(requiredMessage), tooLong) : tooLong
              }
            />
            <CharacterCount name={name} />
          </div>
        );
      })}

      <div className={css.examples}>
        <p className={css.examplesTitle}>
          <FormattedMessage id="SessionOutcomesField.examplesTitle" />
        </p>
        <ul className={css.examplesList}>
          {EXAMPLE_IDS.map(id => (
            <li key={id}>
              <FormattedMessage id={id} />
            </li>
          ))}
        </ul>
      </div>
    </fieldset>
  );
};

export default SessionOutcomesField;
