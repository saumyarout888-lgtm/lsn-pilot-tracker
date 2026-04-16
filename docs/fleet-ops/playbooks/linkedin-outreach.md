# LinkedIn & Email Outreach Playbook

## 1. ICP — who we target

| Segment | Titles to hit | Signal |
|---|---|---|
| **E-commerce hubs** | Hub Manager, City Ops Lead, Last-Mile Head | Loadshare-active city, 50+ daily drops |
| **FMCG distributors** | Distribution Manager, Logistics Head | Sub-10 km urban dense routes, diesel 3W fleet today |
| **3PL players** | Ops Director, Fleet Head, EV Transition Lead | Public ESG commitments, green-fleet mandates |
| **Quick-commerce / dark stores** | Supply Head, Micro-fulfilment Lead | Sub-60-min SLA pressure |

Disqualify: fleets below 10 vehicles (won't move the needle), pure inter-city
(our 3W/4W tops out at ~150 km/day).

## 2. The 3-step LinkedIn sequence

Scenario target: *"Partner looking for 10+ 3W EV units."*
Replace `{{city}}` with the prospect's metro on each send. Send times are IST.

### Msg 1 — Connection request + 300-char note (send 10:30–11:30 IST, Tue–Thu)

```
Hi {{first_name}}, noticed {{company}} is running last-mile ops in {{city}}.
We run a 3W/4W EV pod under Loadshare here — quietly cut diesel spend by
~₹6/km. No pitch, just curious how your team is thinking about last-mile
carbon reduction in {{city}} this year. Open to connect.
```

Rules: no emoji, no link, no attachment. Just curiosity.

### Msg 2 — Reliability proof (send 3 working days after Msg 1, only if accepted)

```
Thanks for connecting, {{first_name}}.

Quick context in case it's useful: our fleet holds 95%+ on-time delivery
against Loadshare's SLA on 3W EVs — we track it per shift, vehicle, and
pilot in a closed-loop dashboard (happy to share a sanitised screenshot).

Most of the distributors we talk to in {{city}} are evaluating a 10–20
unit 3W EV pod for their ≤8 km routes. Two things consistently surprise
them:
  1. Per-km cost drops from ~₹9 (diesel 3W) to ~₹3 (electric).
  2. Vehicle downtime, not cost, is the actual profit lever — ours sits
     below 45 min mean-time-to-recover.

If you're scoping anything in that shape, I can share the math and a
short reference from a live hub. No obligation.
```

Rules: one screenshot if asked, never in the DM. Reference "Loadshare"
exactly once — overuse signals dependency.

### Msg 3 — Soft ask (send 5 working days after Msg 2, only if no reply but no rejection)

```
{{first_name}}, last one from me.

Would a 15-min call next week make sense? Goal: I walk you through
real per-km numbers from our {{city}} pod vs. your current 3W cost,
you decide if it's worth a deeper chat. No deck.

Two slots open: {{slot_1}} or {{slot_2}}. Or send me a time that works.
```

If still no reply after Msg 3 — mark `crm_opportunities.stage = LOST (no_response)`,
re-engage after 90 days.

## 3. Cold email — "Cost per Km vs Diesel"

Subject line A/B test:
- A: `{{first_name}}, 3W EV pod in {{city}} — 15 min?`
- B: `Cutting ₹6/km on {{company}}'s last-mile`

Keep subjects ≤ 45 characters — Gmail truncates on mobile past that.

**Body (plain text, no images, no tracking pixel on first touch):**

```
Hi {{first_name}},

Direct pitch: we operate a 3W/4W EV last-mile pod under Loadshare in
{{city}}. For distributors running 10+ 3W units on <8 km routes, the
numbers we see are:

                      Diesel 3W        EV 3W (ours)
  Fuel / km           ₹4.80            ₹0.90 (grid)
  Maint / km          ₹1.40            ₹0.60
  Total op / km       ₹9.10            ₹3.10
  Downtime / month    ~18 hrs          ~6 hrs (95%+ SLA)

At 100 km/day × 10 vehicles × 26 days, that's ~₹15.6 L/yr saved on
per-km cost alone, before ESG credits.

Worth a 15-min call to run your specific route mix against this?
If yes — reply with a slot. If not — no follow-up from me.

{{your_name}}
Founder, {{agency_name}}
{{phone}} · {{linkedin_url}}

Reply STOP and I won't email again.
```

### Deliverability rules

- Send from a warmed mailbox (domain ≥ 60 days old, SPF + DKIM + DMARC green).
- Cap 40 cold emails / day / mailbox in the first 30 days.
- No images, no PDF, no UTM parameters on the first email.
- One plain `https://` link max. Prefer a Calendly-style link **in reply** only.
- Include a plain-language opt-out line (the `Reply STOP` above satisfies this for India + most jurisdictions; for US/EU add a physical address line).
- Avoid trigger words in subject: "Free", "Guarantee", "Act now", "Savings!!".
- Send Tue–Thu 09:30–11:00 IST; Mon/Fri cut open rates ~30%.

## 4. Reply-triage SLA

| Reply type | Person A action | Time |
|---|---|---|
| "Tell me more" | Reply with 1-line question about their route mix + offer a 15-min slot | ≤ 2h |
| "Send a deck" | Send a 1-page PDF (not a 20-page deck) + reiterate call ask | ≤ 4h |
| "Not us / wrong person" | Ask for intro to the right person; log in `crm_opportunities.notes` | ≤ 1 day |
| "Unsubscribe / STOP" | Remove from sequence immediately, log `leads.stage = REJECTED` | ≤ 15 min |

## 5. Weekly prospecting dashboard (Person A, Fri 17:00)

Track in a simple Retool table over `crm_opportunities`:

| Metric | Weekly target |
|---|---|
| New LinkedIn connects sent | 50 |
| Acceptance rate | ≥ 35% |
| Msg 2 replies | ≥ 10 |
| Cold emails sent | 150 |
| Positive replies (call booked) | ≥ 5 |
| Calls held | ≥ 3 |
| Proposals sent | ≥ 1 |

If two consecutive weeks miss the acceptance rate target — rewrite Msg 1.
Don't increase volume to compensate; that just burns the sender reputation.
