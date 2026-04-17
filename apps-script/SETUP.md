# Setup — Get Running in ~20 Minutes

This is the exact sequence. Don't skip. All links open in a new tab.

## 0 · What you need before you start

| Thing | Where to get it |
|---|---|
| A Google account that owns the tracker Sheet | — |
| WhatsApp Business account (for SLA alerts) | https://business.facebook.com → WhatsApp Accounts |
| Exotel account (for auto-calls) — **optional** | https://my.exotel.com |
| Terminal with Node 18+ installed | `node -v` |

**Time needed:** ~20 min (≈ 5 min for each of the four blocks below).

---

## 1 · Deploy the Apps Script (5 min)

Pick **ONE** path.

### Path A — clasp (recommended, fastest)

```bash
cd apps-script
npm install                      # installs @google/clasp
npm run login                    # opens browser, grant clasp access
npm run create                   # creates a new Apps Script project
cp .clasp.json.example .clasp.json
# → open .clasp.json, paste the scriptId printed by `npm run create`
npm run push                     # uploads Code/Alerts/WhatsApp/Exotel/Setup
npm run open                     # opens script.google.com to the project
```

Then in the editor: **Deploy → New deployment → Web app** · Execute as: `Me` · Access: `Anyone` · **Deploy**. Copy the `/exec` URL that appears — you'll need it in step 4.

### Path B — paste

1. https://script.google.com → **New project**.
2. Paste `apps-script/bundled.gs` (single file) into the default `Code.gs`.
3. Gear icon → **Show "appsscript.json" in editor** → replace that tab with `apps-script/appsscript.json`.
4. **Deploy → New deployment → Web app** (same settings as above). Copy the `/exec` URL.

---

## 2 · Fill the Sheet — Roster + Config (5 min)

In the Apps Script editor, **Project Settings → Script properties → Add**:

| Key | Value |
|---|---|
| `SHEET_ID` | The random string from your Sheet URL (between `/d/` and `/edit`) |

Save. Then from the editor's function dropdown select **`setupSheetTabs`** → **Run** → approve the OAuth prompt (Sheets access).

Open your Sheet — five new tabs will be there:

- **Roster** — 5 rows pre-seeded (DRV-01..DRV-05). Fill in:
  - `name` (driver full name)
  - `phone` (WhatsApp number in `+919812345678` format)
  - `emergency_phone` (same format)
  - leave `vehicle_code`, `shift_start`, `shift_end`, `status` as-is unless you want to change them
- **Config** — fill:
  - `admin_wa` = **your** WA number (E.164, e.g. `+919812345678`)
  - `admin_phone` = same, for Exotel calls
  - `agency_name` = the agency name you want on messages
  - leave `grace_min = 10`, `on_time_target_pct = 95`, `idle_min = 120`
- **AlertLog** — don't touch; it fills itself.
- **Leads** — **pre-populated with 30 tier-A Indian last-mile prospects** (Zepto, Blinkit, Swiggy Instamart, Licious, 1mg, Meesho, Delhivery, Udaan, Porter, etc. across 6 segments). Each row has `company`, `title` (target role), `city`, and `stage=NEW`. Person A fills in `name`/`phone`/`linkedin_url` per row as they research on LinkedIn Sales Navigator. Re-running `setupSheetTabs` will **not** clobber existing rows — it skips seed if the tab has data.
- **Outreach** — empty touch log. Rows appear when you log a LinkedIn message / email / call against a lead.

---

## 3 · Wire up WhatsApp + Exotel (5 min, skippable)

### WhatsApp Cloud API (required for any alert to actually send)

1. https://developers.facebook.com → My Apps → **Create App → Business → WhatsApp**.
2. Add a phone number (use a SIM that isn't on personal WhatsApp).
3. In the app dashboard → **WhatsApp → API Setup** → copy:
   - **Phone number ID** → goes into Script property `WA_PHONE_NUMBER_ID`
   - **Temporary access token** (24h) → `WA_ACCESS_TOKEN` — good for testing.
   - Later, **System user → Generate token (never expires)** → replace the temporary one.
4. Script property `WA_TEMPLATE_LANG` = `en` (or `en_US` if your templates use that).
5. In Business Manager → **Messages → Message Templates → Create** the 7 templates listed in `apps-script/README.md § WhatsApp template checklist`. Start with just 3: `pilot_late_login`, `admin_morning_digest`, `pilot_daily_summary`. Approval takes 1–24 h.

### Exotel (optional — only needed for auto-call escalations)

Add these Script properties if/when you have an Exotel account:

| Key | Where to find it |
|---|---|
| `EXOTEL_SID` | my.exotel.com → Settings → API |
| `EXOTEL_API_KEY` | same page |
| `EXOTEL_TOKEN` | same page |
| `EXOTEL_CALLER_ID` | your Exotel virtual number (e.g. `08047091234`) |
| `EXOTEL_SUBDOMAIN` | leave blank → defaults to `api.exotel.com` |

Skip this step for now — WhatsApp covers ~95% of alerts. Add Exotel later if you want auto-calls for T2/T3 escalations.

---

## 4 · Install time triggers + point the tracker (5 min)

**Install triggers** (so alerts actually fire):

- Apps Script editor → function dropdown → **`setupTriggers`** → **Run**.
- Check Apps Script → **Triggers** (clock icon in the left rail). You should see 4: `onMorningDigest` (07:45), `onLateLoginCheck` (every 5 min), `onEodReminder` (20:00), `onDailySummary` (22:00).

**Point the tracker PWA at the webhook:**

Two options, pick one:

### Option A — Netlify env var (cleaner, no source edit)

Netlify → your site → **Site configuration → Environment variables → Add**:

| Key | Value |
|---|---|
| `VITE_SHEET_URL` | the `/exec` URL from step 1 |
| `VITE_ADMIN_PIN` | 4-digit PIN you want (default `0000`) |

Trigger a redeploy: **Deploys → Trigger deploy → Deploy site**.

### Option B — hard-code

Edit `src/DmartTracker.jsx`:
- Line 4: `const ADMIN_PIN = "<your-pin>";`
- Line 5: `const SHEET_URL = "<the /exec URL>";`

Commit + push; Netlify redeploys.

---

## 5 · Smoke test

```bash
# Replace with your /exec URL
WEBAPP_URL="https://script.google.com/macros/s/.../exec"

curl -sS -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "vid":"VH-02","type":"e3W","driver":"Test","da":"-",
    "start":"08:05","end":"","parcels":"","charging":"",
    "status":"Active","date":"'"$(date +%d-%b-%Y)"'"
  }'
```

Check:
- ✅ New row in `Attendance` tab.
- ✅ `AlertLog` empty (no alerts yet because you logged in on time).

**Force a late-login alert to verify WhatsApp delivery:**

1. In `Roster`, temporarily change DRV-02's `shift_start` to the current time minus 15 minutes (e.g. if it's 14:30 IST, set `14:15`).
2. Apps Script editor → run `onLateLoginCheck` manually.
3. Check your phone → `pilot_late_login` template should arrive on DRV-02's WA number.
4. Restore DRV-02's real `shift_start`.

Done. Every morning, the digest hits your WhatsApp at 07:45 IST.

---

## 6 · After you're live (first-week checklist)

- Day 1: confirm 4 triggers ran (`Apps Script → Executions` tab; any failures there bubble up with full stack traces).
- Day 2: check `AlertLog` — are any alerts spamming the same pilot? If so, tune `grace_min` in `Config`.
- Day 3: verify `admin_morning_digest` numbers match the Sheet manually.
- Day 7: review `AlertLog.status` column — should be mostly `logged`. If you see `error`, check the Apps Script Executions view.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `onLateLoginCheck` fires but nothing sends | Templates not approved yet in Meta Business Manager. Status visible at Business Manager → Message Templates. |
| Template error 132000 | Template name typo, or `WA_TEMPLATE_LANG` doesn't match the language you selected when creating the template. |
| Triggers listed in UTC in the editor | Display bug; `.inTimezone('Asia/Kolkata')` is authoritative — they'll fire at the right IST time. |
| Tracker shows `PASTE_YOUR_APPS_SCRIPT_URL_HERE` | The Netlify env var didn't apply. Confirm `VITE_SHEET_URL` is set and redeploy. |
| Tracker logs work but no alerts | Confirm `setupTriggers` actually ran (check Apps Script → Triggers tab). |
