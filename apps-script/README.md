# Apps Script — Tracker webhook + SLA alerts + WhatsApp/Exotel

One Apps Script project behind the tracker's `SHEET_URL`. Runs without
Supabase. Files in this folder each become a separate `.gs` file in the
project:

| File | Purpose |
|---|---|
| `Code.gs` | `doPost` webhook — appends tracker POSTs to the `Attendance` sheet, optionally forwards to Supabase |
| `Alerts.gs` | Time-triggered SLA workflows: morning digest, late-login, EOD reminder, daily summary |
| `WhatsApp.gs` | Meta WhatsApp Cloud API sender (`sendTemplate_`, `sendText_`) |
| `Exotel.gs` | Click-to-call wrapper (`exotelCall_`) |
| `Setup.gs` | One-time helpers: `setupSheetTabs()`, `setupTriggers()` |
| `appsscript.json` | Manifest: timezone, OAuth scopes, web-app config |

## One-time setup

### 1 · Create the project

1. Open https://script.google.com → **New project**.
2. Add all five `.gs` files above (paste each as a new file in the editor).
3. Gear icon → tick **Show "appsscript.json" in editor** → replace with the version in this folder.

### 2 · Set Script properties

**Project Settings → Script properties → Add script property.** Mandatory rows are marked `*`.

| Key | Example | Required for |
|---|---|---|
| `SHEET_ID` * | `1aBc...XYZ` (the id in the sheet URL) | everything |
| `SHEET_NAME` | `Attendance` | webhook (default ok) |
| `WA_PHONE_NUMBER_ID` | `109876543210987` | all WA alerts |
| `WA_ACCESS_TOKEN` | long-lived Meta token | all WA alerts |
| `WA_TEMPLATE_LANG` | `en` (or `en_US`) | all WA alerts |
| `EXOTEL_SID` | `lsnlogistics1` | call escalations |
| `EXOTEL_API_KEY` | api key | call escalations |
| `EXOTEL_TOKEN` | api token | call escalations |
| `EXOTEL_CALLER_ID` | `08047091234` | call escalations |
| `EXOTEL_SUBDOMAIN` | `api.exotel.com` (default) or `api.in.exotel.com` | call escalations |
| `SUPABASE_FUNCTION_URL` | optional; leave blank to skip | Supabase forward |
| `INGEST_SHARED_TOKEN` | optional | Supabase forward |

### 3 · Create Sheet tabs

In the Apps Script editor select **`setupSheetTabs`** from the function dropdown and click **Run**. Approve the OAuth prompt. This creates:

- **Roster** — seeded with `DRV-01..05` rows. Fill in each pilot's `phone`, `emergency_phone`, and confirm `shift_start`/`shift_end`.
- **Config** — seeded with default thresholds. Paste your `admin_wa` (WhatsApp-enabled admin number in E.164 form, e.g. `+919812345678`) and `admin_phone`.
- **AlertLog** — empty; alerts log here automatically.

### 4 · Install triggers

Run **`setupTriggers`**. It registers:

| Handler | Schedule | What it does |
|---|---|---|
| `onMorningDigest` | daily 07:45 IST | WA digest to `admin_wa` — yesterday's logins, late count, missing logouts, today's shift-risk list |
| `onLateLoginCheck` | every 5 min | self-gates to 07:55–09:30 IST; tiered WA → WA+call → WA+call+emergency_contact |
| `onEodReminder` | daily 20:00 IST | WA to pilots with a LOGIN today but no LOGOUT |
| `onDailySummary` | daily 22:00 IST | WA to each pilot: today's parcels + hours |

### 5 · Deploy the webhook

**Deploy → New deployment → Web app**. Execute as `Me`, access `Anyone`. Copy the `/exec` URL into `src/DmartTracker.jsx:5` (`SHEET_URL`).

## WhatsApp template checklist

Create and get approval for these templates in Meta Business Manager (Messages → Message Templates). Names must match exactly.

| Name | Category | Body (example) |
|---|---|---|
| `pilot_shift_reminder` | UTILITY | `Hi {{1}}, your {{2}} shift starts at {{3}}. Reply 1 on-the-way, 2 issue.` |
| `pilot_late_login` | UTILITY | `Hi {{1}}, you haven't logged in — you're {{2}} min past shift start. Please login or reply with your status.` |
| `pilot_eod_reminder` | UTILITY | `Hi {{1}}, you haven't logged out yet. Please complete logout when you finish your shift.` |
| `pilot_daily_summary` | UTILITY | `Hi {{1}}, today: {{2}} parcels, {{3}} hours. Thanks for your work!` |
| `admin_morning_digest` | UTILITY | `Yesterday: {{1}} logins, {{2}} late, {{3}} missing logouts. At-risk today: {{4}}.` |
| `admin_late_login_escalate` | UTILITY | `ESCALATION: {{1}} is {{2}} min late on {{3}}. Auto-call placed.` |
| `emergency_contact_alert` | UTILITY | `{{1}} has been absent {{2}} min past shift. We've been unable to reach them. Please call us on the agency number.` |

You don't need all seven on day one — start with the three most impactful
(`pilot_late_login`, `admin_morning_digest`, `pilot_daily_summary`); others
will simply fail to send and log the failure in `AlertLog`.

## Testing

**Webhook**:

```bash
WEBAPP_URL="https://script.google.com/macros/s/.../exec"
curl -sS -X POST "$WEBAPP_URL" -H "Content-Type: application/json" -d '{
  "vid":"VH-02","type":"e3W","driver":"Test","da":"-",
  "start":"08:05","end":"","parcels":"","charging":"",
  "status":"Active","date":"16-Apr-2026"
}'
```

→ a new row in `Attendance`.

**Late-login simulation**:
1. Put a real number in `Roster` for DRV-02 with `shift_start = 08:00`.
2. Don't POST anything for DRV-02/VH-02 today.
3. Manually run `onLateLoginCheck` from the editor after 08:10 IST — a
   `pilot_late_login` WA should fire, and `AlertLog` should get a row.

**Morning digest dry-run**: set a row in `Config` `admin_wa = <your WA>`, then run `onMorningDigest` manually.

## Troubleshooting

- **WA sends log `skipped`**: `WA_PHONE_NUMBER_ID` or `WA_ACCESS_TOKEN` missing.
- **WA 132000 error** (template not found): name/language mismatch. Check Meta Business Manager; template must be APPROVED, and `WA_TEMPLATE_LANG` must match.
- **Exotel 401**: new accounts need `EXOTEL_API_KEY` (not just `SID`); API-key basic auth replaces token-only auth.
- **Triggers not firing**: some IST triggers show in UTC in the Apps Script UI — it's a display artefact, the `.inTimezone('Asia/Kolkata')` on creation is authoritative.
- **Late-login alerts fire for the wrong pilot**: the matcher joins `Roster.vehicle_code` to the tracker's `vid`. If a buffer drove a different vehicle, add a temporary `assignments`-like row by editing `Roster`'s `vehicle_code` for that pilot.

## Optional: Supabase forward

If you've deployed `supabase/functions/attendance-ingest`, also set
`SUPABASE_FUNCTION_URL` and `INGEST_SHARED_TOKEN` as script properties.
`Code.gs` will forward each tracker POST and log the Supabase HTTP status
in `Attendance.supabase_status`. See `../supabase/functions/README.md`.
