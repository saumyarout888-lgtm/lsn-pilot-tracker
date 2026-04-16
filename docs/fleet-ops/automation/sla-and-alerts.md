# Automation — SLA Monitors & Alert Workflows

Each workflow is a small n8n flow. All of them write to `automation_runs` and
emit outbound messages through `notifications`.

## 1. Shift-start SLA (LATE_LOGIN)

- **Trigger:** DB trigger on `attendance_events` insert (see `schema.sql`).
- **Logic:** compare `login_time` vs `contracts.sla_json.shift_start + grace_min`.
- **Action if late:**
  - `<10 min`: WhatsApp pilot "Please log in, shift started at {{start}}".
  - `10–30 min`: WhatsApp + Exotel call.
  - `>30 min`: call pilot + emergency contact + admin; create `ticket`.
- **Clear:** when login event arrives for that pilot/day.

## 2. Idle watchdog (IDLE_2H)

- **Trigger:** n8n cron every 10 minutes.
- **Query:**
  ```sql
  select p.pilot_uuid, p.phone, v.vehicle_code, max(oe.event_ts) last_event
    from pilots p
    join assignments a on a.pilot_uuid = p.pilot_uuid and a.valid_to is null
    join vehicles v on v.vehicle_uuid = a.vehicle_uuid
    left join orders o on o.pilot_uuid = p.pilot_uuid and o.promised_delivery_at::date = current_date
    left join order_events oe on oe.order_uuid = o.order_uuid
   where exists (select 1 from attendance_events ae
                   where ae.pilot_uuid = p.pilot_uuid
                     and ae.event_type = 'LOGIN'
                     and ae.event_ts::date = current_date)
   group by p.pilot_uuid, p.phone, v.vehicle_code
  having max(oe.event_ts) is null or max(oe.event_ts) < now() - interval '120 minutes';
  ```
- **Action:** insert `sla_events(type='IDLE_2H')` → fan out: WhatsApp pilot, WhatsApp backup driver, WhatsApp leasing vendor.
- **Escalation:** if still idle 30 min later → open a `breakdown` row → trigger the vehicle-replacement workflow.

## 3. Late delivery (LATE_DELIVERY)

- **Trigger:** Loadshare POD webhook OR cron every 5 min scanning `orders`.
- **Logic:** `delivered_at > promised_delivery_at` or `now() > promised_delivery_at AND status IN ('ASSIGNED','IN_TRANSIT')`.
- **Action:** append `sla_events`; batch-notify admin hourly (don't spam per-order).
- **Severity:** `BREACH` if > 30 min late; `CRITICAL` if > 120 min.

## 4. Battery low (BATTERY_LOW)

- **Trigger:** battery-log ingest (if OEM API available) or pilot manual report.
- **Logic:** SoC < 20% mid-shift AND remaining planned km > predicted range.
- **Action:** WA pilot with nearest charger map link; if within 15 min of shift end, ignore.

## 5. No logout (NO_LOGOUT)

- **Trigger:** cron at 23:00.
- **Logic:** any pilot with `LOGIN` today but no matching `LOGOUT`.
- **Action:** WA pilot; auto-close with flag `source='auto-close'` at midnight so payroll isn't blocked.

## 6. Daily rollup (22:00)

- Aggregates `attendance_events` + `orders` + `sla_events` → upserts `daily_performance`.
- Emits per-pilot WhatsApp "Today: X orders, Y% on-time, Z hours".

## 7. Morning digest (07:45)

- Runs `dashboard-8am.md` query set.
- WA to admins with top 5 risks for the day (late pilots, vehicles in maintenance, contracts expiring this week).

## 8. Weekly Loadshare reconciliation (Mon 10:00)

- Pull last week's Loadshare remittance report → compare to our `invoices`.
- Any variance > ₹500 → open `tickets` type=`SHORT_PAYMENT`.

## Telecalling rules (Exotel)

- Click-to-call button on every pilot row in Retool.
- Auto-call is limited to: LATE_LOGIN > 30 min, IDLE_2H breach, breakdown escalation to admin. No marketing dials.
- Call recordings stored as signed URLs in `notifications.payload`.

## WhatsApp template catalogue

| Template | Purpose | Variables |
|----------|---------|-----------|
| `pilot_shift_reminder` | 07:30 daily reminder | `name, shift_start, hub_name` |
| `pilot_late_login` | On LATE_LOGIN breach | `name, minutes_late` |
| `pilot_breakdown_ack` | Acknowledge breakdown report | `name, vehicle_code` |
| `vendor_breakdown_alert` | Ask vendor to dispatch | `vehicle_code, gmaps_link, pilot_phone` |
| `buffer_dispatch` | Send buffer to site | `name, pickup_addr, gmaps_link` |
| `pilot_daily_summary` | 22:00 day summary | `name, orders, on_time_pct, hours` |
| `admin_morning_digest` | 07:45 admin digest | `on_time_yday, breaches_open, pilots_at_risk` |
| `client_monthly_invoice` | Invoice delivery | `client_name, period, net_amount, pdf_url` |
