# Apps Script — Tracker webhook + Supabase forwarder

Replaces (or upgrades) the existing Apps Script behind `SHEET_URL` in
`src/DmartTracker.jsx`. It:

1. Appends tracker payloads to a Google Sheet (existing behaviour).
2. Forwards each payload to the Supabase `attendance-ingest` Edge Function.
3. Records Supabase's HTTP status per row, so failed forwards are visible
   in the Sheet itself (no separate error log needed).

## One-time setup

1. Open https://script.google.com → **New project**.
2. Delete the default `Code.gs`, paste contents of this folder's `Code.gs`.
3. Click the gear icon → tick **Show "appsscript.json" in editor**, then
   replace that file's contents with this folder's `appsscript.json`.
4. **Project Settings → Script properties → Add script property** (4 rows):

   | Name | Value |
   |---|---|
   | `SHEET_ID` | Spreadsheet ID — the random string in the sheet URL |
   | `SHEET_NAME` | `Attendance` (default, or pick another tab) |
   | `SUPABASE_FUNCTION_URL` | `https://<project-ref>.supabase.co/functions/v1/attendance-ingest` |
   | `INGEST_SHARED_TOKEN` | Same value you ran `supabase secrets set INGEST_SHARED_TOKEN=...` with |

5. **Deploy → New deployment → Select type → Web app**
   - *Description:* `lsn-pilot-tracker-webhook-v1`
   - *Execute as:* `Me`
   - *Who has access:* `Anyone`
   - Click **Deploy**. Approve the OAuth prompt (Sheets + UrlFetch).
6. Copy the Web-app URL (ends with `/exec`). This replaces `SHEET_URL` in
   `src/DmartTracker.jsx:5`.

## Test end-to-end

From a terminal:

```bash
WEBAPP_URL="https://script.google.com/macros/s/.../exec"

curl -sS -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "vid":"VH-02","type":"e3W","driver":"Test Driver","da":"-",
    "start":"08:05","end":"","parcels":"","charging":"",
    "status":"Active","date":"16-Apr-2026"
  }'
```

Expected:
- New row appears in the `Attendance` tab of your Sheet.
- `supabase_status` column shows `200`.
- In Supabase SQL editor:
  ```sql
  select * from attendance_events order by event_ts desc limit 1;
  ```
  → one row for pilot DRV-02 (via VH-02's active assignment).

## Modes

| Scenario | What happens |
|---|---|
| Both properties set | Sheet append + Supabase POST + status logged in Sheet |
| Only SHEET_ID set | Sheet append; `supabase_status` = `skipped` |
| Supabase down / 5xx | Sheet append still succeeds; error recorded in `supabase_error` for the row |
| Missing `SHEET_ID` | Webhook returns 200 with sheet-append error in logs; Supabase still called |

## Troubleshooting

- **401 from Supabase**: `INGEST_SHARED_TOKEN` mismatch — rotate with
  `supabase secrets set INGEST_SHARED_TOKEN=...` and update the Script
  property.
- **"unknown vehicle_code"**: `vehicles.vehicle_code` row missing. Seed
  VH-01…VH-05 per `docs/fleet-ops/architecture.md` §3.
- **"no active assignment"**: the date is outside every `assignments` row
  for that vehicle. Add/extend a row in `assignments`.
- **Re-deployment silently broken**: Apps Script gives each deployment a
  different `/exec` URL unless you **edit the existing deployment** (⋯ →
  Manage deployments → pencil icon → New version). Use that so
  `SHEET_URL` in the tracker never goes stale.
