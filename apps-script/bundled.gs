/**
 * LSN Fleet Ops — Apps Script, single-file bundle.
 *
 * Merged from: Code.gs, Alerts.gs, WhatsApp.gs, Exotel.gs, Setup.gs.
 * Paste this whole file into Apps Script if you do not want to manage
 * five separate files. See apps-script/SETUP.md for the 5-minute path.
 */


// ════════════════════════════════════════════════════════════════════════════
// apps-script/Code.gs
// ════════════════════════════════════════════════════════════════════════════

/**
 * LSN Pilot Tracker — Apps Script webhook
 *
 * Receives POSTs from src/DmartTracker.jsx (the `postSheet(data)` call),
 * appends the row to the "Attendance" sheet, AND forwards the raw payload
 * to the Supabase `attendance-ingest` edge function.
 *
 * Supabase is the secondary sink — if it's unavailable the Sheet still gets
 * the row, so the tracker UI is never blocked.
 *
 * Configure via Project Settings → Script Properties:
 *   SHEET_ID              Spreadsheet ID to append rows to
 *   SHEET_NAME            Tab name (default: "Attendance")
 *   SUPABASE_FUNCTION_URL https://<ref>.supabase.co/functions/v1/attendance-ingest
 *   INGEST_SHARED_TOKEN   Same value set via `supabase secrets set`
 *
 * Deploy → New deployment → Web app → Execute as: "Me", access: "Anyone".
 * Copy the resulting URL into src/DmartTracker.jsx → SHEET_URL.
 */

const DEFAULT_SHEET_NAME = 'Attendance';

// Columns appended to the Sheet (union of LOGIN + LOGOUT payload keys).
// Order is stable so the Sheet can be formatted / filtered predictably.
const COLUMNS = [
  'received_at', 'status', 'date',
  'vid', 'vehicleId', 'type',
  'driver', 'driverName', 'da', 'daName',
  'start', 'shiftStart', 'end', 'shiftEnd',
  'driverPresent', 'daPresent',
  'parcels', 'mgTarget', 'mgMet',
  'charging', 'notes',
  'supabase_status', 'supabase_error',
];

function doPost(e) {
  let payload = {};
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: 'invalid json' });
  }

  const supabaseResult = forwardToSupabase_(payload);

  try {
    appendToSheet_(payload, supabaseResult);
  } catch (err) {
    // Log but don't fail the webhook — the tracker uses mode: 'no-cors'
    // and ignores the body anyway, but we'd rather keep Supabase in sync.
    console.error('sheet append failed:', err);
  }

  return jsonOut({ ok: true, supabase: supabaseResult });
}

function doGet() {
  return jsonOut({ ok: true, service: 'lsn-pilot-tracker-webhook' });
}

// ── Sheet append ──────────────────────────────────────────────────────────────
function appendToSheet_(payload, supabaseResult) {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('SHEET_ID');
  const sheetName = props.getProperty('SHEET_NAME') || DEFAULT_SHEET_NAME;
  if (!sheetId) throw new Error('SHEET_ID script property is not set');

  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    sheet.setFrozenRows(1);
  }

  const row = COLUMNS.map((col) => {
    if (col === 'received_at')     return new Date();
    if (col === 'supabase_status') return supabaseResult.status || '';
    if (col === 'supabase_error')  return supabaseResult.error  || '';
    const v = payload[col];
    return v === undefined || v === null ? '' : v;
  });
  sheet.appendRow(row);
}

// ── Supabase forward ──────────────────────────────────────────────────────────
function forwardToSupabase_(payload) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_FUNCTION_URL');
  const token = props.getProperty('INGEST_SHARED_TOKEN');
  if (!url || !token) return { status: 'skipped', error: 'not configured' };

  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code >= 200 && code < 300) return { status: code };
    return { status: code, error: body.slice(0, 500) };
  } catch (err) {
    return { status: 'network', error: String(err).slice(0, 500) };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════════════════════════════════
// apps-script/Alerts.gs
// ════════════════════════════════════════════════════════════════════════════

/**
 * Alerts.gs — time-triggered SLA workflows (all run on the existing Sheet)
 *
 * Install once: run setupTriggers() from Setup.gs. Triggers:
 *   07:45  onMorningDigest      — digest WA to admin
 *   every 5 min  onLateLoginCheck — self-gates to 07:55..09:30 IST
 *   20:00  onEodReminder        — "still on shift?" to pilots with no logout
 *   22:00  onDailySummary       — per-pilot WA summary for today
 *
 * Data model (sheet tabs):
 *   Attendance  — auto-filled by the tracker webhook (Code.gs)
 *   Roster      — admin-maintained: empId, name, phone, emergency_phone,
 *                 vehicle_code, hub_name, shift_start (HH:mm), shift_end, status
 *   Config      — admin-maintained: key, value (grace_min, admin_wa, etc.)
 *   AlertLog    — auto-filled: at, type, pilot, channel, template, to, status, error
 */

function onMorningDigest() {
  const today    = fmtDate_(new Date());
  const yday     = fmtDate_(new Date(Date.now() - 24 * 3600 * 1000));
  const attend   = readTab_('Attendance');
  const roster   = readTab_('Roster').filter(r => (r.status || 'Active') === 'Active');
  const grace    = +getConfig_('grace_min', 10);
  const adminWa  = getConfig_('admin_wa');

  if (!adminWa) { logAlert_('morning_digest', null, 'skipped', 'admin_wa not set'); return; }

  const ydayLogins = attend.filter(r => r.date === yday && r.status === 'Active');
  const lateYday = ydayLogins.filter(r => {
    const pilot = roster.find(p => p.vehicle_code === (r.vid || r.vehicleId));
    if (!pilot || !pilot.shift_start) return false;
    return minsBetween_(pilot.shift_start, r.start) > grace;
  }).length;

  const ydayLogouts = attend.filter(r => r.date === yday && r.status === 'Complete').length;
  const missingLogouts = ydayLogins.length - ydayLogouts;

  const risk = [];
  roster.forEach(p => {
    if (!p.shift_start) return;
    const pilotToday = attend.find(r =>
      r.date === today && (r.vid || r.vehicleId) === p.vehicle_code && r.status === 'Active'
    );
    if (!pilotToday) risk.push(p.empId);
  });

  sendTemplate_(adminWa, 'admin_morning_digest', [
    String(ydayLogins.length),
    String(lateYday),
    String(missingLogouts),
    risk.length ? risk.join(', ') : 'none',
  ]);
}

function onLateLoginCheck() {
  const now  = new Date();
  const h    = +Utilities.formatDate(now, 'Asia/Kolkata', 'HH');
  const m    = +Utilities.formatDate(now, 'Asia/Kolkata', 'mm');
  const mins = h * 60 + m;
  if (mins < 7 * 60 + 55 || mins > 9 * 60 + 30) return; // self-gate

  const today   = fmtDate_(now);
  const attend  = readTab_('Attendance');
  const roster  = readTab_('Roster').filter(r => (r.status || 'Active') === 'Active');
  const grace   = +getConfig_('grace_min', 10);
  const adminWa = getConfig_('admin_wa');

  roster.forEach(p => {
    if (!p.shift_start || !p.phone) return;
    const shiftMins = hhmmToMins_(p.shift_start);
    const minsLate  = mins - (shiftMins + grace);
    if (minsLate < 0) return;

    const alreadyIn = attend.some(r =>
      r.date === today && (r.vid || r.vehicleId) === p.vehicle_code && r.status === 'Active'
    );
    if (alreadyIn) return;

    // de-dupe: don't resend same tier within 25 min
    const tier = minsLate < 30 ? 'T1' : minsLate < 45 ? 'T2' : 'T3';
    if (alreadyAlerted_(p.empId, 'late_login_' + tier, 25)) return;

    if (tier === 'T1') {
      sendTemplate_(p.phone, 'pilot_late_login', [p.name || p.empId, String(minsLate)]);
      logAlert_('late_login_T1', p.empId, 'WA', p.phone, 'pilot_late_login');
    } else if (tier === 'T2') {
      sendTemplate_(p.phone, 'pilot_late_login', [p.name || p.empId, String(minsLate)]);
      if (adminWa) sendTemplate_(adminWa, 'admin_late_login_escalate',
        [p.empId, String(minsLate), p.vehicle_code]);
      exotelCall_(p.phone); // auto-call pilot
      logAlert_('late_login_T2', p.empId, 'WA+CALL', p.phone, 'pilot_late_login');
    } else {
      if (p.emergency_phone) sendTemplate_(p.emergency_phone, 'emergency_contact_alert',
        [p.name || p.empId, String(minsLate)]);
      if (adminWa) sendTemplate_(adminWa, 'admin_late_login_escalate',
        [p.empId, String(minsLate), p.vehicle_code]);
      exotelCall_(p.phone);
      logAlert_('late_login_T3', p.empId, 'WA+CALL+EMERGENCY', p.phone, 'late_login_T3');
    }
  });
}

function onEodReminder() {
  const today  = fmtDate_(new Date());
  const attend = readTab_('Attendance');
  const roster = readTab_('Roster');

  roster.forEach(p => {
    if (!p.phone) return;
    const login  = attend.find(r => r.date === today && (r.vid || r.vehicleId) === p.vehicle_code && r.status === 'Active');
    const logout = attend.find(r => r.date === today && (r.vid || r.vehicleId) === p.vehicle_code && r.status === 'Complete');
    if (login && !logout) {
      if (alreadyAlerted_(p.empId, 'eod_reminder', 120)) return;
      sendTemplate_(p.phone, 'pilot_eod_reminder', [p.name || p.empId]);
      logAlert_('eod_reminder', p.empId, 'WA', p.phone, 'pilot_eod_reminder');
    }
  });
}

function onDailySummary() {
  const today  = fmtDate_(new Date());
  const attend = readTab_('Attendance');
  const roster = readTab_('Roster');

  roster.forEach(p => {
    if (!p.phone) return;
    const login  = attend.find(r => r.date === today && (r.vid || r.vehicleId) === p.vehicle_code && r.status === 'Active');
    const logout = attend.find(r => r.date === today && (r.vid || r.vehicleId) === p.vehicle_code && r.status === 'Complete');
    if (!login) return;
    const hours   = logout ? minsBetween_(login.start, logout.shiftEnd) / 60 : null;
    const parcels = logout ? (logout.parcels || '0') : 'pending';
    sendTemplate_(p.phone, 'pilot_daily_summary',
      [p.name || p.empId, String(parcels), hours ? hours.toFixed(1) : '—']);
    logAlert_('daily_summary', p.empId, 'WA', p.phone, 'pilot_daily_summary');
  });
}

// ── helpers (sheet + time) ────────────────────────────────────────────────────
function readTab_(name) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const [headers, ...rows] = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [String(h), r[i]])));
}

function getConfig_(key, fallback) {
  const cfg = readTab_('Config');
  const row = cfg.find(r => r.key === key);
  return row && row.value !== '' ? row.value : fallback;
}

function logAlert_(type, pilot, channelOrStatus, toOrError, template) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  let sh = ss.getSheetByName('AlertLog');
  if (!sh) {
    sh = ss.insertSheet('AlertLog');
    sh.appendRow(['at', 'type', 'pilot_empId', 'channel', 'template', 'to', 'status', 'error']);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), type, pilot || '', channelOrStatus || '', template || '', toOrError || '', 'logged', '']);
}

function alreadyAlerted_(pilotEmpId, type, withinMin) {
  const log = readTab_('AlertLog');
  const cutoff = Date.now() - withinMin * 60 * 1000;
  return log.some(r => r.pilot_empId === pilotEmpId && r.type === type && new Date(r.at).getTime() > cutoff);
}

function fmtDate_(d) {
  return Utilities.formatDate(d, 'Asia/Kolkata', 'dd-MMM-yyyy');
}

function hhmmToMins_(s) {
  if (!s) return 0;
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
}

function minsBetween_(a, b) {
  return hhmmToMins_(b) - hhmmToMins_(a);
}

// ════════════════════════════════════════════════════════════════════════════
// apps-script/WhatsApp.gs
// ════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════
// apps-script/Exotel.gs
// ════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════
// apps-script/Setup.gs
// ════════════════════════════════════════════════════════════════════════════

/**
 * Setup.gs — run these functions from the Apps Script editor manually, once.
 *
 *   setupSheetTabs()  -> creates Roster, Config, AlertLog tabs with headers
 *   setupTriggers()   -> installs the 4 time triggers for alerts
 *   deleteAllTriggers() -> nuke option
 */

function setupSheetTabs() {
  const props   = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Set SHEET_ID script property first');
  const ss = SpreadsheetApp.openById(sheetId);

  ensureTab_(ss, 'Roster', [
    'empId', 'name', 'role', 'phone', 'emergency_phone',
    'vehicle_code', 'hub_name', 'shift_start', 'shift_end', 'status',
  ], [
    ['DRV-01', '', 'DRIVER', '', '', 'VH-01', 'Pilot Hub', '08:00', '20:00', 'Active'],
    ['DRV-02', '', 'DRIVER', '', '', 'VH-02', 'Pilot Hub', '08:00', '20:00', 'Active'],
    ['DRV-03', '', 'DRIVER', '', '', 'VH-03', 'Pilot Hub', '08:00', '20:00', 'Active'],
    ['DRV-04', '', 'DRIVER', '', '', 'VH-04', 'Pilot Hub', '08:00', '20:00', 'Active'],
    ['DRV-05', '', 'DRIVER', '', '', 'VH-05', 'Pilot Hub', '08:00', '20:00', 'Active'],
  ]);

  ensureTab_(ss, 'Config', ['key', 'value'], [
    ['grace_min',          10],
    ['on_time_target_pct', 95],
    ['idle_min',           120],
    ['admin_wa',           ''],
    ['admin_phone',        ''],
    ['agency_name',        'LSN'],
  ]);

  ensureTab_(ss, 'AlertLog', ['at', 'type', 'pilot_empId', 'channel', 'template', 'to', 'status', 'error'], []);
}

function setupTriggers() {
  deleteAllTriggers();
  ScriptApp.newTrigger('onMorningDigest').timeBased().atHour(7).nearMinute(45).everyDays(1).inTimezone('Asia/Kolkata').create();
  ScriptApp.newTrigger('onLateLoginCheck').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('onEodReminder').timeBased().atHour(20).nearMinute(0).everyDays(1).inTimezone('Asia/Kolkata').create();
  ScriptApp.newTrigger('onDailySummary').timeBased().atHour(22).nearMinute(0).everyDays(1).inTimezone('Asia/Kolkata').create();
  console.log('Installed triggers:', ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()));
}

function deleteAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
}

function ensureTab_(ss, name, headers, seedRows) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    if (seedRows.length) sh.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    if (seedRows.length) sh.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
  }
}
