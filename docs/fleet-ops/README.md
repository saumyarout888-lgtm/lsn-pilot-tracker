# Fleet Management & Business Ops Tool — Design

> Companion system to **lsn-pilot-tracker** (attendance) for a 1–3 person
> agency running 3W/4W EV last-mile fleets under Loadshare.

This folder contains the full design brief. Read the docs in this order:

| # | Doc | What it covers |
|---|-----|----------------|
| 1 | [`architecture.md`](./architecture.md) | Module map, tech stack, integration with the existing tracker |
| 2 | [`system-map.md`](./system-map.md) | End-to-end data flow: morning attendance → EoM invoice |
| 3 | [`schema/database-schema.md`](./schema/database-schema.md) | Tables, relationships, keys |
| 4 | [`schema/schema.sql`](./schema/schema.sql) | Postgres DDL (runs on Supabase) |
| 5 | [`automation/vehicle-replacement.md`](./automation/vehicle-replacement.md) | Step-by-step breakdown → swap workflow |
| 6 | [`automation/sla-and-alerts.md`](./automation/sla-and-alerts.md) | Cron jobs, WhatsApp/telecall triggers |
| 7 | [`dashboard-8am.md`](./dashboard-8am.md) | Admin morning-dashboard spec |
| 8 | [`roadmap.md`](./roadmap.md) | 8-week build plan, priorities, cost ceiling |
| 9 | [`playbooks/README.md`](./playbooks/README.md) | Index of the day-to-day playbooks for the 1–3 person team |
| 10 | [`playbooks/daily-action-plan.md`](./playbooks/daily-action-plan.md) | Person A/B/C time-boxed checklist (07:45 → 20:00) + weekly cadence |
| 11 | [`playbooks/linkedin-outreach.md`](./playbooks/linkedin-outreach.md) | ICP, 3-step LinkedIn sequence, cold email ("Cost per Km vs Diesel") |
| 12 | [`playbooks/conflict-resolution.md`](./playbooks/conflict-resolution.md) | Dispute triage, 3-day no-show templates, vehicle recovery checklist |

### Deployable scaffolds (live code, not just docs)

| Path | What it is |
|---|---|
| [`../../apps-script/Code.gs`](../../apps-script/Code.gs) | Tracker webhook — appends to Sheet, optional Supabase forward |
| [`../../apps-script/Alerts.gs`](../../apps-script/Alerts.gs) | Time-triggered SLA alerts (morning digest, late-login, EOD, daily summary) |
| [`../../apps-script/WhatsApp.gs`](../../apps-script/WhatsApp.gs) | Meta WhatsApp Cloud API wrapper (`sendTemplate_`, `sendText_`) |
| [`../../apps-script/Exotel.gs`](../../apps-script/Exotel.gs) | Click-to-call wrapper |
| [`../../apps-script/Setup.gs`](../../apps-script/Setup.gs) | One-time `setupSheetTabs()` + `setupTriggers()` |
| [`../../apps-script/README.md`](../../apps-script/README.md) | Full deploy + templates + testing guide |
| [`./retool-over-sheets.md`](./retool-over-sheets.md) | Retool 8 AM dashboard directly over Google Sheets (no DB) |
| [`../../supabase/functions/attendance-ingest/index.ts`](../../supabase/functions/attendance-ingest/index.ts) | Optional: Supabase edge function for the day you outgrow Sheets |
| [`../../supabase/migrations/20260417_attendance_idempotency.sql`](../../supabase/migrations/20260417_attendance_idempotency.sql) | Optional: idempotency index for Supabase |
| [`../../supabase/functions/README.md`](../../supabase/functions/README.md) | Optional: Supabase deploy instructions |

## TL;DR stack

| Layer | Choice | Why |
|-------|--------|-----|
| DB + Auth + Storage + Realtime | **Supabase (Postgres)** | SQL, row-level security, free tier covers this scale |
| Admin UI | **Retool** (or Appsmith self-host) | 1–3 admins; drag-and-drop tables/forms over Postgres |
| Pilot attendance UI | **Existing `lsn-pilot-tracker` (React/Vite)** | Already deployed on Netlify; keep it |
| Automation / workflows | **n8n (self-host on Railway/Fly)** | Cheaper than Zapier at volume; handles cron + webhooks |
| WhatsApp | **Interakt** (or Gupshup / Meta Cloud API direct) | India-first, template approvals bundled |
| Telecalling | **Exotel** click-to-call + IVR | India STD/ISD coverage, cheap per-minute |
| Hosting (UI/API) | **Netlify** (existing) + **Supabase Edge Functions** | Zero ops |

**Total run-rate for 5 vehicles / 1–3 admins: ≈ ₹4–6k/month** (Supabase free, Retool free < 5 users, n8n ₹500 VPS, WhatsApp ~₹2–3k, Exotel ~₹1–2k).

## Integration anchor: the Shared UUID

The existing tracker identifies people by `empId` (`DRV-01`, `DA-01`, `BUF-01`).
The new system adopts a stronger key:

```
pilots.pilot_uuid  (PK, uuid)
pilots.emp_id      (unique, maps to tracker)
```

The tracker keeps writing `emp_id + login_time + hub_geo`. A Supabase Edge
Function (or the Apps Script currently behind `SHEET_URL`) upserts each event
into `attendance_events`, joined on `emp_id`. Every downstream module
(SLA, payroll, disputes) keys off `pilot_uuid`.
