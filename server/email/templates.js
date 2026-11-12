/**
 * The Postmark templates for session emails: their aliases and first-draft wording.
 *
 * These are only the starting point. `scripts/postmark-create-templates.js` creates them in Postmark
 * once (it never overwrites one that exists), and from then on the wording is edited in Postmark, so
 * changing copy needs no deploy. The code sends an alias and a model (sessionEmailModel.js), and a
 * test checks that every {{variable}} used below is something the model provides.
 *
 * Postmark template syntax: {{name}} fills a value in (HTML-escaped), {{#name}}...{{/name}} shows a
 * block only when `name` has a value.
 */

const MAROON = '#310416';

const TEMPLATE_ALIASES = {
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
{{#timeZoneNote}}${p('{{timeZoneNote}}')}{{/timeZoneNote}}`;

const meetButton = () =>
  `{{#hasMeetLink}}${button('{{meetLink}}', 'Join on Google Meet')}{{/hasMeetLink}}`;

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
          "Need to move it? Open your booking and choose Reschedule. Cancelling now means you're charged in full, because it's inside 48 hours."
        ),
      ].join('\n')
    ),
    text: `Hi {{recipientName}},

Your session with {{coachName}} is tomorrow.

{{sessionDate}}
{{sessionTime}} ({{timeZoneName}})
{{timeZoneNote}}
{{#hasMeetLink}}
Join on Google Meet: {{meetLink}}
{{/hasMeetLink}}
See your booking: {{manageUrl}}

Need to move it? Open your booking and choose Reschedule. Cancelling now means you're charged in full, because it's inside 48 hours.

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
{{#hasMeetLink}}
Join on Google Meet: {{meetLink}}
{{/hasMeetLink}}
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
        p('Nothing else to do.'),
      ].join('\n')
    ),
    text: `Hi {{recipientName}},

Your session with {{coachName}} has a new time.

{{sessionDate}}
{{sessionTime}} ({{timeZoneName}})
{{timeZoneNote}}

It was {{oldSessionDate}}, {{oldSessionTime}}.
{{#hasMeetLink}}
Join on Google Meet: {{meetLink}}
{{/hasMeetLink}}
See your booking: {{manageUrl}}

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
{{#hasMeetLink}}
Join on Google Meet: {{meetLink}}
{{/hasMeetLink}}
See the booking: {{manageUrl}}

Questions? Reply to this email or write to hello@heyrevie.com.

Revie`,
  },
};

module.exports = { TEMPLATES, TEMPLATE_ALIASES, MAROON };
