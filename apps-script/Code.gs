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
