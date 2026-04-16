# Supabase Edge Functions

## `attendance-ingest`

Receives tracker POSTs (forwarded by the Apps Script), resolves
`vehicle_code → pilot_uuid` via the active assignment, and writes rows to
`attendance_events`.

### Prereqs

1. Supabase project created.
2. `docs/fleet-ops/schema/schema.sql` has been run (creates `pilots`,
   `vehicles`, `assignments`, `attendance_events`, etc.).
3. `supabase/migrations/20260417_attendance_idempotency.sql` has been run
   (adds the unique minute-level index for dedupe).

### Deploy

```bash
# one-time
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>

# set secrets — generate a long random token, keep it secret
supabase secrets set INGEST_SHARED_TOKEN="$(openssl rand -hex 24)"

# deploy
supabase functions deploy attendance-ingest --no-verify-jwt
```

`--no-verify-jwt` is deliberate: the tracker/Apps Script authenticates with
the shared `INGEST_SHARED_TOKEN`, not a Supabase user JWT.

### Test

```bash
FUNCTION_URL=https://<your-project-ref>.supabase.co/functions/v1/attendance-ingest
TOKEN=<the INGEST_SHARED_TOKEN you set>

curl -sS -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vid":"VH-02","type":"e3W","driver":"Test Driver",
    "da":"-","start":"08:05","end":"",
    "parcels":"","charging":"","status":"Active","date":"16-Apr-2026"
  }'
# → {"ok":true,"inserted":1,"duplicate":false}

# Re-post the same event — should be deduped
curl -sS -X POST "$FUNCTION_URL" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '<same body>'
# → {"ok":true,"inserted":1,"duplicate":true}
```

Verify in Supabase → SQL editor:

```sql
select pilot_uuid, vehicle_uuid, event_type, event_ts, source
  from attendance_events
 order by event_ts desc limit 5;
```

### Error contract

| HTTP | `error` body | Cause |
|---|---|---|
| 401 | `unauthorized` | Missing/bad `Authorization: Bearer` |
| 400 | `invalid json` | Body isn't JSON |
| 400 | `missing vehicle_code or events` | Payload didn't match either tracker shape |
| 500 | `unknown vehicle_code: VH-XX` | Vehicle not seeded |
| 500 | `no active assignment for VH-XX on YYYY-MM-DD` | `assignments` row missing for that date |

The Apps Script (`apps-script/Code.gs`) treats 5xx as non-fatal — the Google
Sheet still gets the row, so the tracker UI is never blocked by Supabase.

### Local dev

```bash
supabase functions serve attendance-ingest --env-file .env.local
# .env.local contains INGEST_SHARED_TOKEN=... plus the Supabase URL/keys
```
