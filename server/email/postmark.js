/**
 * Sending email through Postmark, by hosted template.
 *
 * Only for the emails Sharetribe cannot send: session reminders and reschedule confirmations
 * (server/api/nylas/sessionEmails.js). Booked, cancelled, late-cancelled, payouts and reviews stay
 * with Sharetribe.
 *
 * The wording lives in Postmark, as hosted templates identified by an alias (created once by
 * scripts/postmark-create-templates.js), so it can be edited there without a deploy. The code sends
 * an alias and a model of values to fill in.
 *
 * Sending is OFF unless POSTMARK_SENDING_ENABLED=true, so a deploy never emails anyone by surprise.
 * Nothing here logs an email body, a template model or an address (only its domain).
 */

const API_BASE = 'https://api.postmarkapp.com';

// Revie's own sender. The domain heyrevie.com is verified in Postmark.
const FROM = 'Revie <hello@heyrevie.com>';
const REPLY_TO = 'hello@heyrevie.com';

const token = () => process.env.POSTMARK_SERVER_TOKEN;

const isConfigured = () => Boolean(token());

/** Off by default. Only the exact string "true" turns sending on. */
const isSendingEnabled = () => process.env.POSTMARK_SENDING_ENABLED === 'true';

/** The part of an address after the @, for logs: enough to see who is being emailed, no more. */
const domainOf = address => {
  const at = String(address || '').lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase() : 'unknown';
};

/**
 * Send one email from a hosted template.
 *
 * @param {object} params
 * @param {string} params.to recipient address
 * @param {string} params.templateAlias e.g. 'session-reminder-client'
 * @param {object} params.model values for the template
 * @param {string} [params.tag] Postmark tag, for filtering in their dashboard
 * @param {Function} [params.fetchFn] injected in tests
 * @returns {Promise<{messageId: string}>}
 * @throws an Error with `status` (HTTP) and `postmarkCode` set; its message never contains the
 *   response body, the address or the model.
 */
const sendTemplateEmail = async ({ to, templateAlias, model, tag, fetchFn = fetch }) => {
  if (!isConfigured()) throw new Error('POSTMARK_SERVER_TOKEN is not set');

  const response = await fetchFn(`${API_BASE}/email/withTemplate`, {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': token(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      From: FROM,
      ReplyTo: REPLY_TO,
      To: to,
      TemplateAlias: templateAlias,
      TemplateModel: model,
      MessageStream: 'outbound',
      ...(tag ? { Tag: tag } : {}),
      TrackOpens: false,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  // Postmark answers 200 with ErrorCode 0 on success; anything else is a failure, including a 200
  // that carries an error code.
  if (!response.ok || (payload.ErrorCode !== undefined && payload.ErrorCode !== 0)) {
    const err = new Error(
      `Postmark send failed (HTTP ${response.status}, code ${payload.ErrorCode ??
        'none'}) for template ${templateAlias}`
    );
    err.status = response.status;
    err.postmarkCode = payload.ErrorCode;
    throw err;
  }

  return { messageId: payload.MessageID };
};

module.exports = {
  API_BASE,
  FROM,
  REPLY_TO,
  isConfigured,
  isSendingEnabled,
  domainOf,
  sendTemplateEmail,
};
