# Conflict & Dispute Resolution Playbook

Every dispute lands in `tickets`. Before typing anything, **categorise first**,
then pick the right template from below. Don't improvise.

## Triage — which bucket?

| Bucket | `tickets.type` values | Typical owner |
|---|---|---|
| **Technical** | `HUB_ISSUE`, `DAMAGED_GOODS` | Person B (Ops) |
| **Financial** | `SHORT_PAYMENT`, `CLIENT_COMPLAINT` (billing) | Person A + B |
| **Behavioral** | `PILOT_COMPLAINT`, `CLIENT_COMPLAINT` (conduct) | Person C |

All three buckets use the same lifecycle: `OPEN → IN_PROGRESS → WAITING → RESOLVED → CLOSED`. Comment trail lives in `ticket_comments`.

## 1. Three-day pilot no-show (Behavioral)

The exact scenario: *"A driver has missed 3 days of attendance according to
the tracker."* Follow this script day by day. Do not skip steps — the Day-3
email is useless without the Day-1 and Day-2 paper trail.

### Detection (read-only SQL for admin to run at 10:00 daily)

```sql
-- Pilots with zero LOGIN on each of the last 3 working days
with days as (
  select generate_series(current_date - 3, current_date - 1, interval '1 day')::date as d
)
select p.emp_id, p.full_name, p.phone, p.emergency_phone,
       array_agg(d.d order by d.d) as missed_dates
  from pilots p
  cross join days d
  left join attendance_events ae
    on ae.pilot_uuid = p.pilot_uuid
   and ae.event_type = 'LOGIN'
   and ae.event_ts::date = d.d
 where p.status = 'Active'
   and ae.event_uuid is null
 group by p.emp_id, p.full_name, p.phone, p.emergency_phone
having count(*) = 3;
```

If a row comes back, open a `ticket(type=PILOT_COMPLAINT, priority=HIGH)` and
work the template set below.

### Day 1 — Soft check-in (WhatsApp, 09:00 the same day)

Use the existing `pilot_shift_reminder` template (no new template required):

> Hi {{name}}, you're expected at {{hub_name}} for the {{shift_start}} shift
> today. Reply 1 if you're on the way, 2 if there's an issue, 9 to speak to a
> manager.

If no reply by 11:00 — Exotel call via the "Call" button on Shift Risk tile.
Log outcome in `ticket_comments`.

### Day 2 — Formal notice (WhatsApp + call, 09:00)

**WhatsApp (free-form after 24h window, inside 24h if prior consent):**

```
{{name}}, this is {{admin_name}} from {{agency}}.

You've missed two consecutive shifts ({{date_1}}, {{date_2}}) without
informing us. As per our onboarding terms, unauthorised absence of
three or more consecutive working days may lead to contract
termination and recovery of the assigned vehicle ({{vehicle_code}}).

Please call {{admin_phone}} within 24 hours to confirm your status.
If there is a medical or family emergency, share details — we will
work with you.

– {{agency}}
```

**Exotel call script (60 seconds, for the admin):**

```
1. "Hi {{name}}, this is {{admin_name}} from {{agency}}. Am I catching
    you at a bad time?"
2. "I'm calling because you haven't logged in for two days. I wanted
    to check in personally before we escalate. Everything okay?"
3. If emergency → ask for documentation (medical slip / family
    bereavement) and agree a return date. Log in ticket_comments.
4. If no valid reason → "I have to flag this officially. If you're
    not at the hub by tomorrow's shift start, we will issue a formal
    termination notice and begin vehicle recovery. Is that clear?"
5. Always close with: "Is there anything we can help with to make
    sure you're back tomorrow?"
```

### Day 3 — Written warning + legal notice (Email, by 17:00)

Send from the agency's registered email; CC the pilot's personal email
and their emergency contact. Attach: copy of signed onboarding agreement,
screenshot of `attendance_events` showing the three missing dates.

**Subject:** `Notice of Unauthorised Absence — {{emp_id}} {{full_name}}`

**Body:**

```
Dear {{full_name}} ({{emp_id}}),

This is a formal notice regarding your unauthorised absence from duty
on {{date_1}}, {{date_2}}, and {{date_3}}. Per Clause {{X}} of the
Pilot-Partner Agreement dated {{signed_on}}, absence of three or more
consecutive working days without prior written intimation constitutes
a material breach.

Required within 48 hours of receipt of this email:
  1. Written explanation of the absence, with supporting documents if
     applicable (medical certificate, etc.).
  2. Confirmation of your intent to resume duty at {{hub_name}} from
     {{date}} onwards.
  3. Confirmation of the condition and location of the assigned
     vehicle {{vehicle_code}} ({{reg_no}}).

Failure to respond within 48 hours will result in:
  a. Immediate termination of the Pilot-Partner Agreement.
  b. Initiation of vehicle recovery proceedings at your current
     registered address, per Clause {{Y}}.
  c. Forfeiture of pending dues against outstanding advances, if any.

We urge you to respond promptly. If there is a genuine emergency,
we remain open to discussion in good faith.

Regards,
{{admin_name}}
{{title}}, {{agency}}
{{phone}} · {{email}}
```

> **Legal caveat:** above is a template, **not legal advice**. Have a
> lawyer review the exact clauses and penalties for your jurisdiction
> before sending the first one. Once reviewed, reuse for every future
> Day-3 notice.

### If Day 3 elapses with no response

1. Update `tickets.status = WAITING`, set `amount_disputed_inr` if advance is outstanding.
2. Person C opens a `breakdowns`-analog workflow — but for recovery, not swap. See section 3 below.
3. Inform Loadshare that the `emp_id` is suspended; reassign their orders to a buffer.

## 2. Other template sets

### Short-payment (Financial — `SHORT_PAYMENT`)

Open a ticket from the weekly reconciliation cron. Client email template:

```
Subject: Short-payment on remittance {{remit_id}} — ₹{{variance_inr}}

Hi {{client_billing_contact}},

We received {{remit_amount}} for the period {{period_start}}–{{period_end}}
against our invoice {{invoice_id}} of {{invoice_amount}}, a variance of
₹{{variance_inr}}.

Attached: our invoice, Loadshare remittance report, per-order
reconciliation CSV.

Could you confirm the reason for the variance? If it reflects legitimate
deductions (SLA breach, RTO, damage), we will adjust the invoice. If it's
a processing gap, please expedite the balance.

Target resolution: 5 working days.
```

### Damaged goods (Technical — `DAMAGED_GOODS`)

Within 2 hours of POD dispute, collect:
- Photo of the damaged item (pilot uploads in tracker PWA).
- Time-stamped order trail from `order_events`.
- Hub handover sign-off (if pre-existing damage).

Pilot WA (free-form):

```
{{name}}, hub {{hub}} has raised a damage claim on order {{order_id}}.
Please share 3 clear photos of the item and the outer packaging within
30 minutes. If the packaging was already damaged at pickup, also share
the pickup photo if you took one.
```

### Hub issue (Technical — `HUB_ISSUE`)

E.g., hub refusing to hand over, geofence mismatch, manifest shortage.
Person B calls the hub manager first; if unresolved in 30 min, emails
Loadshare operations with the `tickets.ticket_uuid` as reference ID.

## 3. Vehicle Recovery / Repossession checklist

For non-payment, contract breach, or the Day-3 escalation above. Cross-links
to [`automation/vehicle-replacement.md`](../automation/vehicle-replacement.md)
for the operational side (swap, buffer dispatch) — this section is the
**legal / recovery** layer that runs alongside it.

| # | Step | Owner | Artefact |
|---|---|---|---|
| 1 | Freeze the asset in ops — set `vehicles.status = BREAKDOWN` so orders don't route to it | Person B | DB update |
| 2 | Pull last 7 days of GPS from the tracker (`attendance_events.lat/lng`) + any vendor telematics | Person C | `recovery_packet.pdf` |
| 3 | Send written recovery notice (email + registered post) to the pilot's address on file | Person C | Notice template below |
| 4 | WhatsApp notice to the pilot (confirmed receipt via blue tick) | Person C | `pilot_breakdown_ack` variant |
| 5 | Inform the leasing vendor (`vendors.helpdesk_whatsapp`) so they update their insurance / RC lock | Person C | `vendor_breakdown_alert` variant |
| 6 | Schedule physical recovery: 2-person team + tow, daylight only, carry signed agreement copy | Person C | Visit checklist |
| 7 | On recovery: photograph vehicle condition (360°), battery SoC, odometer; capture GPS at handover | Person C | Handover form |
| 8 | Update `vehicles.status = MAINT`, open `maintenance(type=INSPECTION)`, close ticket | Person C | DB updates |
| 9 | Reassign any pending advances / dues to `payroll.deduction_inr` or legal demand notice | Person A | Draft PDF |

### Recovery notice (short form, post + email)

```
Subject: Notice of Vehicle Recovery — {{vehicle_code}} ({{reg_no}})

Dear {{full_name}} ({{emp_id}}),

Further to our notice dated {{notice_date}}, the Pilot-Partner Agreement
between you and {{agency}} stands terminated with effect from {{date}}.

The vehicle assigned to you — {{vehicle_code}}, registration {{reg_no}},
currently located at GPS {{lat}}, {{lng}} as of {{timestamp}} — is the
property of {{vendor_name}} / {{agency}} and must be returned to
{{return_hub}} within 48 hours.

If the vehicle is not returned, our authorised personnel will recover
it from its current location, per Clause {{Y}} of the Agreement.
Recovery costs and any damage assessment will be deducted from any
dues payable to you.

Please contact {{admin_phone}} if you wish to coordinate a peaceful
handover.

Regards,
{{admin_name}}, {{agency}}
```

### Handover form (fields to capture at recovery)

- Date, time, recovery location lat/lng.
- Odometer reading, battery SoC %.
- 360° photos (8 angles + dashboard + boot/cargo area).
- Keys returned (Y/N), documents returned (RC, insurance, permit).
- Damage noted (free text + photos).
- Signatures: recovery agent, pilot (if present), neutral witness.

## 4. Telecalling scripts

### 4a. New pilot onboarding (Person C, 5 min call)

```
1. "Hi {{name}}, this is {{caller}} from {{agency}}. Got 5 minutes?"
2. Confirm: name, phone, alt phone, city, DL number, DL expiry.
3. "We run 3W/4W EVs under Loadshare. Shifts are {{shift_pattern}},
    pay is {{pay_rate}}, fuel is battery — no cash for diesel."
4. Qualify: "Have you driven an EV before? Any fines pending? Any
    preferred hub?"
5. Next step: "We'll send a WhatsApp with the onboarding form. Fill
    it in 24 hours. If you pass, training is on {{training_date}}."
6. Close: "Any questions for me?"
```

After the call — insert into `leads(stage=CONTACTED)` with outcome in
`lead_activities`.

### 4b. Vendor invoice chase (Person C, 3 min call)

```
1. "Hi {{vendor_contact}}, {{caller}} from {{agency}}. Calling about
    invoice {{invoice_id}} raised {{raised_on}} for ₹{{amount}}."
2. "It's {{days_overdue}} days past due. Any reason for the delay?"
3. Listen. If dispute — agree a resolution path with a deadline.
    If admin gap — ask for expected payment date in writing (WA ok).
4. "I'll follow up if I don't see it by {{date}}. Thanks for sorting."
```

Log outcome in `tickets(type=SHORT_PAYMENT)` if dispute, else in
`ticket_comments` on the existing invoice ticket.

## 5. Guardrails

- **Never** send a Day-3 email without the Day-1 and Day-2 records in `ticket_comments` — no paper trail = notice is toothless.
- **Never** recover a vehicle without daylight + 2 people + signed agreement copy.
- **Never** settle a financial dispute over WhatsApp only. Every ₹ over ₹5,000 goes into email.
- Every call lasting > 5 min **must** be logged with a 2-line summary in `ticket_comments`. If it's not in the ticket, it didn't happen.
