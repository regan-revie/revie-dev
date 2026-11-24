/**
 * The Postmark templates for session emails: their aliases and first-draft wording.
 *
 * These are only the starting point. `scripts/postmark-create-templates.js` creates them in Postmark
 * once (it never overwrites one that exists), and from then on the wording is edited in Postmark, so
 * changing copy needs no deploy. The code sends an alias and a model (sessionEmailModel.js), and a
 * test checks that every {{variable}} used below is something the model provides.
 *
 * **A section changes scope.** Inside {{#name}}...{{/name}}, a variable is looked up in the section's
 * own value, not in the rest of the model, so {{#hasTotalPaid}}Total paid: {{totalPaid}}{{/hasTotalPaid}}
 * shows "Total paid: " and nothing else (a blank that reached a real email). To show a value only when
 * it exists, make the section the value itself and print it with {{.}}: {{#totalPaid}}Total paid: {{.}}{{/totalPaid}}.
 * A section with no variables inside it (a plain true/false flag) is fine. A test enforces this.
 *
 * Postmark template syntax: {{name}} fills a value in (HTML-escaped), {{#name}}...{{/name}} shows a
 * block only when `name` has a value.
 */

const MAROON = '#310416';

const TEMPLATE_ALIASES = {
  'reminder60-client': 'session-reminder-60h-client',
  'confirmed-client': 'booking-confirmed-client',
  'reminder-client': 'session-reminder-client',
  'reminder-coach': 'session-reminder-coach',
  'rescheduled-client': 'session-rescheduled-client',
  'rescheduled-coach': 'session-rescheduled-coach',
};

const button = (href, label) =>
  `<p style="margin:0 0 12px 0"><a href="${href}" target="_blank" style="display:inline-block;background-color:${MAROON};color:#ffffff;font-size:15px;font-weight:600;line-height:1;text-decoration:none;padding:15px 28px;border-radius:4px">${label}</a></p>`;

const p = text =>
  `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;color:${MAROON}">${text}</p>`;

const when = (dateVar, timeVar) =>
  `<p style="margin:0 0 4px 0;font-size:20px;font-weight:700;line-height:1.3;color:${MAROON}">{{${dateVar}}}</p>
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;color:${MAROON}">{{${timeVar}}} ({{timeZoneName}})</p>
{{#timeZoneNote}}${p('{{.}}')}{{/timeZoneNote}}`;

const calendarButton = () =>
  `{{#calendarUrl}}${button('{{.}}', 'Add to calendar')}{{/calendarUrl}}`;

// The refund rule in one line. Two sections rather than a section and its opposite.
const policyLine = () =>
  `{{#freeUntilOpen}}${p(
    "Free to cancel or move until {{.}}. After that, it's charged in full."
  )}{{/freeUntilOpen}}{{#freeWindowClosed}}${p(
    "This session is less than 48 hours away, so it can't be moved. If you cancel now, you'll be charged in full."
  )}{{/freeWindowClosed}}`;

// Small print under the buttons.
const small = text =>
  `<p style="margin:0 0 12px 0;font-size:13px;line-height:1.5;color:#6b5560">${text}</p>`;

const meetButton = () => `{{#meetLink}}${button('{{.}}', 'Join on Google Meet')}{{/meetLink}}`;

const layout = body => `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background-color:#ffffff">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:left">
<tr><td style="padding:0 0 24px 0;font-size:24px;font-weight:700;color:${MAROON}">Revie</td></tr>
<tr><td>
${body}
</td></tr>
<tr><td style="padding:24px 0 0 0;font-size:13px;line-height:1.5;color:#6b5560">Questions? Reply to this email or write to hello@heyrevie.com.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const TEMPLATES = {
  // Not a session email, so not in TEMPLATE_ALIASES: it is sent once when a coach's Google Calendar
  // connection stops working (server/api/nylas/grantStatus.js), with its own small model
  // (reconnectEmailModel.js: recipientName, reconnectUrl).
  'calendar-reconnect-coach': {
    name: 'Reconnect your calendar (coach)',
    subject: 'Reconnect your calendar to keep taking bookings',
    html: layout(
      [
        p('Hi {{recipientName}},'),
        p('Your Google Calendar connection stopped working.'),
        p(
          "Until you reconnect, clients can't book you. Your sessions show \"This coach isn't taking bookings yet\". Sessions that are already booked aren't affected."
        ),
        button('{{reconnectUrl}}', 'Reconnect calendar'),
        small('It takes about a minute, and your sessions open for booking again right away.'),
      ].join('\n')
    ),
    text: `Hi {{recipientName}},

Your Google Calendar connection stopped working.

Until you reconnect, clients can't book you. Your sessions show "This coach isn't taking bookings yet". Sessions that are already booked aren't affected.

Reconnect calendar: {{reconnectUrl}}

It takes about a minute, and your sessions open for booking again right away.

Questions? Reply to this email or write to hello@heyrevie.com.

Revie`,
  },

  'booking-confirmed-client': {
    name: "You're booked (client)",
    subject: "You're booked: {{sessionName}} with {{coachName}}",
    html: layout(
      [
        p('Hi {{recipientName}},'),
        p("You're booked. Your session with {{coachName}} is confirmed."),
        when('sessionDate', 'sessionTime'),
        p('{{lengthText}}'),
        meetButton(),
        calendarButton(),
        button('{{manageUrl}}', 'See your booking'),
        small("Using Google Calendar? It's already there."),
        small('Apple Calendar or Outlook? Tap Add to calendar.'),
        `{{#fullPriceText}}${p('{{.}}')}{{/fullPriceText}}`,
        `{{#discountText}}${p('{{.}}')}{{/discountText}}`,
        `{{#totalPaid}}${p('Total paid: {{.}}')}{{/totalPaid}}`,
        policyLine(),
      ].join('\n')
    ),
    text: `Hi {{recipientName}},

You're booked. Your session with {{coachName}} is confirmed.

{{sessionDate}}
{{sessionTime}} ({{timeZoneName}})
{{timeZoneNote}}
{{lengthText}}
{{#meetLink}}
Join on Google Meet: {{{.}}}
{{/meetLink}}
{{#calendarUrl}}
Add to calendar: {{{.}}}
{{/calendarUrl}}
See your booking: {{manageUrl}}

Using Google Calendar? It's already there.
Apple Calendar or Outlook? Tap Add to calendar.
{{#fullPriceText}}

{{.}}
{{/fullPriceText}}
{{#discountText}}
{{.}}
{{/discountText}}
{{#totalPaid}}

Total paid: {{.}}
{{/totalPaid}}

{{#freeUntilOpen}}
Free to cancel or move until {{.}}. After that, it's charged in full.
{{/freeUntilOpen}}
{{#freeWindowClosed}}
This session is less than 48 hours away, so it can't be moved. If you cancel now, you'll be charged in full.
{{/freeWindowClosed}}

Questions? Reply to this email or write to hello@heyrevie.com.

Revie`,
  },

  'session-reminder-60h-client': {
    name: 'Session reminder, 60 hours (client)',
    subject: 'Coming up: {{sessionName}} with {{coachName}}',
    html: layout(
      [
        p('Hi {{recipientName}},'),
        p(
          'Your session with {{coachName}} is on {{sessionDate}}, {{sessionTime}} ({{timeZoneName}}).'
        ),
        `{{#timeZoneNote}}${p('{{.}}')}{{/timeZoneNote}}`,
        `{{#freeUntilOpen}}${p(
          "Free to cancel or move until {{.}}. After that, it's charged in full."
        )}{{/freeUntilOpen}}`,
        button('{{manageUrl}}', 'See your booking'),
      ].join('\n')
    ),
    text: `Hi {{recipientName}},

Your session with {{coachName}} is on {{sessionDate}}, {{sessionTime}} ({{timeZoneName}}).
{{timeZoneNote}}
{{#freeUntilOpen}}
Free to cancel or move until {{.}}. After that, it's charged in full.
{{/freeUntilOpen}}

See your booking: {{manageUrl}}

Questions? Reply to this email or write to hello@heyrevie.com.

Revie`,
  },

  'session-reminder-client': {
    name: 'Session reminder (client)',
    subject: 'Tomorrow: {{sessionName}} with {{coachName}}',
    html: layout(
      [
        p('Hi {{recipientName}},'),
        p('Your session with {{coachName}} is tomorrow.'),
        when('sessionDate', 'sessionTime'),
        meetButton(),
        button('{{manageUrl}}', 'See your booking'),
        p(
          "This session is less than 48 hours away, so it can't be moved. If you cancel now, you'll be charged in full."
        ),
      ].join('\n')
    ),
    text: `Hi {{recipientName}},

Your session with {{coachName}} is tomorrow.

{{sessionDate}}
{{sessionTime}} ({{timeZoneName}})
{{timeZoneNote}}
{{#meetLink}}
Join on Google Meet: {{{.}}}
{{/meetLink}}
See your booking: {{manageUrl}}

This session is less than 48 hours away, so it can't be moved. If you cancel now, you'll be charged in full.

Questions? Reply to this email or write to hello@heyrevie.com.

Revie`,
  },

  'session-reminder-coach': {
    name: 'Session reminder (coach)',
    subject: 'Tomorrow: {{sessionName}} with {{clientName}}',
    html: layout(
      [
        p('Hi {{recipientName}},'),
        p("{{clientName}} is booked in with you tomorrow. It's already on your calendar."),
        when('sessionDate', 'sessionTime'),
        meetButton(),
        button('{{manageUrl}}', 'See the booking'),
      ].join('\n')
    ),
    text: `Hi {{recipientName}},

{{clientName}} is booked in with you tomorrow. It's already on your calendar.

{{sessionDate}}
{{sessionTime}} ({{timeZoneName}})
{{timeZoneNote}}
{{#meetLink}}
Join on Google Meet: {{{.}}}
{{/meetLink}}
See the booking: {{manageUrl}}

Questions? Reply to this email or write to hello@heyrevie.com.

Revie`,
  },

  'session-rescheduled-client': {
    name: 'Session rescheduled (client)',
    subject: 'Your session has moved to {{sessionDate}}',
    html: layout(
      [
        p('Hi {{recipientName}},'),
        p('Your session with {{coachName}} has a new time.'),
        when('sessionDate', 'sessionTime'),
        p('It was {{oldSessionDate}}, {{oldSessionTime}}.'),
        meetButton(),
        button('{{manageUrl}}', 'See your booking'),
        small("Using Google Calendar? It's already moved."),
        small('Apple Calendar or another app? Open the attached calendar file to update it.'),
        policyLine(),
        p('Nothing else to do.'),
      ].join('\n')
    ),
    text: `Hi {{recipientName}},

Your session with {{coachName}} has a new time.

{{sessionDate}}
{{sessionTime}} ({{timeZoneName}})
{{timeZoneNote}}

It was {{oldSessionDate}}, {{oldSessionTime}}.
{{#meetLink}}
Join on Google Meet: {{{.}}}
{{/meetLink}}
See your booking: {{manageUrl}}

Using Google Calendar? It's already moved.
Apple Calendar or another app? Open the attached calendar file to update it.

{{#freeUntilOpen}}
Free to cancel or move until {{.}}. After that, it's charged in full.
{{/freeUntilOpen}}
{{#freeWindowClosed}}
This session is less than 48 hours away, so it can't be moved. If you cancel now, you'll be charged in full.
{{/freeWindowClosed}}

Nothing else to do.

Questions? Reply to this email or write to hello@heyrevie.com.

Revie`,
  },

  'session-rescheduled-coach': {
    name: 'Session rescheduled (coach)',
    subject: 'Your session with {{clientName}} has moved',
    html: layout(
      [
        p('Hi {{recipientName}},'),
        p('Your session with {{clientName}} has a new time. Your calendar has it already.'),
        when('sessionDate', 'sessionTime'),
        p('It was {{oldSessionDate}}, {{oldSessionTime}}.'),
        meetButton(),
        button('{{manageUrl}}', 'See the booking'),
      ].join('\n')
    ),
    text: `Hi {{recipientName}},

Your session with {{clientName}} has a new time. Your calendar has it already.

{{sessionDate}}
{{sessionTime}} ({{timeZoneName}})
{{timeZoneNote}}

It was {{oldSessionDate}}, {{oldSessionTime}}.
{{#meetLink}}
Join on Google Meet: {{{.}}}
{{/meetLink}}
See the booking: {{manageUrl}}

Questions? Reply to this email or write to hello@heyrevie.com.

Revie`,
  },
};

module.exports = { TEMPLATES, TEMPLATE_ALIASES, MAROON };
