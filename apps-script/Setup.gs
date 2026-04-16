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
