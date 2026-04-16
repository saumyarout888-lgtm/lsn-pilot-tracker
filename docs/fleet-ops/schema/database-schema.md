# Database Schema

All tables live in Postgres (Supabase). Primary keys are `uuid` unless noted.
Foreign keys use `ON DELETE RESTRICT` except where called out.

## Core identity — how Pilot ↔ Vehicle ↔ SLA link

```
         pilots                    vehicles                contracts
 ┌──────────────────┐        ┌──────────────────┐     ┌──────────────────┐
 │ pilot_uuid  PK   │        │ vehicle_uuid PK  │     │ contract_uuid PK │
 │ emp_id   UQ      │◀──┐ ┌─▶│ vehicle_code UQ  │     │ client_uuid  FK  │
 │ full_name        │   │ │  │ type (e3W/e4W)   │     │ rate_card jsonb  │
 │ role             │   │ │  │ vendor_uuid FK   │     │ sla_json  jsonb  │
 │ phone            │   │ │  │ oem,model        │     └──────┬───────────┘
 │ home_hub_uuid    │   │ │  │ active_assign    │            │
 └──────────────────┘   │ │  └──────────────────┘            │
          ▲             │ │             ▲                    │
          │             │ │             │                    │
          │             │ └──────┐      │                    │
          │    ┌────────┴─┐  ┌───┴──────┴───────────┐        │
          └────│ assign.  │  │ attendance_events    │        │
               │ active   │  │ order_events         │        │
               │ (many)   │  │ sla_events  ─────────┼────────┘
               └──────────┘  └──────────────────────┘
```

`assignments` is the join table that binds `pilot_uuid × vehicle_uuid × contract_uuid` for a date range — this is the source of truth every other table joins against.

## Tables

### 1. Identity & assets

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `pilots` | Driver/DA/Buffer master | `pilot_uuid` PK, `emp_id` UQ, `role enum(DRIVER,DA,BUFFER)`, `phone`, `emergency_phone`, `pay_rate_monthly`, `trained`, `training_date`, `status`, `home_hub_uuid` FK |
| `hubs` | Loadshare hub geofences | `hub_uuid` PK, `name`, `lat`, `lng`, `radius_m`, `client_uuid` FK |
| `vendors` | EV leasing vendors | `vendor_uuid` PK, `name` (Gentari, Wikilabs...), `helpdesk_phone`, `helpdesk_whatsapp`, `sla_response_min` |
| `vehicles` | Fleet register | `vehicle_uuid` PK, `vehicle_code` UQ (`VH-01`...), `type enum(E3W,E4W)`, `model`, `oem`, `vendor_uuid` FK, `reg_no`, `battery_kwh`, `max_range_km`, `da_configured bool`, `status enum(ACTIVE,BREAKDOWN,MAINT,RETIRED)` |
| `assignments` | Pilot ↔ Vehicle ↔ Contract for a date range | `assignment_uuid` PK, `pilot_uuid` FK, `vehicle_uuid` FK, `contract_uuid` FK, `valid_from date`, `valid_to date`, `is_primary bool` |

### 2. Commercial

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `clients` | Loadshare + any direct clients | `client_uuid` PK, `name`, `gstin`, `billing_email`, `billing_whatsapp` |
| `contracts` | Per-client commercial terms | `contract_uuid` PK, `client_uuid` FK, `hub_uuid` FK, `rate_card jsonb`, `sla_json jsonb` (shift_start, grace_min, on_time_target_pct, min_deliveries), `valid_from`, `valid_to`, `status` |
| `pipeline_stages` | CRM stages | `stage_uuid`, `name`, `order_idx`, `is_won`, `is_lost` |
| `crm_opportunities` | Prospective client deals | `opp_uuid` PK, `name`, `contact_name`, `contact_phone`, `stage_uuid` FK, `estimated_mrr`, `next_action_at`, `owner_user_id` |

### 3. Driver-Partner (lead gen for new pilots)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `leads` | Prospective driver-partners | `lead_uuid` PK, `full_name`, `phone`, `city`, `has_license`, `owns_vehicle`, `source`, `stage enum(NEW,CONTACTED,INTERVIEW,TRAINING,ONBOARDED,REJECTED)`, `assigned_to` |
| `lead_activities` | Touch log | `activity_uuid`, `lead_uuid` FK, `type enum(CALL,WA,SMS,MEETING)`, `notes`, `next_followup_at`, `outcome` |

### 4. Operations

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `attendance_events` | One row per login or logout from the tracker | `event_uuid` PK, `pilot_uuid` FK, `vehicle_uuid` FK (nullable for buffer), `hub_uuid` FK, `event_type enum(LOGIN,LOGOUT)`, `event_ts timestamptz`, `lat`, `lng`, `distance_m`, `source text`, `raw jsonb` |
| `orders` | One row per Loadshare consignment | `order_uuid` PK, `loadshare_id` UQ, `pilot_uuid` FK (nullable until assigned), `vehicle_uuid` FK, `contract_uuid` FK, `assigned_at`, `promised_delivery_at`, `delivered_at`, `status enum(ASSIGNED,IN_TRANSIT,DELIVERED,UNDELIVERED,RTO)`, `cod_amount numeric`, `weight_kg`, `destination_pincode` |
| `order_events` | Lifecycle pings (pickup, handover, attempt, POD) | `event_uuid`, `order_uuid` FK, `type`, `event_ts`, `lat`, `lng`, `notes` |
| `sla_events` | Every breach or near-miss, one row | `sla_event_uuid` PK, `pilot_uuid` FK, `vehicle_uuid` FK, `contract_uuid` FK, `type enum(LATE_LOGIN,LATE_DELIVERY,MISSED_DELIVERY,IDLE_2H,NO_LOGOUT,BATTERY_LOW)`, `severity enum(WARN,BREACH,CRITICAL)`, `detected_at`, `resolved_at`, `resolution_note` |
| `daily_performance` | Materialised one row per pilot per day | `perf_uuid`, `date`, `pilot_uuid`, `vehicle_uuid`, `contract_uuid`, `login_at`, `logout_at`, `hours_worked`, `orders_assigned`, `orders_delivered`, `on_time_pct`, `km_driven`, `sla_breach_count` |

### 5. Assets operations

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `battery_logs` | Charge sessions | `log_uuid`, `vehicle_uuid` FK, `started_at`, `ended_at`, `soc_start_pct`, `soc_end_pct`, `kwh_drawn`, `location`, `cost_inr` |
| `maintenance` | Scheduled + ad-hoc work | `maint_uuid`, `vehicle_uuid` FK, `type enum(PREVENTIVE,REPAIR,INSPECTION)`, `scheduled_for`, `done_at`, `vendor_uuid` FK, `cost_inr`, `notes` |
| `breakdowns` | Each breakdown incident | `breakdown_uuid` PK, `vehicle_uuid` FK, `pilot_uuid` FK, `reported_at`, `location_lat`, `location_lng`, `category enum(BATTERY,MOTOR,TYRE,ACCIDENT,OTHER)`, `status enum(OPEN,SWAP_IN_PROGRESS,RESOLVED)`, `resolved_at` |
| `replacements` | Swap lifecycle for a breakdown | `replacement_uuid`, `breakdown_uuid` FK, `from_vehicle_uuid` FK, `to_vehicle_uuid` FK, `buffer_pilot_uuid` FK, `eta_minutes`, `swap_completed_at`, `status` |

### 6. Disputes & comms

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `tickets` | Disputes / escalations | `ticket_uuid` PK, `type enum(SHORT_PAYMENT,DAMAGED_GOODS,HUB_ISSUE,PILOT_COMPLAINT,CLIENT_COMPLAINT)`, `subject`, `priority`, `status`, `opened_by_user_id`, `assigned_to_user_id`, `client_uuid` FK, `pilot_uuid` FK, `order_uuid` FK, `amount_disputed_inr`, `opened_at`, `closed_at`, `resolution` |
| `ticket_comments` | Threaded comments | `comment_uuid`, `ticket_uuid` FK, `author_user_id`, `body`, `attachments jsonb`, `created_at` |
| `notifications` | Outbound WA/SMS/call log | `notif_uuid` PK, `channel enum(WHATSAPP,SMS,CALL,EMAIL)`, `to_pilot_uuid` FK (nullable), `to_phone`, `template`, `payload jsonb`, `provider_id`, `status enum(QUEUED,SENT,DELIVERED,READ,FAILED)`, `sent_at`, `cost_inr` |
| `automation_runs` | n8n execution receipts | `run_uuid`, `workflow_name`, `trigger_payload jsonb`, `status`, `started_at`, `finished_at`, `error_text` |

### 7. Finance

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `invoices` | Client bills | `invoice_uuid` PK, `client_uuid` FK, `contract_uuid` FK, `period_start`, `period_end`, `gross_inr`, `deductions_inr`, `net_inr`, `status enum(DRAFT,SENT,PAID,DISPUTED)`, `pdf_url`, `line_items jsonb` |
| `payroll` | Pilot pay | `payroll_uuid`, `pilot_uuid` FK, `period_start`, `period_end`, `base_inr`, `incentive_inr`, `deduction_inr`, `net_inr`, `status`, `paid_at` |
| `reconciliation` | Loadshare remittance vs our invoice | `recon_uuid`, `invoice_uuid` FK, `loadshare_remit_inr`, `variance_inr`, `variance_reason`, `resolved_at` |

### 8. Auth

| Table | Purpose |
|-------|---------|
| `app_users` | Admin logins (handled by `auth.users` in Supabase; this is a profile table with `role enum(ADMIN,OPS,FINANCE,VIEWER)`) |

## Key indexes

```sql
CREATE UNIQUE INDEX ux_pilots_emp_id       ON pilots(emp_id);
CREATE UNIQUE INDEX ux_vehicles_code       ON vehicles(vehicle_code);
CREATE INDEX        ix_attendance_pilot_ts ON attendance_events(pilot_uuid, event_ts DESC);
CREATE INDEX        ix_orders_pilot_day    ON orders(pilot_uuid, (promised_delivery_at::date));
CREATE INDEX        ix_sla_open            ON sla_events(type, detected_at) WHERE resolved_at IS NULL;
CREATE INDEX        ix_assign_active       ON assignments(pilot_uuid) WHERE valid_to IS NULL OR valid_to >= CURRENT_DATE;
```

## Row-level security (sketch)

- `pilots.*`: admins see all; ops see all; finance sees only non-PII columns (view).
- `payroll.*`: finance + admin only.
- `tickets.*`: author + assignee + admin.
- All tables: `client_uuid` scoped if/when we onboard a second client beyond Loadshare.
