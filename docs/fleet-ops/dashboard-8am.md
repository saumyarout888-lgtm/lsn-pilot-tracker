# 8:00 AM Admin Dashboard — Concept

**Audience:** the 1–3 admins running the agency, opening Retool on a phone
during the morning coffee before heading to the hub.

**Design rule:** every tile answers one question. If a tile doesn't change
what the admin does in the next 2 hours, it doesn't belong on this screen.

## Layout (mobile-first, 4 rows × 1 column on phone)

```
┌──────────────────────────────────────────────────────────┐
│ 🔴  SHIFT RISK — 3 pilots not yet logged in              │
│     DRV-02 (VH-02, Wikilabs)   ⟂ 08:00 shift, 0 min late │
│     DRV-04 (VH-04, Gentari)    ⟂ 08:00 shift, 0 min late │
│     DRV-05 (VH-05, Gentari)    ⟂ 08:00 shift, 0 min late │
│     [📞 Call all]    [💬 WA reminder]                   │
├──────────────────────────────────────────────────────────┤
│ 🟡  VEHICLES NOT FIT FOR DISPATCH                        │
│     VH-03  Maintenance due — service @ Gentari 10:00     │
│     VH-01  Battery 22%, charging 6h left (ETA 14:00)     │
├──────────────────────────────────────────────────────────┤
│ 🟢  YESTERDAY                                            │
│     On-time %   92.3%  (target 95%)     ▼ -1.8pp vs 7d   │
│     Orders      412 / 420 assigned  (98% completion)     │
│     SLA breach  7 events, 2 still open                   │
│     Revenue     ₹48,920  |  Vehicle idle 3.2 h          │
├──────────────────────────────────────────────────────────┤
│ 🟠  OPEN TICKETS (need me today)                         │
│     T-0042  Short-payment ₹1,840, Loadshare-HUB-BLR-03   │
│     T-0044  Damaged goods, order LS-884221               │
├──────────────────────────────────────────────────────────┤
│ 📅  THIS WEEK                                            │
│     Contract BLR-03 expires Fri — renew?  [Open]         │
│     2 leads need follow-up today                         │
│     Monthly invoice draft ready (preview)                │
└──────────────────────────────────────────────────────────┘
```

## Metrics spec

### Tile 1 — Shift Risk (the one that matters most at 8 AM)

Query: list pilots with today's assignment where no `LOGIN` event yet AND
`shift_start - now() <= 15 min`.

```sql
select p.emp_id, p.full_name, p.phone, v.vehicle_code,
       (c.sla_json->>'shift_start')::time as shift_start,
       greatest(0, extract(epoch from (now() - ((current_date || ' ' || (c.sla_json->>'shift_start'))::timestamp))) / 60) as mins_late
from pilots p
join assignments a on a.pilot_uuid = p.pilot_uuid and coalesce(a.valid_to, current_date) >= current_date
join vehicles  v on v.vehicle_uuid = a.vehicle_uuid
join contracts c on c.contract_uuid = a.contract_uuid
where not exists (
  select 1 from attendance_events ae
   where ae.pilot_uuid = p.pilot_uuid
     and ae.event_type = 'LOGIN'
     and ae.event_ts::date = current_date
)
and ((current_date || ' ' || (c.sla_json->>'shift_start'))::timestamp - now()) < interval '15 min'
order by shift_start;
```

Color code:
- **🟢** `mins_late <= 0` (just the shift hasn't started yet)
- **🟡** `0 < mins_late < 10`
- **🔴** `mins_late >= 10`

### Tile 2 — Vehicles not fit for dispatch

```sql
select v.vehicle_code, v.status,
       (select min(scheduled_for) from maintenance m where m.vehicle_uuid = v.vehicle_uuid and m.done_at is null) as next_maint,
       (select max(soc_end_pct)  from battery_logs  b where b.vehicle_uuid = v.vehicle_uuid and b.ended_at  is null) as current_soc
  from vehicles v
 where v.status <> 'ACTIVE'
    or exists (select 1 from maintenance m where m.vehicle_uuid = v.vehicle_uuid and m.scheduled_for = current_date)
    or exists (select 1 from battery_logs b where b.vehicle_uuid = v.vehicle_uuid and b.ended_at is null and b.soc_end_pct < 60);
```

### Tile 3 — Yesterday's performance (from `daily_performance`)

| Metric | Formula |
|--------|---------|
| On-time % | `sum(orders_delivered_on_time) / sum(orders_delivered)` |
| Orders completion | `sum(orders_delivered) / sum(orders_assigned)` |
| SLA breaches | `count(sla_events where detected_at::date = yesterday)` |
| Revenue | `sum(line_items) from invoices preview` |
| Vehicle idle h | `sum(hours_in_shift - hours_with_order_activity)` |
| Δ vs 7-day avg | compare to `avg over 7 days` |

### Tile 4 — Open tickets (priority > MEDIUM or age > 2 days)

```sql
select ticket_uuid, type, subject, amount_disputed_inr, opened_at
  from tickets
 where status in ('OPEN','IN_PROGRESS','WAITING')
   and (priority = 'HIGH' or opened_at < now() - interval '2 days')
 order by priority desc, opened_at asc
 limit 5;
```

### Tile 5 — This week

- Contracts where `valid_to BETWEEN current_date AND current_date + 7`.
- Leads where `next_followup_at::date = current_date`.
- Invoice draft if day-of-month between 1 and 5.

## Actions on each tile

Every row has exactly one primary action (Retool button row):

| Tile | Action | Implementation |
|------|--------|----------------|
| Shift Risk row | `Call` | Exotel click-to-call |
| Shift Risk row | `WA reminder` | Interakt `pilot_late_login` |
| Vehicle row | `Open vehicle` | Deep-link to Retool Vehicle page |
| Yesterday tile | `View breakdown` | Deep-link to Ops page |
| Ticket row | `Open ticket` | Retool Ticket page |
| Week tile | `Open` | Contract / Invoice / Leads page |

## Refresh behaviour

- **Shift Risk:** polls every 60 s until 10:00, then every 5 min.
- **Others:** on page load + manual refresh.
- Data uses `daily_performance` (materialised by the 22:00 cron) — no heavy aggregation at 8 AM.

## Parallel WhatsApp digest

Same data goes out as `admin_morning_digest` template to admins' personal
WhatsApp at 07:45. A one-tap link opens the Retool dashboard. The message is
intentionally short (one screen, no scrolling).
