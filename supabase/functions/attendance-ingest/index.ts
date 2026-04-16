// Edge Function: attendance-ingest
//
// Accepts the two payload shapes currently produced by src/DmartTracker.jsx:
//   LOGIN  (on sign-in):
//     { vid, type, driver, da, start, end:"", parcels:"", charging:"",
//       status:"Active", date:"16-Apr-2026" }
//   LOGOUT (on sign-out):
//     { date, vehicleId, type, driverName, daName, shiftStart, shiftEnd,
//       driverPresent, daPresent, parcels, mgTarget, mgMet, charging,
//       notes, status:"Complete" }
//
// Resolves pilot_uuid + vehicle_uuid + hub_uuid from `assignments` (primary
// assignment valid on the event date) and inserts one row per event into
// `attendance_events`. The DB trigger `fn_evaluate_shift_start_sla` fires
// downstream for LOGIN events.
//
// Deploy:
//   supabase functions deploy attendance-ingest --no-verify-jwt
//   supabase secrets set INGEST_SHARED_TOKEN=<random-32-char-string>
//
// The Apps Script (apps-script/Code.gs) forwards each tracker POST to this
// URL with Authorization: Bearer $INGEST_SHARED_TOKEN.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL                 = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_SHARED_TOKEN          = Deno.env.get("INGEST_SHARED_TOKEN")!;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── date helpers: the tracker emits IST in "dd-MMM-yyyy" + "HH:mm" ──────────
const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4,  Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
function parseIst(date: string, hhmm: string): Date {
  const [d, mon, y] = date.split("-");
  const [h, m]      = hhmm.split(":").map(Number);
  const monthIdx    = MONTHS[mon];
  if (monthIdx === undefined) throw new Error(`bad month in date: ${date}`);
  // IST = UTC+5:30; build the instant in UTC and then back off 330 min.
  const utcMs = Date.UTC(+y, monthIdx, +d, h, m) - 330 * 60 * 1000;
  return new Date(utcMs);
}

type Payload = Record<string, unknown>;
type TrackerEvent = { event_type: "LOGIN" | "LOGOUT"; ts: Date };

function normalize(raw: Payload): { vehicle_code: string; events: TrackerEvent[] } {
  const vehicle_code = String(raw.vid ?? raw.vehicleId ?? "");
  const date         = String(raw.date ?? "");
  const status       = String(raw.status ?? "");
  const events: TrackerEvent[] = [];

  if (!vehicle_code || !date) return { vehicle_code, events };

  if (status === "Active" && raw.start) {
    events.push({ event_type: "LOGIN",  ts: parseIst(date, String(raw.start)) });
  }
  if (status === "Complete" && raw.shiftEnd) {
    events.push({ event_type: "LOGOUT", ts: parseIst(date, String(raw.shiftEnd)) });
  }
  return { vehicle_code, events };
}

async function resolve(vehicle_code: string, onDate: string) {
  const { data: veh, error: vErr } = await db
    .from("vehicles")
    .select("vehicle_uuid")
    .eq("vehicle_code", vehicle_code)
    .maybeSingle();
  if (vErr)  throw vErr;
  if (!veh)  throw new Error(`unknown vehicle_code: ${vehicle_code}`);

  const { data: asn, error: aErr } = await db
    .from("assignments")
    .select("pilot_uuid, contract_uuid, is_primary, pilots:pilot_uuid(home_hub_uuid)")
    .eq("vehicle_uuid", veh.vehicle_uuid)
    .lte("valid_from", onDate)
    .or(`valid_to.is.null,valid_to.gte.${onDate}`)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (aErr) throw aErr;
  if (!asn) throw new Error(`no active assignment for ${vehicle_code} on ${onDate}`);

  return {
    vehicle_uuid: veh.vehicle_uuid as string,
    pilot_uuid:   asn.pilot_uuid   as string,
    contract_uuid: asn.contract_uuid as string | null,
    hub_uuid:     (asn as { pilots?: { home_hub_uuid?: string | null } }).pilots?.home_hub_uuid ?? null,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${INGEST_SHARED_TOKEN}`) return json({ ok: false, error: "unauthorized" }, 401);

  let raw: Payload;
  try { raw = await req.json(); }
  catch { return json({ ok: false, error: "invalid json" }, 400); }

  try {
    const { vehicle_code, events } = normalize(raw);
    if (!vehicle_code || events.length === 0) {
      return json({ ok: false, error: "missing vehicle_code or events" }, 400);
    }

    const onDate   = events[0].ts.toISOString().slice(0, 10);
    const resolved = await resolve(vehicle_code, onDate);

    const rows = events.map((e) => ({
      pilot_uuid:   resolved.pilot_uuid,
      vehicle_uuid: resolved.vehicle_uuid,
      hub_uuid:     resolved.hub_uuid,
      event_type:   e.event_type,
      event_ts:     e.ts.toISOString(),
      source:       "tracker-v1",
      raw,
    }));

    // Idempotency: unique index on (pilot_uuid, event_type, date_trunc('minute', event_ts))
    // is created in supabase/migrations/20260417_attendance_idempotency.sql.
    // A duplicate post therefore raises 23505 — which we swallow as a no-op.
    const { error } = await db.from("attendance_events").insert(rows);
    if (error && (error as { code?: string }).code !== "23505") throw error;

    return json({ ok: true, inserted: rows.length, duplicate: error ? true : false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("attendance-ingest error:", msg, raw);
    return json({ ok: false, error: msg }, 500);
  }
});
