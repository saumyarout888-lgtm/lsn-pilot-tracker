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
