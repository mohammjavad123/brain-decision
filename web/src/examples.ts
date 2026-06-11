/**
 * Three self-contained TEST corpora — each a different company's messy week (~9–10 items), engineered
 * to probe a specific capability. Load one from the Memory tab, ingest, run its queries, then
 * `clean memory` and load the next (each is a fresh case). Every corpus deliberately mixes:
 *   • explicit FACTS (stated outright)
 *   • SIGNAL-only patterns (only surface when items are clustered by meaning, not keywords)
 *   • layered CONTRADICTIONS (items that conflict across time/condition)
 *   • GAPS (information NOT present — the brain must say "I don't know", never invent)
 *   • entity noise (same person/company under name variants)
 */

// ─────────────────────────────────────────────────────────────────────────────
// ① Northwind Robotics — runway contradiction + research + a logged decision (Q3-class, the deep one).
// The runway story moves across time: $4.2M / ~$300k/mo → 14 months (Feb); onshoring pushed burn up,
// so 14mo is stale (Apr); the clean current burn is a RANGE, not a number (May memo — a GAP that tempts
// invention); +3 FTEs ≈ −5 months IF both pilots sign (conditional); the investor wants ≥12 months clean
// post-raise (a target). Defensible answer: reconcile, flag current burn UNKNOWN, recommend getting it.
// ─────────────────────────────────────────────────────────────────────────────
export const EXAMPLE_1 = `---
id: note/board-feb
type: note
date: 2026-02-18
author: Elena Suri
participants: [Elena Suri, Raj Mehta, Lin Zhao]
---
Northwind Robotics — February board notes. Present: Elena Suri (CEO), Raj Mehta (CFO), Lin Zhao (SeedWell, board).
Cash: Raj reported ~$4.2M in the bank and current spend around $300k/month, so about 14 months of runway.
Focus stays on warehouse robotic arms. Two enterprise pilots (Vortex, Halden) are in early conversations.
Lin pushed us to keep burn disciplined ahead of any bridge round.

---
id: email/investor-update-apr
type: email
date: 2026-04-30
author: Elena Suri
participants: [Elena Suri, SeedWell Capital]
---
April investor update. The big move: we onshored manufacturing in March. Quality is up, lead times are down,
and per-unit economics improved. The flip side is that our monthly burn rose materially after the move, so the
14-month runway I shared in February is no longer accurate. Raj is recomputing the clean number now — there are
still one-time onshoring costs sitting in the figures that we need to strip out.

---
id: memo/cfo-burn-note
type: note
date: 2026-05-14
author: Raj Mehta
participants: [Raj Mehta, Elena Suri]
---
CFO note on burn. Post-onshoring our run-rate is clearly higher. I'm modelling somewhere between $380k and $430k
per month, but it is NOT clean yet — there are one-time relocation and tooling costs still mixed in, plus a vendor
credit we haven't applied. I don't want to put a single runway number in front of the board until I've stripped
those out. Treat anything precise as provisional until I finish the clean model.

---
id: slack/finance-thread
type: slack
date: 2026-05-22
author: Raj Mehta
participants: [Raj Mehta, Elena Suri]
---
Raj: if we sign BOTH enterprise pilots (Vortex and Halden) we'll need about 3 more field-engineering FTEs to support them on-site.
Raj: fully loaded that's roughly five months of runway gone once they're all ramped.
Elena: so the runway I can actually defend to the board depends on whether we greenlight those hires.
Raj: correct. And on the clean burn number, which I'm still finishing.

---
id: call/vortex-pilot
type: call
date: 2026-05-10
author: Elena Suri
participants: [Elena Suri, Priya Anand]
---
Priya Anand (Vortex Logistics): we're keen on a pilot. But we'd need on-site support during rollout — your engineers
on our floor for the first couple of months while we integrate with our WMS.
Elena: understood. That's a real staffing commitment on our side, not just software.

---
id: call/halden-pilot
type: call
date: 2026-05-18
author: Elena Suri
participants: [Elena Suri, Tomas Reuter]
---
Tomas Reuter (Halden Freight): the arms look great. Like the other large rollouts, we'd expect dedicated support
engineers during deployment — we won't run this with a Slack channel and good intentions.
Elena: noted. Same on-site support pattern as Vortex.

---
id: note/revenue-snapshot
type: note
date: 2026-05-28
author: Raj Mehta
participants: [Raj Mehta]
---
Revenue snapshot: ARR is about $1.1M and growing, but not fast enough to materially extend runway on its own in the
near term. The runway question is a spend question, not a revenue one, until the pilots convert.

---
id: email/seedwell-lin
type: email
date: 2026-06-01
author: Lin Zhao
participants: [Lin Zhao, Elena Suri]
---
Lin Zhao (SeedWell): as you prep the bridge conversation — we'll want to see at least 12 months of CLEAN runway
post-raise before we lead. Get me a burn number you actually believe, not a February number.

---
id: note/exec-sync-jun
type: note
date: 2026-06-03
author: Elena Suri
participants: [Elena Suri, Raj Mehta]
---
Exec sync. Action: Raj to deliver the clean monthly burn (one-time costs stripped) before we open the raise
conversation. Until then we treat the current runway number as unknown — we do not quote a precise figure externally.

---
id: tweet/elena-0605
type: tweet
date: 2026-06-05
author: Elena Suri
participants: []
---
shipping our v2 arm next month — faster, quieter, lighter, and built in-house now 🦾`;

// The three questions we validated against this corpus (see docs/TEST-CASES.md). ★ = the hero for the case.
export const QUESTIONS_1 = [
  { q: "What runway can I defend to the board?", probes: "contradiction + gap", hero: true },
  { q: "Should we sign both enterprise pilots given the runway?", probes: "conditional trade-off", hero: false },
  { q: "What post-raise runway buffer do Series-A robotics startups aim for?", probes: "web research", hero: false },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// ② Bistro POS — signal aggregation + entity resolution + the evidence bar ("is it real?").
// The accounting/QuickBooks objection recurs across FIVE restaurants, each phrased differently (keywords
// won't catch it — only clustering by meaning). "Maria Lopez" / "Maria L." / "M. Lopez" are one AE.
// "ServeStack" recurs 3×. Decoys that must NOT be promoted to real objections: a one-off "pricey",
// a one-off "onboarding felt long", and a 2× "loyalty feature" request (emerging, not decision-grade).
// ─────────────────────────────────────────────────────────────────────────────
export const EXAMPLE_2 = `---
id: call/luna-diner
type: call
date: 2026-06-01
author: Maria Lopez
participants: [Maria Lopez, Sam Tran]
---
Sam Tran (Luna Diner): honestly the dealbreaker for us is that it doesn't sync with our accountant's tools.
The POS itself is lovely — staff picked it up in a day — but if month-end becomes manual again, it's a no.

---
id: call/corner-cafe
type: call
date: 2026-06-03
author: Maria Lopez
participants: [Maria Lopez, Bea Ortiz]
---
Bea Ortiz (Corner Cafe): we can't move off our current system unless yours talks to QuickBooks. That's the whole
thing for us — our bookkeeper would revolt otherwise. Everything else you showed is better than what we have.

---
id: call/harbor-grill
type: call
date: 2026-06-05
author: Maria L.
participants: [Maria L., Devon Pike]
---
Devon Pike (Harbor Grill): the books integration is table stakes — without it we're out, full stop. Also worth
flagging: we're evaluating ServeStack alongside you, mostly because we heard they already handle the accounting side.

---
id: call/oak-tavern
type: call
date: 2026-06-06
author: Maria Lopez
participants: [Maria Lopez, Lena Park]
---
Lena Park (Oak Tavern): your reporting is genuinely great. But if it can't push numbers to our bookkeeper's system,
it's a non-starter for us — I'm not re-keying totals every week.

---
id: call/maple-kitchen
type: call
date: 2026-06-07
author: Maria Lopez
participants: [Maria Lopez, Hugo Diaz]
---
Hugo Diaz (Maple Kitchen): we'd switch tomorrow if it synced with QuickBooks Online. A buddy of mine runs
ServeStack and says the accounting piece "just works", which is the only reason we're even looking at them.

---
id: call/pinecone-bistro
type: call
date: 2026-06-04
author: Maria Lopez
participants: [Maria Lopez, Tom Reyes]
---
Tom Reyes (Pinecone Bistro): looks solid. It felt a little pricey at first glance, but the team liked the demo.
We'll circle back after we close out the summer.

---
id: call/river-bistro
type: call
date: 2026-06-08
author: Maria Lopez
participants: [Maria Lopez, Aiko Mori]
---
Aiko Mori (River Bistro): we like it. One bit of feedback — the onboarding felt a little long for our small team.
Not a blocker, just something to note. Also someone asked if you have a customer loyalty feature.

---
id: email/ae-digest
type: email
date: 2026-06-09
author: M. Lopez
participants: [M. Lopez, sales team]
---
Weekly note from Maria: we keep losing momentum on the accounting-sync question across the board — multiple deals
stalled on it this week. ServeStack keeps coming up as the alternative because they already do the QuickBooks piece.
One prospect also asked about a loyalty/rewards feature; second time I've heard that this month.

---
id: note/sales-sync
type: note
date: 2026-06-10
author: sales
participants: [Maria Lopez]
---
Sales sync — Maria Lopez's pipeline: Luna, Corner Cafe, Harbor, Oak Tavern, and Maple Kitchen all stalled or at
risk this week. The common thread by far is the accounting / QuickBooks integration. Pinecone is a maybe (price),
River is positive (minor onboarding note).`;

export const QUESTIONS_2 = [
  { q: "Which objection is killing deals — and is it real?", probes: "signal · is-it-real", hero: true },
  { q: "Which competitor comes up most across our deals?", probes: "entity recurrence", hero: false },
  { q: "What should we build next to unblock the pipeline?", probes: "signal → action", hero: false },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// ③ Cedar Health — honesty / never-invent / decline (Michael's watch-item).
// Rich on product + a clearly-evidenced pain (app slowness, corroborated across 2 clinics + 11 tickets),
// but ZERO internal pricing / willingness-to-pay data — and the team SAYS so. The only pricing signal is
// an advisor's vague EXTERNAL hint. "What should our pricing be?" must NOT invent a number.
// ─────────────────────────────────────────────────────────────────────────────
export const EXAMPLE_3 = `---
id: note/product-standup
type: note
date: 2026-06-02
author: Cedar Health
participants: [product, engineering]
---
Cedar Health product standup. Auto-charting is the sticky feature — clinicians genuinely love it and it's why
they stay. Biggest recurring complaint by a distance: the mobile app is slow on older tablets in the clinics.
Eng thinks it's a rendering issue on low-memory devices.

---
id: call/riverside-clinic
type: call
date: 2026-06-04
author: Cedar Health
participants: [Amara Okafor]
---
Dr. Amara Okafor (Riverside Clinic): the auto-charting saves my nurses about 20 minutes a shift — that's real,
measurable time back. The honest friction is the app lags on our older tablets; by the afternoon it's noticeably
sluggish during intake.

---
id: call/summit-pediatrics
type: call
date: 2026-06-05
author: Cedar Health
participants: [Ben Cole]
---
Dr. Ben Cole (Summit Pediatrics): charting quality is excellent, no complaints there. The one issue is the iPad app
freezes during busy intake windows — we're on older iPads, so maybe that's why. It breaks the flow when it happens.

---
id: note/support-tickets
type: note
date: 2026-06-06
author: Cedar Health
participants: [support]
---
Support summary, last 30 days. Top tickets: app slowness / freezing on older devices (11 tickets, by far #1),
login/SSO hiccups (3), report export formatting (2). Auto-charting itself: zero defect tickets.

---
id: email/team-roadmap
type: email
date: 2026-06-07
author: Cedar Health
participants: [leadership]
---
Roadmap thoughts for Q3: land two hospital systems and firm up the enterprise motion. Pricing is still open —
we have NOT decided enterprise pricing and haven't run any pricing work yet. Flagging that as a gap before we
walk into procurement conversations.

---
id: note/advisor-call
type: note
date: 2026-06-08
author: Cedar Health
participants: [advisor]
---
Advisor call: suggested we start thinking about enterprise tiers and packaging before the hospital conversations.
He mentioned that similar clinical tools he's seen tend to charge per-provider, but stressed it varies a lot and
that we shouldn't anchor on someone else's model. No specific numbers for us discussed.

---
id: note/exec-note
type: note
date: 2026-06-09
author: Cedar Health
participants: [leadership]
---
Exec note: we have not run any willingness-to-pay surveys, pricing experiments, or win/loss pricing analysis. We
genuinely don't have internal data on what hospitals would pay for the enterprise tier yet. This needs to happen
before the Q3 procurement talks.

---
id: call/maple-hospital
type: call
date: 2026-06-10
author: Cedar Health
participants: [procurement]
---
Maple Hospital (procurement): "what's your enterprise pricing, per-bed or per-provider?" We said we'd follow up
with a proposal — we don't have a published enterprise price yet. They want numbers before the next meeting.`;

export const QUESTIONS_3 = [
  { q: "What should our enterprise pricing be?", probes: "never-invent", hero: true },
  { q: "What's the weather in Amsterdam?", probes: "scope decline", hero: false },
  { q: "What's the main product pain point?", probes: "answerable control", hero: false },
] as const;

// One registry the UI iterates over — corpus + its three validated questions, in load order.
export type ExampleQuestion = { q: string; probes: string; hero: boolean };
export type Example = { id: number; name: string; tag: string; corpus: string; questions: readonly ExampleQuestion[] };
export const EXAMPLES: Example[] = [
  { id: 1, name: "Northwind", tag: "runway", corpus: EXAMPLE_1, questions: QUESTIONS_1 },
  { id: 2, name: "Bistro POS", tag: "objection", corpus: EXAMPLE_2, questions: QUESTIONS_2 },
  { id: 3, name: "Cedar Health", tag: "gaps", corpus: EXAMPLE_3, questions: QUESTIONS_3 },
];
