# Build Roadmap — 8 Weeks

The whole point of this spec is that **a 1–3 person team can't build
everything at once**. Sequence so that every week ends with a
measurable operational gain.

## Priority framework

> In EV logistics, profit = **uptime × on-time %**. Build the modules that
> move those two numbers first. Everything else (CRM, leads) waits.

## Week-by-week

### Week 1 — Foundation
- Supabase project + run `schema.sql`.
- Seed `pilots`, `vehicles`, `hubs`, `vendors`, `clients`, `contracts` from `src/DmartTracker.jsx` constants.
- Edge function `POST /attendance-ingest`.
- Extend Apps Script to forward tracker payloads to the edge function.
- **Done when:** a login in the tracker shows up in `attendance_events` within 10 s.

### Week 2 — Uptime module (the money workflow)
- Retool "Live Shift" screen.
- n8n `idle-watchdog` cron (10-min).
- n8n `vehicle-replacement` workflow end-to-end.
- Interakt templates: `pilot_breakdown_ack`, `vendor_breakdown_alert`, `buffer_dispatch`.
- Exotel connector + test click-to-call.
- **Done when:** a simulated "VH-02 breakdown at 11:00" produces WA to vendor AND a `replacements` row within 60 s.

### Week 3 — SLA module
- DB trigger `fn_evaluate_shift_start_sla` enabled.
- `late-login` n8n flow with tiered escalation.
- Retool "SLA Events" inbox with filter by type/severity/open.
- 22:00 daily rollup → `daily_performance`.
- **Done when:** yesterday's on-time % shows up at 8 AM.

### Week 4 — Morning dashboard
- Retool 8 AM dashboard per `dashboard-8am.md`.
- `admin_morning_digest` WhatsApp at 07:45.
- Mobile layout tested on iPhone + Android.
- **Done when:** admins stop using spreadsheets for the morning huddle.

### Week 5 — Disputes
- Retool "Tickets" module: create, assign, comment, close.
- Templates for short-payment + damaged-goods.
- Weekly Loadshare reconciliation cron.
- **Done when:** every short-payment from last 30 days has a ticket row.

### Week 6 — Assets
- Battery logs entry form (mobile).
- Maintenance calendar view.
- Vehicle health card: next service, avg SoC/day, breakdown history.
- **Done when:** you can predict which vehicle breaks down next from history.

### Week 7 — CRM + Driver-partner leads
- Kanban pipeline screen (`crm_opportunities`).
- Leads inbox + call-back queue (`leads`, `lead_activities`).
- Lead capture form (public URL) for recruiting ads.

### Week 8 — Finance
- Monthly invoice draft cron.
- PDF renderer (use Supabase storage + a lightweight HTML→PDF edge fn).
- Payroll CSV export for Tally/bank.
- **Done when:** April-26 invoice goes out without manual Excel work.

## What we consciously DON'T build

| Tempting | Skip because |
|----------|--------------|
| Native mobile app for pilots | The PWA tracker is enough; native adds maintenance burden |
| Real-time map with vehicle pins | Only useful for >20 vehicles; Loadshare app already has it |
| In-house chatbot | Interakt templates are enough at this stage |
| Route optimisation | Loadshare does this; we're the ops layer |
| Self-serve client portal | 1 client (Loadshare). Build when there's a 2nd |
| React admin UI from scratch | Retool replaces 2 engineer-months of work |

## Decision log (keep updating)

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-16 | Supabase over Firebase | Postgres SQL, Retool connector, cheaper RLS |
| 2026-04-16 | Retool over Appsmith | Interakt/Exotel blocks pre-built, mobile layout maturity |
| 2026-04-16 | Keep tracker PWA as-is | Already trained pilots; Apps Script fork is one line |
| 2026-04-16 | n8n self-host, not Zapier | Break-even at ~500 runs/day; ours is ~10k/month |
| 2026-04-16 | Interakt over direct Meta Cloud | Template approval hand-holding for Indian SMBs |
