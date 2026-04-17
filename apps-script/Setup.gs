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

  setupSalesTabs();
}

function setupSalesTabs() {
  const props   = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Set SHEET_ID script property first');
  const ss = SpreadsheetApp.openById(sheetId);

  ensureTab_(ss, 'Leads', SALES_TABLES.Leads.columns, []);
  ensureTab_(ss, 'Outreach', SALES_TABLES.Outreach.columns, []);

  // Seed ADMIN_PIN script property to "0000" if not set, so the sales API
  // works out of the box. The user rotates it via Script properties.
  if (!props.getProperty('ADMIN_PIN')) props.setProperty('ADMIN_PIN', '0000');

  seedLeadsFromCatalogue();
}

/**
 * Imports the ~30 tier-A prospects from TIER_A_LEADS (in Sales.gs) into
 * the Leads tab. Safe to re-run — skips silently if the tab already has
 * any rows beyond the header. Call with {force:true} to re-seed anyway
 * (existing rows are not deleted; only missing companies are added).
 */
function seedLeadsFromCatalogue(opts) {
  const force   = opts && opts.force;
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Set SHEET_ID script property first');
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName('Leads');
  if (!sh) throw new Error('Leads tab missing — run setupSalesTabs() first');

  const lastRow = sh.getLastRow();
  if (!force && lastRow > 1) {
    console.log('Leads tab already has ' + (lastRow - 1) + ' rows — skipping seed.');
    return { seeded: 0, skipped: true };
  }

  const existingCompanies = new Set(
    lastRow > 1
      ? sh.getRange(2, (SALES_TABLES.Leads.columns.indexOf('company') + 1), lastRow - 1, 1)
          .getValues().flat().filter(Boolean)
      : []
  );

  let added = 0;
  TIER_A_LEADS.forEach(row => {
    if (existingCompanies.has(row.company)) return;
    upsertRow_('Leads', {
      company: row.company,
      title:   row.title,
      city:    row.city,
      source:  'seed-tierA',
      stage:   'NEW',
      status:  'Active',
      notes:   `segment: ${row.segment}. Seeded from fleet-ops catalogue (training data: Jan 2026). ` +
               `Verify company + role via LinkedIn before first outreach. ` +
               (row.segment === '3pl'
                 ? 'NOTE: co-opetition with Loadshare — pitch as overflow/peak capacity.'
                 : ''),
    });
    added++;
  });
  console.log(`Seeded ${added} tier-A prospects into Leads tab.`);
  return { seeded: added, skipped: false };
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
