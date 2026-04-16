-- ============================================================================
-- Fleet Management & Business Ops — Postgres / Supabase DDL
-- Run once in a fresh Supabase project. Idempotent where safe.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── enums ────────────────────────────────────────────────────────────────────
do $$ begin
  create type pilot_role      as enum ('DRIVER','DA','BUFFER');
  create type vehicle_type    as enum ('E3W','E4W');
  create type vehicle_status  as enum ('ACTIVE','BREAKDOWN','MAINT','RETIRED');
  create type order_status    as enum ('ASSIGNED','IN_TRANSIT','DELIVERED','UNDELIVERED','RTO');
  create type sla_type        as enum ('LATE_LOGIN','LATE_DELIVERY','MISSED_DELIVERY','IDLE_2H','NO_LOGOUT','BATTERY_LOW');
  create type sla_severity    as enum ('WARN','BREACH','CRITICAL');
  create type ticket_type     as enum ('SHORT_PAYMENT','DAMAGED_GOODS','HUB_ISSUE','PILOT_COMPLAINT','CLIENT_COMPLAINT');
  create type ticket_status   as enum ('OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED');
  create type notif_channel   as enum ('WHATSAPP','SMS','CALL','EMAIL');
  create type notif_status    as enum ('QUEUED','SENT','DELIVERED','READ','FAILED');
  create type event_type      as enum ('LOGIN','LOGOUT');
  create type maint_type      as enum ('PREVENTIVE','REPAIR','INSPECTION');
  create type lead_stage      as enum ('NEW','CONTACTED','INTERVIEW','TRAINING','ONBOARDED','REJECTED');
  create type invoice_status  as enum ('DRAFT','SENT','PAID','DISPUTED');
  create type breakdown_cat   as enum ('BATTERY','MOTOR','TYRE','ACCIDENT','OTHER');
  create type breakdown_status as enum ('OPEN','SWAP_IN_PROGRESS','RESOLVED');
exception when duplicate_object then null; end $$;

-- ── identity & assets ────────────────────────────────────────────────────────
create table if not exists hubs (
  hub_uuid    uuid primary key default gen_random_uuid(),
  client_uuid uuid,
  name        text not null,
  lat         numeric(9,6) not null,
  lng         numeric(9,6) not null,
  radius_m    int not null default 500,
  created_at  timestamptz default now()
);

create table if not exists vendors (
  vendor_uuid        uuid primary key default gen_random_uuid(),
  name               text not null unique,
  helpdesk_phone     text,
  helpdesk_whatsapp  text,
  sla_response_min   int default 60
);

create table if not exists pilots (
  pilot_uuid        uuid primary key default gen_random_uuid(),
  emp_id            text not null unique,         -- links to lsn-pilot-tracker
  full_name         text,
  role              pilot_role not null,
  phone             text,
  emergency_phone   text,
  home_hub_uuid     uuid references hubs(hub_uuid),
  pay_rate_monthly  numeric(10,2),
  trained           bool default false,
  training_date     date,
  status            text default 'Active',
  created_at        timestamptz default now()
);

create table if not exists vehicles (
  vehicle_uuid    uuid primary key default gen_random_uuid(),
  vehicle_code    text not null unique,           -- VH-01, VH-02...
  type            vehicle_type not null,
  model           text,
  oem             text,
  vendor_uuid     uuid references vendors(vendor_uuid),
  reg_no          text,
  battery_kwh     numeric(6,2),
  max_range_km    int,
  da_configured   bool default false,
  status          vehicle_status not null default 'ACTIVE',
  created_at      timestamptz default now()
);

create table if not exists clients (
  client_uuid      uuid primary key default gen_random_uuid(),
  name             text not null,
  gstin            text,
  billing_email    text,
  billing_whatsapp text
);

create table if not exists contracts (
  contract_uuid uuid primary key default gen_random_uuid(),
  client_uuid   uuid not null references clients(client_uuid),
  hub_uuid      uuid references hubs(hub_uuid),
  rate_card     jsonb not null,                   -- {per_order, per_km, per_day_min, incentive_tiers[]}
  sla_json      jsonb not null,                   -- {shift_start:'08:00', grace_min:10, on_time_target_pct:95}
  valid_from    date not null,
  valid_to      date,
  status        text default 'ACTIVE'
);

alter table hubs
  add constraint fk_hubs_client
  foreign key (client_uuid) references clients(client_uuid)
  deferrable initially deferred;

create table if not exists assignments (
  assignment_uuid uuid primary key default gen_random_uuid(),
  pilot_uuid      uuid not null references pilots(pilot_uuid),
  vehicle_uuid    uuid references vehicles(vehicle_uuid),
  contract_uuid   uuid references contracts(contract_uuid),
  valid_from      date not null default current_date,
  valid_to        date,
  is_primary      bool not null default true
);

create index if not exists ix_assign_active
  on assignments(pilot_uuid) where valid_to is null;

-- ── CRM ──────────────────────────────────────────────────────────────────────
create table if not exists pipeline_stages (
  stage_uuid uuid primary key default gen_random_uuid(),
  name       text not null,
  order_idx  int  not null,
  is_won     bool default false,
  is_lost    bool default false
);

create table if not exists crm_opportunities (
  opp_uuid        uuid primary key default gen_random_uuid(),
  name            text not null,
  contact_name    text,
  contact_phone   text,
  stage_uuid      uuid references pipeline_stages(stage_uuid),
  estimated_mrr   numeric(10,2),
  next_action_at  timestamptz,
  owner_user_id   uuid,
  created_at      timestamptz default now()
);

create table if not exists leads (
  lead_uuid     uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone         text not null,
  city          text,
  has_license   bool,
  owns_vehicle  bool,
  source        text,
  stage         lead_stage not null default 'NEW',
  assigned_to   uuid,
  created_at    timestamptz default now()
);

create table if not exists lead_activities (
  activity_uuid    uuid primary key default gen_random_uuid(),
  lead_uuid        uuid not null references leads(lead_uuid) on delete cascade,
  type             text not null,                -- CALL|WA|SMS|MEETING
  notes            text,
  outcome          text,
  next_followup_at timestamptz,
  created_at       timestamptz default now()
);

-- ── operations ───────────────────────────────────────────────────────────────
create table if not exists attendance_events (
  event_uuid    uuid primary key default gen_random_uuid(),
  pilot_uuid    uuid not null references pilots(pilot_uuid),
  vehicle_uuid  uuid references vehicles(vehicle_uuid),
  hub_uuid      uuid references hubs(hub_uuid),
  event_type    event_type not null,
  event_ts      timestamptz not null,
  lat           numeric(9,6),
  lng           numeric(9,6),
  distance_m    int,
  source        text,
  raw           jsonb
);

create index if not exists ix_attendance_pilot_ts
  on attendance_events(pilot_uuid, event_ts desc);

create table if not exists orders (
  order_uuid            uuid primary key default gen_random_uuid(),
  loadshare_id          text unique,
  pilot_uuid            uuid references pilots(pilot_uuid),
  vehicle_uuid          uuid references vehicles(vehicle_uuid),
  contract_uuid         uuid references contracts(contract_uuid),
  assigned_at           timestamptz,
  promised_delivery_at  timestamptz,
  delivered_at          timestamptz,
  status                order_status not null default 'ASSIGNED',
  cod_amount            numeric(10,2) default 0,
  weight_kg             numeric(8,2),
  destination_pincode   text,
  created_at            timestamptz default now()
);

create index if not exists ix_orders_pilot_day
  on orders(pilot_uuid, (promised_delivery_at::date));

create table if not exists order_events (
  event_uuid  uuid primary key default gen_random_uuid(),
  order_uuid  uuid not null references orders(order_uuid) on delete cascade,
  type        text not null,
  event_ts    timestamptz not null,
  lat         numeric(9,6),
  lng         numeric(9,6),
  notes       text
);

create table if not exists sla_events (
  sla_event_uuid  uuid primary key default gen_random_uuid(),
  pilot_uuid      uuid references pilots(pilot_uuid),
  vehicle_uuid    uuid references vehicles(vehicle_uuid),
  contract_uuid   uuid references contracts(contract_uuid),
  order_uuid      uuid references orders(order_uuid),
  type            sla_type not null,
  severity        sla_severity not null default 'BREACH',
  detected_at     timestamptz not null default now(),
  resolved_at     timestamptz,
  resolution_note text
);

create index if not exists ix_sla_open
  on sla_events(type, detected_at) where resolved_at is null;

create table if not exists daily_performance (
  perf_uuid        uuid primary key default gen_random_uuid(),
  date             date not null,
  pilot_uuid       uuid not null references pilots(pilot_uuid),
  vehicle_uuid     uuid references vehicles(vehicle_uuid),
  contract_uuid    uuid references contracts(contract_uuid),
  login_at         timestamptz,
  logout_at        timestamptz,
  hours_worked     numeric(5,2),
  orders_assigned  int default 0,
  orders_delivered int default 0,
  on_time_pct      numeric(5,2),
  km_driven        numeric(8,2),
  sla_breach_count int default 0,
  unique (date, pilot_uuid)
);

-- ── asset operations ─────────────────────────────────────────────────────────
create table if not exists battery_logs (
  log_uuid     uuid primary key default gen_random_uuid(),
  vehicle_uuid uuid not null references vehicles(vehicle_uuid),
  started_at   timestamptz not null,
  ended_at     timestamptz,
  soc_start_pct int,
  soc_end_pct   int,
  kwh_drawn     numeric(6,2),
  location      text,
  cost_inr      numeric(8,2)
);

create table if not exists maintenance (
  maint_uuid    uuid primary key default gen_random_uuid(),
  vehicle_uuid  uuid not null references vehicles(vehicle_uuid),
  type          maint_type not null,
  scheduled_for date,
  done_at       timestamptz,
  vendor_uuid   uuid references vendors(vendor_uuid),
  cost_inr      numeric(10,2),
  notes         text
);

create table if not exists breakdowns (
  breakdown_uuid uuid primary key default gen_random_uuid(),
  vehicle_uuid   uuid not null references vehicles(vehicle_uuid),
  pilot_uuid     uuid references pilots(pilot_uuid),
  reported_at    timestamptz not null default now(),
  location_lat   numeric(9,6),
  location_lng   numeric(9,6),
  category       breakdown_cat not null,
  status         breakdown_status not null default 'OPEN',
  resolved_at    timestamptz,
  notes          text
);

create table if not exists replacements (
  replacement_uuid    uuid primary key default gen_random_uuid(),
  breakdown_uuid      uuid not null references breakdowns(breakdown_uuid),
  from_vehicle_uuid   uuid references vehicles(vehicle_uuid),
  to_vehicle_uuid     uuid references vehicles(vehicle_uuid),
  buffer_pilot_uuid   uuid references pilots(pilot_uuid),
  eta_minutes         int,
  swap_completed_at   timestamptz,
  status              text default 'PENDING'
);

-- ── disputes / comms ─────────────────────────────────────────────────────────
create table if not exists tickets (
  ticket_uuid         uuid primary key default gen_random_uuid(),
  type                ticket_type not null,
  subject             text not null,
  priority            text default 'MEDIUM',
  status              ticket_status not null default 'OPEN',
  opened_by_user_id   uuid,
  assigned_to_user_id uuid,
  client_uuid         uuid references clients(client_uuid),
  pilot_uuid          uuid references pilots(pilot_uuid),
  order_uuid          uuid references orders(order_uuid),
  amount_disputed_inr numeric(10,2),
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz,
  resolution          text
);

create table if not exists ticket_comments (
  comment_uuid   uuid primary key default gen_random_uuid(),
  ticket_uuid    uuid not null references tickets(ticket_uuid) on delete cascade,
  author_user_id uuid,
  body           text,
  attachments    jsonb,
  created_at     timestamptz default now()
);

create table if not exists notifications (
  notif_uuid     uuid primary key default gen_random_uuid(),
  channel        notif_channel not null,
  to_pilot_uuid  uuid references pilots(pilot_uuid),
  to_phone       text,
  template       text,
  payload        jsonb,
  provider_id    text,
  status         notif_status not null default 'QUEUED',
  sent_at        timestamptz,
  cost_inr       numeric(8,2)
);

create table if not exists automation_runs (
  run_uuid         uuid primary key default gen_random_uuid(),
  workflow_name    text not null,
  trigger_payload  jsonb,
  status           text,
  started_at       timestamptz default now(),
  finished_at      timestamptz,
  error_text       text
);

-- ── finance ──────────────────────────────────────────────────────────────────
create table if not exists invoices (
  invoice_uuid   uuid primary key default gen_random_uuid(),
  client_uuid    uuid not null references clients(client_uuid),
  contract_uuid  uuid references contracts(contract_uuid),
  period_start   date not null,
  period_end     date not null,
  gross_inr      numeric(12,2) not null,
  deductions_inr numeric(12,2) default 0,
  net_inr        numeric(12,2) not null,
  status         invoice_status not null default 'DRAFT',
  pdf_url        text,
  line_items     jsonb,
  created_at     timestamptz default now()
);

create table if not exists payroll (
  payroll_uuid   uuid primary key default gen_random_uuid(),
  pilot_uuid     uuid not null references pilots(pilot_uuid),
  period_start   date not null,
  period_end     date not null,
  base_inr       numeric(10,2),
  incentive_inr  numeric(10,2) default 0,
  deduction_inr  numeric(10,2) default 0,
  net_inr        numeric(10,2),
  status         text default 'DRAFT',
  paid_at        timestamptz,
  unique (pilot_uuid, period_start, period_end)
);

create table if not exists reconciliation (
  recon_uuid         uuid primary key default gen_random_uuid(),
  invoice_uuid       uuid references invoices(invoice_uuid),
  loadshare_remit_inr numeric(12,2),
  variance_inr       numeric(12,2),
  variance_reason    text,
  resolved_at        timestamptz
);

-- ── trigger: evaluate shift-start SLA on every LOGIN event ───────────────────
create or replace function fn_evaluate_shift_start_sla()
returns trigger language plpgsql as $$
declare
  v_contract contracts%rowtype;
  v_shift_start time;
  v_grace int;
  v_login_time time;
  v_date date;
begin
  if new.event_type <> 'LOGIN' then return new; end if;

  select c.* into v_contract
    from assignments a
    join contracts c on c.contract_uuid = a.contract_uuid
   where a.pilot_uuid = new.pilot_uuid
     and (a.valid_to is null or a.valid_to >= new.event_ts::date)
   order by a.is_primary desc
   limit 1;

  if not found then return new; end if;

  v_shift_start := (v_contract.sla_json->>'shift_start')::time;
  v_grace       := coalesce((v_contract.sla_json->>'grace_min')::int, 10);
  v_login_time  := new.event_ts::time;
  v_date        := new.event_ts::date;

  if v_login_time > v_shift_start + make_interval(mins => v_grace) then
    insert into sla_events(pilot_uuid, vehicle_uuid, contract_uuid, type, severity)
    values (new.pilot_uuid, new.vehicle_uuid, v_contract.contract_uuid,
            'LATE_LOGIN',
            case when v_login_time > v_shift_start + interval '30 min' then 'CRITICAL' else 'BREACH' end);
  end if;

  return new;
end $$;

drop trigger if exists trg_shift_start_sla on attendance_events;
create trigger trg_shift_start_sla
after insert on attendance_events
for each row execute function fn_evaluate_shift_start_sla();
