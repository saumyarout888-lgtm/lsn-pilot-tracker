# Architecture

## 1. Module map

```
                          ┌─────────────────────────────────────┐
                          │        ADMIN (Retool dashboard)      │
                          │  1–3 users · mobile-responsive       │
                          └─────────────────┬────────────────────┘
                                            │ SQL / REST
                                            ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐   ┌─────────────────────┐
│ lsn-pilot-tracker (React)│──▶│         SUPABASE (Postgres)      │◀──│  n8n workflows      │
│  - Geofenced login/out   │   │  pilots · vehicles · attendance  │   │  - 8:00 AM digest   │
│  - Posts to /attendance  │   │  orders · sla_events · tickets   │   │  - Idle-2h watchdog │
└──────────────────────────┘   │  leads · contracts · invoices    │   │  - Loadshare sync   │
                               └──────┬───────────────────────────┘   └──────┬──────────────┘
                                      │ webhooks                             │
                                      ▼                                      ▼
                               ┌─────────────────┐                  ┌──────────────────┐
                               │ Loadshare APIs  │                  │ Interakt (WA) +  │
                               │ (orders/SLA)    │                  │ Exotel (call)    │
                               └─────────────────┘                  └──────────────────┘
```

## 2. Module → responsibility

| Module | Owner tables | Key screens | External deps |
|--------|--------------|-------------|---------------|
| **Operations & SLA** | `attendance_events`, `sla_events`, `orders` | Live SLA board, shift monitor | Loadshare API, tracker |
| **Vendor & Asset** | `vehicles`, `vendors`, `battery_logs`, `maintenance` | Asset register, battery health chart, maintenance calendar | — |
| **Vehicle Recovery** | `breakdowns`, `replacements` | Breakdown form, swap tracker | WhatsApp, Exotel |
| **CRM (clients)** | `clients`, `contracts`, `pipeline_stages` | Kanban pipeline, contract docs | — |
| **Driver-Partner leads** | `leads`, `lead_activities` | Lead list, call-back queue | Exotel, WhatsApp |
| **Disputes** | `tickets`, `ticket_comments` | Ticket inbox, SLA-clock on tickets | — |
| **Automation** | `automation_runs`, `notifications` | Run history, template library | n8n, Interakt, Exotel |
| **Finance** | `invoices`, `payroll`, `reconciliation` | Invoice draft, payroll preview | Tally/Zoho (CSV export only) |

## 3. Integration with `lsn-pilot-tracker`

Current tracker writes to a Google Sheet via `SHEET_URL` (an Apps Script webhook).
We **keep the tracker unchanged** and extend the Apps Script with one extra line:

```js
// inside the Apps Script doPost(e)
UrlFetchApp.fetch(SUPABASE_FUNCTION_URL, {
  method: 'post',
  contentType: 'application/json',
  headers: { Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
  payload: e.postData.contents,   // forward raw tracker payload
  muteHttpExceptions: true,
});
```

The Supabase Edge Function `POST /attendance-ingest` validates the payload,
resolves `emp_id → pilot_uuid`, and inserts into `attendance_events`. A DB
trigger immediately fires the **8:00 AM shift-start SLA check** (see
[`automation/sla-and-alerts.md`](./automation/sla-and-alerts.md)).

### Shared UUID migration

1. Add `pilot_uuid` column to `pilots` (default `gen_random_uuid()`).
2. Seed from the existing tracker's `INIT_ROSTER` (`DRV-01..`, `DA-01..`, `BUF-01`).
3. When the tracker posts, we match on `emp_id` (unique index).
4. Tracker UI changes: **none required in phase 1**. Phase 2 can surface `pilot_uuid` in the logout receipt for audit.

## 4. Frontend choice — why Retool

A 1–3 person admin team needs **forms + tables + filters** more than pixel-
perfect UX. Retool gives:

- Direct Postgres connector — no ORM to maintain.
- Mobile layout mode — the admin can approve a vehicle swap from a phone.
- Row-level auth via Supabase RLS policies that Retool honours.
- Built-in Twilio/Exotel/WhatsApp resource blocks.

Pilot-facing screens stay in the existing **React/Vite** app — it's already on
Netlify and the pilots are trained on it. Don't fork it.

## 5. Cost ceiling (5 vehicles, ~12 pilots, ~10k orders/mo)

| Line item | Monthly |
|-----------|---------|
| Supabase (Free → Pro if >500MB) | ₹0 – ₹2,000 |
| Retool (free < 5 users) | ₹0 |
| n8n on a ₹500 VPS (Hetzner/Contabo) | ₹500 |
| Interakt (WhatsApp, ~3k msgs) | ₹2,500 |
| Exotel (telecalling, ~500 min) | ₹1,500 |
| Netlify (existing) | ₹0 |
| **Total** | **~₹4,500–6,500** |

Scale trigger: move Supabase to Pro when `attendance_events` crosses ~5M rows
or realtime connections exceed 200.
