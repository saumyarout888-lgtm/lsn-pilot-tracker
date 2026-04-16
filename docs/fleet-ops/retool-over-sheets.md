# Retool over Google Sheets — 8 AM Dashboard

The `dashboard-8am.md` spec, running directly on the Sheet. No Supabase.
Use this path while you're still on Sheets-first; when/if you later flip
to Supabase, only the data resource changes — the transforms stay.

## Setup (15 min)

1. Google Cloud Console → create a **service account** → create JSON key.
2. Share your attendance Sheet with the service-account email (Viewer).
3. Retool → **Resources → Create new → Google Sheets → Service-account JSON** → paste.
4. Retool → **Create app** → name it "LSN 8 AM".

## Queries (all read-only)

Create these queries against the Sheets resource, one per tab:

| Query | Sheet tab | Purpose |
|---|---|---|
| `q_attendance` | `Attendance` | today + yesterday rows |
| `q_roster` | `Roster` | active pilots with phones + shift times |
| `q_config` | `Config` | thresholds (`grace_min`, `on_time_target_pct`, etc.) |
| `q_alerts` | `AlertLog` | last 24h of fired alerts |

Add filter inputs on each query where possible (e.g. `date = {{ moment().format('DD-MMM-YYYY') }}`) to keep reads small.

## Transforms → tiles

Put each tile's data in a Retool JS transform so the Sheet schema is the
only thing that changes if you later migrate.

### Tile 1 — Shift Risk (who hasn't logged in yet)

```javascript
// Transform input: {{ q_attendance.data }}, {{ q_roster.data }}, {{ q_config.data }}
const today   = moment().format('DD-MMM-YYYY');
const nowMin  = moment().hours() * 60 + moment().minutes();
const grace   = Number((q_config.data.find(r => r.key === 'grace_min') || {}).value) || 10;

const loggedIn = new Set(
  q_attendance.data
    .filter(r => r.date === today && r.status === 'Active')
    .map(r => r.vid || r.vehicleId)
);

return q_roster.data
  .filter(p => (p.status || 'Active') === 'Active')
  .filter(p => !loggedIn.has(p.vehicle_code))
  .map(p => {
    const [h, m] = String(p.shift_start || '00:00').split(':').map(Number);
    const shiftMin = h * 60 + (m || 0);
    const minsLate = Math.max(0, nowMin - (shiftMin + grace));
    return {
      empId: p.empId,
      name: p.name,
      vehicle_code: p.vehicle_code,
      phone: p.phone,
      shift_start: p.shift_start,
      mins_late: minsLate,
      severity: minsLate === 0 ? 'ok' : minsLate < 10 ? 'warn' : 'breach',
    };
  })
  .sort((a, b) => b.mins_late - a.mins_late);
```

Bind to a Retool **Table**. Add two buttons per row:
- **Call** → Retool Twilio/Exotel resource, body `{ to: {{ currentRow.phone }} }`.
- **WA reminder** → HTTP resource to the Meta Graph API (reuse the template `pilot_late_login`).

### Tile 2 — Yesterday summary

```javascript
const yday = moment().subtract(1, 'day').format('DD-MMM-YYYY');
const yLogins  = q_attendance.data.filter(r => r.date === yday && r.status === 'Active');
const yLogouts = q_attendance.data.filter(r => r.date === yday && r.status === 'Complete');

return {
  logins:          yLogins.length,
  logouts:         yLogouts.length,
  missing_logouts: yLogins.length - yLogouts.length,
  parcels_total:   yLogouts.reduce((s, r) => s + (Number(r.parcels) || 0), 0),
  mg_met_pct:      yLogouts.length === 0 ? 0 :
                   Math.round(100 * yLogouts.filter(r => r.mgMet === 'Y').length / yLogouts.length),
};
```

Render as 4 **Statistic** components.

### Tile 3 — Vehicles not fit

Derive from `q_roster` + last 7 days of `q_attendance`. Flag a vehicle as
at-risk if it had a logout today with `charging=N` and no follow-up
charging log, or if `mgMet=N` on 3+ of the last 7 days.

```javascript
const last7 = q_attendance.data.filter(r => {
  const d = moment(r.date, 'DD-MMM-YYYY');
  return d.isAfter(moment().subtract(7, 'day'));
});
const byVeh = _.groupBy(last7.filter(r => r.status === 'Complete'), r => r.vehicleId);
return q_roster.data.map(p => {
  const runs = byVeh[p.vehicle_code] || [];
  const mg_miss = runs.filter(r => r.mgMet === 'N').length;
  return {
    vehicle_code: p.vehicle_code,
    runs_7d: runs.length,
    mg_miss_7d: mg_miss,
    flag: mg_miss >= 3 ? 'inspect' : runs.length === 0 ? 'idle' : 'ok',
  };
}).filter(r => r.flag !== 'ok');
```

### Tile 4 — Open alerts (last 24h)

```javascript
const cutoff = moment().subtract(24, 'hour');
return q_alerts.data
  .filter(r => moment(r.at).isAfter(cutoff))
  .sort((a, b) => moment(b.at) - moment(a.at))
  .slice(0, 10);
```

## Mobile layout

Retool → **Mobile** tab on the app → drag the 4 tiles into a single column.
The tables auto-collapse to card view on narrow widths. Don't try to fit
the weekly-calendar tile on mobile; keep it desktop-only.

## When you migrate to Supabase

Only step: swap each query's resource from Google Sheets to the Postgres
resource, and replace the tab reads with the SQL from `dashboard-8am.md`.
All JS transforms above are shape-compatible with the Postgres rows
(same column names from the schema), so tiles keep working unchanged.
