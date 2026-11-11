import SessionSetupCard from './SessionSetupCard';

// The setup card a coach sees in the listing page sidebar until both steps are done. When both are
// done OrderPanel does not render it at all, so there is no example for that.

const wrapped = { containerClassName: undefined };

export const NeitherDone = {
  component: SessionSetupCard,
  props: { calendarConnected: false, payoutDetailsSet: false },
  group: 'components',
  ...wrapped,
};

export const CalendarDone = {
  component: SessionSetupCard,
  props: { calendarConnected: true, payoutDetailsSet: false },
  group: 'components',
  ...wrapped,
};

export const PayoutsDone = {
  component: SessionSetupCard,
  props: { calendarConnected: false, payoutDetailsSet: true },
  group: 'components',
  ...wrapped,
};
