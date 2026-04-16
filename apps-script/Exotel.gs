/**
 * Exotel.gs — click-to-call wrapper using the Connect API.
 *
 * Script properties required:
 *   EXOTEL_SID        your account SID
 *   EXOTEL_TOKEN      API token
 *   EXOTEL_API_KEY    API key (newer Exotel accounts use API key/token pair)
 *   EXOTEL_CALLER_ID  your Exotel virtual number (e.g. 08047091234)
 *   EXOTEL_SUBDOMAIN  'api.exotel.com' (default) or 'api.in.exotel.com'
 *
 * API reference:
 *   POST https://{apikey}:{token}@{subdomain}/v1/Accounts/{sid}/Calls/connect
 * The call connects the "From" number (admin) to the "To" number (pilot) via
 * your virtual number. To auto-dial a pilot directly, set From = CallerId
 * and To = pilot.
 */

function exotelCall_(toPhone, fromPhone) {
  const props = PropertiesService.getScriptProperties();
  const sid       = props.getProperty('EXOTEL_SID');
  const apiKey    = props.getProperty('EXOTEL_API_KEY') || sid;
  const token     = props.getProperty('EXOTEL_TOKEN');
  const caller    = props.getProperty('EXOTEL_CALLER_ID');
  const subdomain = props.getProperty('EXOTEL_SUBDOMAIN') || 'api.exotel.com';
  if (!sid || !token || !caller) {
    console.warn('Exotel not configured — skipping call to', toPhone);
    return { skipped: true };
  }

  const url = `https://${apiKey}:${token}@${subdomain}/v1/Accounts/${sid}/Calls/connect`;
  const payload = {
    From:      normalizeIndian_(fromPhone || caller),
    To:        normalizeIndian_(toPhone),
    CallerId:  caller,
    CallType:  'trans',
    TimeLimit: '120', // seconds
  };
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      payload,                         // x-www-form-urlencoded
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true };
    console.error('Exotel call failed', code, resp.getContentText().slice(0, 300));
    return { ok: false, code, error: resp.getContentText().slice(0, 300) };
  } catch (err) {
    console.error('Exotel call exception', err);
    return { ok: false, error: String(err) };
  }
}

function normalizeIndian_(p) {
  const s = String(p || '').replace(/[^\d+]/g, '');
  if (s.startsWith('+91')) return '0' + s.slice(3);  // Exotel expects 0-prefixed
  if (s.startsWith('91') && s.length === 12) return '0' + s.slice(2);
  if (s.length === 10) return '0' + s;
  return s;
}
