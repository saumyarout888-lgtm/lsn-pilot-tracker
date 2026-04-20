/**
 * WhatsApp.gs — thin wrapper over Meta's WhatsApp Cloud API (graph.facebook.com)
 *
 * Script properties required:
 *   WA_PHONE_NUMBER_ID   e.g. 109876543210987     (from Meta Business Suite)
 *   WA_ACCESS_TOKEN      long-lived token
 *   WA_TEMPLATE_LANG     default 'en' — set to 'en_US' or 'en_GB' if needed
 *
 * Template names must be pre-approved in Meta Business Manager and should
 * match the catalogue in docs/fleet-ops/automation/sla-and-alerts.md:
 *   pilot_shift_reminder, pilot_late_login, pilot_breakdown_ack,
 *   pilot_eod_reminder, pilot_daily_summary, admin_morning_digest,
 *   admin_late_login_escalate, emergency_contact_alert,
 *   vendor_breakdown_alert, buffer_dispatch, client_monthly_invoice.
 *
 * Free-form (non-template) messages only work inside Meta's 24-hour customer
 * service window after the user's last inbound message.
 */

function sendTemplate_(toPhone, templateName, bodyVars) {
  const props = PropertiesService.getScriptProperties();
  const phoneId = props.getProperty('WA_PHONE_NUMBER_ID');
  const token   = props.getProperty('WA_ACCESS_TOKEN');
  const lang    = props.getProperty('WA_TEMPLATE_LANG') || 'en';
  if (!phoneId || !token) {
    console.warn('WhatsApp not configured — skipping send to', toPhone);
    return { skipped: true };
  }

  const body = {
    messaging_product: 'whatsapp',
    to: normalizePhone_(toPhone),
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang },
      components: bodyVars && bodyVars.length ? [{
        type: 'body',
        parameters: bodyVars.map(v => ({ type: 'text', text: String(v) })),
      }] : [],
    },
  };

  try {
    const resp = UrlFetchApp.fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true, id: tryParseId_(resp.getContentText()) };
    console.error('WA send failed', code, resp.getContentText().slice(0, 300));
    return { ok: false, code, error: resp.getContentText().slice(0, 300) };
  } catch (err) {
    console.error('WA send exception', err);
    return { ok: false, error: String(err) };
  }
}

function sendText_(toPhone, text) {
  // Only works in the 24h session window. Use for admin -> admin messages or replies.
  const props   = PropertiesService.getScriptProperties();
  const phoneId = props.getProperty('WA_PHONE_NUMBER_ID');
  const token   = props.getProperty('WA_ACCESS_TOKEN');
  if (!phoneId || !token) return { skipped: true };

  const body = {
    messaging_product: 'whatsapp',
    to: normalizePhone_(toPhone),
    type: 'text',
    text: { body: text },
  };
  const resp = UrlFetchApp.fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  return { ok: resp.getResponseCode() < 300, code: resp.getResponseCode() };
}

function normalizePhone_(p) {
  const s = String(p || '').replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return s.slice(1);     // Meta expects no leading +
  if (s.length === 10)   return '91' + s;       // assume India if 10 digits
  return s;
}

function tryParseId_(body) {
  try { return JSON.parse(body).messages?.[0]?.id ?? null; } catch { return null; }
}
