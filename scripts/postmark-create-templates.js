/**
 * Create Revie's Postmark email templates (session reminders and reschedule confirmations).
 * Run once, by hand:
 *
 *   POSTMARK_SERVER_TOKEN=<the revie-dev server token> node scripts/postmark-create-templates.js
 *
 * (or through `op run --env-file=.env --` if the token is in your .env as an op:// reference.)
 *
 *   --dry-run     check every template with Postmark's own validator, create nothing
 *   --overwrite   replace templates that already exist with the wording in the repo. Without it a
 *                 template that exists is left alone, so wording edited in Postmark is never lost.
 *
 * Each template is validated against a sample model before anything is created or changed; one that
 * Postmark rejects stops the run. Prints template aliases and results only, never the token.
 */

const { TEMPLATES } = require('../server/email/templates');
const { buildSessionEmailModel } = require('../server/api/nylas/sessionEmailModel');

const API = 'https://api.postmarkapp.com';
const token = process.env.POSTMARK_SERVER_TOKEN;
const dryRun = process.argv.includes('--dry-run');
const overwrite = process.argv.includes('--overwrite');

if (!token) {
  console.error('POSTMARK_SERVER_TOKEN is not set.');
  process.exit(1);
}

const call = async (method, path, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'X-Postmark-Server-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
};

// A sample model with every field filled in, so the validator renders each variable.
const sampleModel = recipient =>
  buildSessionEmailModel({
    recipient,
    sessionName: 'Find your focus',
    coachName: 'Sam Coach',
    clientName: 'Alex Client',
    start: '2026-11-20T15:00:00Z',
    end: '2026-11-20T16:00:00Z',
    oldStart: '2026-11-19T10:00:00Z',
    oldEnd: '2026-11-19T11:00:00Z',
    coachTimeZone: 'Europe/London',
    clientTimeZone: null,
    meetLink: 'https://meet.google.com/abc-defg-hij',
    manageUrl: 'https://heyrevie.com/order/example',
  });

(async () => {
  // 1. Validate everything first.
  for (const [alias, t] of Object.entries(TEMPLATES)) {
    const recipient = alias.endsWith('-coach') ? 'coach' : 'client';
    const { status, payload } = await call('POST', '/templates/validate', {
      Subject: t.subject,
      HtmlBody: t.html,
      TextBody: t.text,
      TestRenderModel: sampleModel(recipient),
      InlineCssForHtmlTestRender: true,
    });
    const ok = status === 200 && payload.AllContentIsValid;
    console.log(`${ok ? 'valid  ' : 'INVALID'} ${alias}`);
    if (!ok) {
      const errors = [payload.Subject, payload.HtmlBody, payload.TextBody]
        .flatMap(part => (part && part.ValidationErrors) || [])
        .map(e => `  line ${e.Line}: ${e.Message}`);
      console.error(errors.join('\n') || `  Postmark answered ${status}`);
      process.exit(1);
    }
  }
  if (dryRun) {
    console.log('Dry run: nothing created.');
    return;
  }

  // 2. Create what is missing (and replace only when asked to).
  for (const [alias, t] of Object.entries(TEMPLATES)) {
    const existing = await call('GET', `/templates/${alias}`);
    const body = { Name: t.name, Subject: t.subject, HtmlBody: t.html, TextBody: t.text };
    if (existing.status === 200) {
      if (!overwrite) {
        console.log(`exists  ${alias} (left alone)`);
        continue; // eslint-disable-line no-continue
      }
      const updated = await call('PUT', `/templates/${alias}`, body);
      console.log(`${updated.status === 200 ? 'updated' : 'FAILED '} ${alias}`);
    } else {
      const created = await call('POST', '/templates', {
        ...body,
        Alias: alias,
        TemplateType: 'Standard',
      });
      console.log(`${created.status === 200 ? 'created' : 'FAILED '} ${alias}`);
      if (created.status !== 200) process.exitCode = 1;
    }
  }
})().catch(e => {
  console.error(`Failed: ${e.message}`);
  process.exit(1);
});
