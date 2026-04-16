# Daily 3-Person Action Plan

A 1–3 person agency only wins if every hour of every person is accounted for.
This is a **time-boxed checklist** — open it at each checkpoint, run the
listed actions, then close it.

## Personas

| | Person A — Sales & Growth | Person B — Ops & SLA | Person C — Fleet & Legal |
|---|---|---|---|
| **Owns** | Pipeline, LinkedIn, cold email, client renewals | Live shift, SLA breaches, pilot comms, disputes with hubs | Vehicles, vendors, batteries, breakdowns, legal |
| **Primary screen** | Retool `CRM` + `Leads` | Retool `8 AM dashboard` + `SLA Events` | Retool `Vehicles` + `Breakdowns` + `Tickets` |
| **WA templates owned** | `client_monthly_invoice` (assist) | `pilot_late_login`, `pilot_daily_summary`, `admin_morning_digest` | `pilot_breakdown_ack`, `vendor_breakdown_alert`, `buffer_dispatch` |
| **North-star metric** | New MRR booked / month | On-time % ≥ 95, SLA open < 3 | Vehicle uptime ≥ 95%, MTTR ≤ 45 min |

> If the agency has only 2 people: **Person C merges into Person B**. If solo:
> run A in the morning (07:45–10:00), B in the afternoon, C on-call all day.

## Time-boxed checklist

### 07:45 — Morning digest (all three, 10 min)

Everyone reads the `admin_morning_digest` WhatsApp and the 8 AM dashboard
(`docs/fleet-ops/dashboard-8am.md`). One-line standup in the team WA group:
**"Risks today?"**

| Role | Action |
|---|---|
| A | Scan weekly tile: any contract renewal in ≤7d? Any lead follow-up today? |
| B | Shift Risk tile: any pilot not logged in? Hit `Call` / `WA reminder` buttons |
| C | Vehicles not fit for dispatch tile: confirm maintenance/charging ETAs, arrange buffer if needed |

### 10:00 — Prospecting & shift stability (90 min)

| Role | Action | References |
|---|---|---|
| A | 10 new LinkedIn connection requests + 10 cold emails | `linkedin-outreach.md` |
| A | Update `crm_opportunities.next_action_at` for any reply received | schema `crm_opportunities` |
| B | Confirm every pilot is logged in; chase the late ones with `pilot_late_login` | `automation/sla-and-alerts.md` |
| B | Review any `sla_events` from overnight; close or assign to ticket | schema `sla_events`, `tickets` |
| C | Review `maintenance` calendar for the day; confirm vendor arrival slots | schema `maintenance`, `vendors` |

### 13:00 — Midday SLA check (20 min)

| Role | Action |
|---|---|
| A | Respond to all LinkedIn / email replies within 2h SLA |
| B | Idle watchdog review: any `sla_events type=IDLE_2H` open? If so, join Person C's escalation |
| C | If any open breakdown > 45 min (MTTR breach), step in personally; ping Exotel on-duty |

### 17:00 — Afternoon squeeze (30 min)

| Role | Action |
|---|---|
| A | Move one deal forward in `pipeline_stages`; book next meeting before logging off |
| B | On-time % for orders closing today: push pilots with <90% via WA; escalate to C if idle |
| C | Confirm end-of-shift charging slots booked; log `battery_logs` started_at for each vehicle |

### 20:00 — Wind-down (15 min)

| Role | Action |
|---|---|
| A | Write tomorrow's top-3 in `crm_opportunities.next_action_at` |
| B | Confirm daily rollup cron ran (`daily_performance` has today's row for every active pilot); if NO_LOGOUT open, follow up |
| C | Review `breakdowns` status=OPEN; decide overnight action or park for 07:45 |

## Weekly cadence (overlaid on the daily loop)

| Day | Extra 30-min slot |
|---|---|
| **Mon 10:00** | Person B + C run Loadshare reconciliation cron output; convert variances into `tickets(type=SHORT_PAYMENT)` |
| **Tue 11:00** | Person A reviews lead-source conversion: which channel gave the most `crm_opportunities.stage=WON` last 30d? |
| **Wed 15:00** | Person C reviews `maintenance` history per vehicle; flag any `VH-##` with ≥2 breakdowns in 14 days for inspection |
| **Thu 11:00** | Person A runs a 30-min prospecting sprint with fresh LinkedIn Sales Navigator filters |
| **Fri 17:00** | All three: 30-min "week in review" — pipeline ₹, on-time %, vehicle uptime %. Adjust next week's priorities |

## Escalation ladder

- **Pilot-side issue** (late, AWOL, complaint) → Person B opens `tickets(type=PILOT_COMPLAINT)`; if unresolved in 24h → Person C takes over with legal/HR lens via `conflict-resolution.md`.
- **Vehicle/vendor issue** → Person C; always; no exception.
- **Client-side issue** (short-payment, SLA dispute) → Person B opens the ticket, Person A joins the call with the client relationship hat on.
- **Anything >₹25,000 or anything legal** → both B and C before replying.

## Anti-patterns

- Don't skip 07:45. Every other checkpoint compounds from there.
- Don't do LinkedIn in the afternoon — open rates halve after 14:00 IST.
- Don't merge C's role into B full-time just because "it's been quiet". Fleet debt accrues silently.
