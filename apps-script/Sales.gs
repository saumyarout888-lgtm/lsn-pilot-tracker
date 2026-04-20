/**
 * Sales.gs — CRUD API for the Sales / Role A tool.
 *
 * Called from src/SalesApp.jsx via the same Apps Script /exec URL the
 * tracker uses. Code.gs routes any POST whose body carries an `action`
 * field here, and any GET with `?action=...`.
 *
 * Auth: requires a `pin` parameter / field matching the ADMIN_PIN script
 * property (default "0000"). This is the same PIN the tracker admin screen
 * uses. Rotate it via Project Settings → Script properties.
 *
 * Actions:
 *   GET  ?action=list&table=Leads&pin=XXXX[&stage=NEW]
 *   GET  ?action=list&table=Outreach&pin=XXXX[&lead_id=LD-XYZ]
 *   GET  ?action=today&pin=XXXX
 *   GET  ?action=metrics&pin=XXXX
 *   POST { action:'upsert',    table:'Leads',    data:{...}, pin:'XXXX' }
 *   POST { action:'delete',    table:'Leads',    id:'LD-XYZ', pin:'XXXX' }
 *   POST { action:'outreach.log', data:{lead_id,type,template,outcome,notes}, pin:'XXXX' }
 *   POST { action:'stage.set', data:{lead_id,stage,next_action,next_action_at,note}, pin:'XXXX' }
 */

const SALES_TABLES = {
  Leads: {
    idField: 'lead_id',
    idPrefix: 'LD-',
    columns: [
      'lead_id', 'created_at', 'updated_at',
      'name', 'company', 'title', 'phone', 'whatsapp', 'email',
      'linkedin_url', 'city', 'source', 'stage', 'owner',
      'estimated_mrr', 'next_action', 'next_action_at',
      'notes', 'status',
    ],
  },
  Outreach: {
    idField: 'touch_id',
    idPrefix: 'TC-',
    columns: [
      'touch_id', 'at', 'lead_id', 'type', 'template',
      'channel', 'outcome', 'notes',
    ],
  },
};

const LEAD_STAGES = [
  'NEW', 'CONTACTED', 'REPLIED', 'MEETING',
  'QUALIFIED', 'PROPOSAL', 'WON', 'LOST', 'DISQUALIFIED',
];
const OPEN_STAGES = new Set(['NEW', 'CONTACTED', 'REPLIED', 'MEETING', 'QUALIFIED', 'PROPOSAL']);

// Tier-A Indian last-mile prospects. Seeded into the Leads tab by
// seedLeadsFromCatalogue() on first setup. Verify each company still exists
// and the target role is current before reaching out — the Indian logistics
// landscape consolidates fast.
const TIER_A_LEADS = [
  // ── quick commerce (very high fit: dense urban, small packages) ─────────
  { company: 'Zepto',              segment: 'quick_commerce', city: 'Mumbai',    title: 'Head of Last Mile' },
  { company: 'Blinkit (Zomato)',   segment: 'quick_commerce', city: 'Gurugram',  title: 'VP Operations' },
  { company: 'Swiggy Instamart',   segment: 'quick_commerce', city: 'Bengaluru', title: 'Head Supply Chain' },
  { company: 'BigBasket / BB Now (Tata)', segment: 'quick_commerce', city: 'Bengaluru', title: 'Head Last Mile' },
  { company: 'Amazon Fresh India', segment: 'quick_commerce', city: 'Bengaluru', title: 'Head Fulfilment' },

  // ── D2C food / daily subscription ───────────────────────────────────────
  { company: 'Licious',            segment: 'd2c_food', city: 'Bengaluru', title: 'VP Supply Chain' },
  { company: 'FreshToHome',        segment: 'd2c_food', city: 'Bengaluru', title: 'Head of Operations' },
  { company: 'Country Delight',    segment: 'd2c_food', city: 'Gurugram',  title: 'Head Operations' },
  { company: 'Supr Daily (Swiggy)',segment: 'd2c_food', city: 'Mumbai',    title: 'Head Operations' },
  { company: 'Milkbasket (Reliance)', segment: 'd2c_food', city: 'Gurugram', title: 'Head Operations' },

  // ── pharma (scheduled routes, small packages) ───────────────────────────
  { company: '1mg (Tata)',         segment: 'pharma', city: 'Gurugram', title: 'Head Last Mile' },
  { company: 'PharmEasy',          segment: 'pharma', city: 'Mumbai',   title: 'Head Logistics' },
  { company: 'Netmeds (Reliance)', segment: 'pharma', city: 'Chennai',  title: 'Head Supply Chain' },
  { company: 'Apollo 24/7',        segment: 'pharma', city: 'Chennai',  title: 'Head Last Mile' },

  // ── e-commerce ──────────────────────────────────────────────────────────
  { company: 'Meesho',             segment: 'ecommerce', city: 'Bengaluru', title: 'Head Last Mile' },
  { company: 'Myntra (Flipkart)',  segment: 'ecommerce', city: 'Bengaluru', title: 'Director Last Mile' },
  { company: 'Nykaa',              segment: 'ecommerce', city: 'Mumbai',    title: 'Head Logistics' },
  { company: 'AJIO (Reliance Retail)', segment: 'ecommerce', city: 'Mumbai', title: 'Head Last Mile' },
  { company: 'FirstCry',           segment: 'ecommerce', city: 'Pune',      title: 'Head Last Mile' },
  { company: 'JioMart',            segment: 'ecommerce', city: 'Mumbai',    title: 'Head E-commerce Logistics' },
  { company: 'Flipkart (Shopsy / Quick)', segment: 'ecommerce', city: 'Bengaluru', title: 'Senior Director, Last Mile' },

  // ── 3PL / co-opetition with Loadshare (pitch as overflow capacity) ──────
  { company: 'Delhivery',          segment: '3pl', city: 'Gurugram',  title: 'Head City Operations' },
  { company: 'Ecom Express',       segment: '3pl', city: 'Gurugram',  title: 'Head Fleet' },
  { company: 'Shadowfax',          segment: '3pl', city: 'Bengaluru', title: 'Head Urban Delivery' },
  { company: 'Xpressbees',         segment: '3pl', city: 'Pune',      title: 'Head Last Mile' },
  { company: 'DTDC',               segment: '3pl', city: 'Bengaluru', title: 'Head City Operations' },

  // ── B2B commerce / kirana replenishment ─────────────────────────────────
  { company: 'Udaan',              segment: 'b2b_commerce', city: 'Bengaluru', title: 'Head Last Mile' },
  { company: 'Jumbotail',          segment: 'b2b_commerce', city: 'Bengaluru', title: 'Head City Operations' },
  { company: 'ElasticRun',         segment: 'b2b_commerce', city: 'Pune',      title: 'Head Operations' },

  // ── hyperlocal ──────────────────────────────────────────────────────────
  { company: 'Porter',             segment: 'hyperlocal', city: 'Bengaluru', title: 'Head of Partnerships' },
];

// ── entry points called from Code.gs ─────────────────────────────────────────
function salesApiGet(e) {
  requireSalesAuth_(e.parameter.pin);
  const action = e.parameter.action;

  if (action === 'list') {
    const table = e.parameter.table;
    if (!table) throw new Error('missing table');
    let rows = readTab_(table);
    if (e.parameter.stage)   rows = rows.filter(r => r.stage === e.parameter.stage);
    if (e.parameter.lead_id) rows = rows.filter(r => r.lead_id === e.parameter.lead_id);
    return rows;
  }
  if (action === 'today')   return listTodayActions_();
  if (action === 'metrics') return weeklyMetrics_();
  if (action === 'stages')  return LEAD_STAGES;
  throw new Error('unknown GET action: ' + action);
}

function salesApiPost(body) {
  requireSalesAuth_(body.pin);
  const { action, table, data, id } = body;
  if (action === 'upsert' && table) return upsertRow_(table, data || {});
  if (action === 'delete' && table) return deleteRow_(table, id);
  if (action === 'outreach.log')    return outreachLog_(data || {});
  if (action === 'stage.set')       return setStage_(data || {});
  throw new Error('unknown POST action: ' + action);
}

// ── handlers ─────────────────────────────────────────────────────────────────
function upsertRow_(table, data) {
  const cfg = SALES_TABLES[table];
  if (!cfg) throw new Error('unknown table: ' + table);
  const sh  = openTab_(table);
  const now = nowIso_();

  if (!data[cfg.idField]) {
    data[cfg.idField] = cfg.idPrefix + Utilities.getUuid().slice(0, 8).toUpperCase();
    if (cfg.columns.indexOf('created_at') >= 0) data.created_at = now;
  }
  if (cfg.columns.indexOf('updated_at') >= 0) data.updated_at = now;

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idColIdx = headers.indexOf(cfg.idField);
  const lastRow  = sh.getLastRow();
  let rowNum = -1;
  if (lastRow > 1) {
    const ids = sh.getRange(2, idColIdx + 1, lastRow - 1, 1).getValues().flat();
    const hit = ids.indexOf(data[cfg.idField]);
    if (hit !== -1) rowNum = hit + 2;
  }

  const rowVals = headers.map(h => (data[h] !== undefined && data[h] !== null ? data[h] : ''));
  if (rowNum === -1) sh.appendRow(rowVals);
  else               sh.getRange(rowNum, 1, 1, headers.length).setValues([rowVals]);

  return { [cfg.idField]: data[cfg.idField] };
}

function deleteRow_(table, id) {
  const cfg = SALES_TABLES[table];
  if (!cfg) throw new Error('unknown table: ' + table);
  if (!id) throw new Error('missing id');
  const sh = openTab_(table);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idColIdx = headers.indexOf(cfg.idField);
  const lastRow  = sh.getLastRow();
  if (lastRow < 2) return { deleted: false };
  const ids = sh.getRange(2, idColIdx + 1, lastRow - 1, 1).getValues().flat();
  const hit = ids.indexOf(id);
  if (hit === -1) return { deleted: false };
  sh.deleteRow(hit + 2);
  return { deleted: true };
}

function outreachLog_(data) {
  if (!data.lead_id) throw new Error('missing lead_id');
  const row = {
    lead_id:  data.lead_id,
    type:     data.type     || '',
    template: data.template || '',
    channel:  data.channel  || '',
    outcome:  data.outcome  || 'SENT',
    notes:    data.notes    || '',
    at:       nowIso_(),
  };
  return upsertRow_('Outreach', row);
}

function setStage_(data) {
  if (!data.lead_id) throw new Error('missing lead_id');
  const leads = readTab_('Leads');
  const lead  = leads.find(l => l.lead_id === data.lead_id);
  if (!lead)  throw new Error('lead not found: ' + data.lead_id);
  if (data.stage && LEAD_STAGES.indexOf(data.stage) === -1) throw new Error('bad stage');
  const patch = { lead_id: data.lead_id, stage: data.stage || lead.stage };
  if (data.next_action)    patch.next_action    = data.next_action;
  if (data.next_action_at) patch.next_action_at = data.next_action_at;
  if (data.note)           patch.notes = (lead.notes ? lead.notes + '\n' : '') + `[${nowIso_().slice(0,10)}] ${data.note}`;
  upsertRow_('Leads', { ...lead, ...patch });
  outreachLog_({
    lead_id: data.lead_id,
    type:    'STAGE_CHANGE',
    outcome: data.stage || lead.stage,
    notes:   data.note || '',
  });
  return { ok: true };
}

function listTodayActions_() {
  const today = nowIso_().slice(0, 10);
  return readTab_('Leads')
    .filter(l => l.next_action_at && String(l.next_action_at).slice(0, 10) <= today)
    .filter(l => OPEN_STAGES.has(l.stage))
    .sort((a, b) => String(a.next_action_at).localeCompare(String(b.next_action_at)));
}

function weeklyMetrics_() {
  const outreach = readTab_('Outreach');
  const leads    = readTab_('Leads');
  const weekAgo  = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const recent   = outreach.filter(r => r.at && String(r.at) >= weekAgo);
  const count = (t) => recent.filter(r => r.type === t).length;
  return {
    leads_total:     leads.length,
    leads_open:      leads.filter(l => OPEN_STAGES.has(l.stage)).length,
    leads_won_7d:    leads.filter(l => l.stage === 'WON'  && String(l.updated_at) >= weekAgo).length,
    leads_lost_7d:   leads.filter(l => l.stage === 'LOST' && String(l.updated_at) >= weekAgo).length,
    li_requests_7d:  count('LI_MSG_1'),
    li_msg2_7d:      count('LI_MSG_2'),
    li_msg3_7d:      count('LI_MSG_3'),
    emails_7d:       count('EMAIL_COLD') + count('EMAIL_FOLLOWUP'),
    calls_7d:        count('CALL'),
    meetings_7d:     leads.filter(l => l.stage === 'MEETING' && String(l.updated_at) >= weekAgo).length,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function openTab_(name) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID script property is not set');
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`missing tab "${name}" — run setupSalesTabs() once`);
  return sh;
}

function requireSalesAuth_(pin) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '0000';
  if (String(pin || '') !== String(expected)) {
    const err = new Error('unauthorized');
    err.code = 401;
    throw err;
  }
}

function nowIso_() {
  return new Date().toISOString();
}
