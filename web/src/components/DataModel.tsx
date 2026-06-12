/**
 * "Data model" — a STATIC reference (no backend). Each table shown with its real columns and a worked
 * example row set (the Northwind thread: "Raj works_at Northwind" · "14 months of runway"), plus one
 * line of why it exists and which columns link where. We add more tables here as the walkthrough covers them.
 */

type TableDef = {
  name: string;
  why: string;
  cols: string[];
  fk: number[]; // indexes of columns that are foreign keys (links)
  rows: string[][];
  links: string[]; // human-readable link summary
  note?: string; // omitted-columns note for wide tables
};

// how each table is PRODUCED — an LLM seam, or deterministic code. (super important: shows where the
// predicate/facts come from vs what's pure code.)
const BUILT: Record<string, { kind: "llm" | "code"; label: string }> = {
  sources: { kind: "code", label: "⚙ Parse · deterministic (no LLM)" },
  facts: { kind: "llm", label: "🧠 Extract · LLM call #1" },
  mentions: { kind: "llm", label: "🧠 Extract · LLM call #1" },
  relationships: { kind: "llm", label: "🧠 Extract · LLM call #1 — the predicate is the LLM's label" },
  entities: { kind: "code", label: "⚙ Connect · deterministic (string + embedding merge)" },
  edges: { kind: "code", label: "⚙ Connect · deterministic (COPIES the LLM's predicate, names→ids)" },
  signals: { kind: "code", label: "⚙ Signals · deterministic (embeddings + counting)" },
  contradictions: { kind: "code", label: "⚙ Connect · deterministic (compares comparable tokens — no LLM)" },
  positions: { kind: "llm", label: "🧠 Positions · LLM call #2 (Compose) — reads structure, not raw text" },
};

const TABLES: TableDef[] = [
  {
    name: "sources",
    why: "the verbatim ground truth every fact, edge and decision traces back to (content-addressed by hash → idempotent).",
    cols: ["id", "type", "date", "author", "participants", "body", "hash"],
    fk: [],
    rows: [
      ["note/board-feb", "note", "2026-02-18", "Elena Suri", "Elena Suri, Raj Mehta, Lin Zhao", "“…so about 14 months of runway.”", "a3f9c1"],
      ["email/investor-update-apr", "email", "2026-04-30", "Elena Suri", "Elena Suri, SeedWell", "“…the 14-month runway is no longer accurate”", "7c21bb"],
    ],
    links: [],
  },
  {
    name: "facts",
    why: "the checkable unit the brain reasons over — a typed atom whose quote is re-verified against its source.",
    cols: ["id", "type", "value", "quote", "source_id", "speaker", "dimension", "qualifier", "comparable", "tier"],
    fk: [4],
    rows: [
      ["fact_001", "claim", "runway ≈ 14 months", "“so about 14 months of runway”", "note/board-feb", "Raj Mehta", "runway", "at current burn", "14 months", "E2"],
      ["fact_002", "claim", "14mo no longer accurate", "“…is no longer accurate”", "email/investor-update-apr", "Elena Suri", "runway", "—", "—", "E4"],
    ],
    links: ["source_id → sources"],
    note: "(+ confidence · valid_time · learned_time · superseded_at · embedding(vector))",
  },
  {
    name: "mentions",
    why: "the raw names spotted per source (pre-merge), kept so entities can be re-resolved over ALL sources.",
    cols: ["id", "name", "type", "source_id"],
    fk: [3],
    rows: [
      ["men_1", "Elena Suri", "person", "note/board-feb"],
      ["men_2", "Raj Mehta", "person", "note/board-feb"],
      ["men_4", "SeedWell", "investor", "email/investor-update-apr"],
      ["men_5", "SeedWell Capital", "investor", "email/investor-update-apr"],
    ],
    links: ["source_id → sources"],
  },
  {
    name: "relationships",
    why: "the raw subject→predicate→object links the LLM proposed (the predicate is BORN here), before they're wired onto entities.",
    cols: ["id", "subject", "predicate", "object", "source_id"],
    fk: [4],
    rows: [
      ["rel_1", "Raj Mehta", "works_at", "Northwind Robotics", "note/board-feb"],
      ["rel_2", "Elena Suri", "founded", "Northwind Robotics", "email/investor-update-apr"],
      ["rel_3", "SeedWell", "invested_in", "Northwind Robotics", "email/investor-update-apr"],
    ],
    links: ["source_id → sources"],
  },
  {
    name: "entities",
    why: "one node per real person/company — name variants merged into one (note “SeedWell” + “SeedWell Capital” → one row).",
    cols: ["id", "name", "type", "aliases"],
    fk: [],
    rows: [
      ["ent_a1", "Elena Suri", "person", "[]"],
      ["ent_b2", "Raj Mehta", "person", "[]"],
      ["ent_c3", "Northwind Robotics", "company", "[]"],
      ["ent_d4", "SeedWell Capital", "investor", "[\"SeedWell\"]"],
    ],
    links: ["compiled from mentions"],
  },
  {
    name: "edges",
    why: "the typed graph — relationships wired onto entity ids (the predicate is COPIED here, names → ids).",
    cols: ["id", "from_id", "predicate", "to_id", "source_id", "similarity"],
    fk: [1, 3, 4],
    rows: [
      ["edge_1", "ent_a1", "founded", "ent_c3", "email/investor-update-apr", "null"],
      ["edge_2", "ent_b2", "works_at", "ent_c3", "note/board-feb", "null"],
      ["edge_3", "ent_d4", "invested_in", "ent_c3", "email/investor-update-apr", "null"],
    ],
    links: ["from_id → entities", "to_id → entities", "source_id → sources"],
  },
  {
    name: "signals",
    why: "recurring CUSTOMER patterns — facts that mean the same thing, clustered and promoted by count + # of companies. Answers “is it real?”",
    cols: ["id", "type", "label", "fact_ids", "count", "companies", "promotion", "last_confirmed"],
    fk: [3],
    rows: [
      ["sig_1", "objection", "accounting / QuickBooks gap", "[f1, f2, f3, f4, f5]", "5", "Luna, Corner Cafe, Harbor, Oak Tavern, Maple", "decision_grade", "2026-06-07"],
      ["sig_2", "feature_request", "loyalty / rewards feature", "[f6, f_digest]", "2", "River, (AE digest)", "emerging", "2026-06-09"],
      ["sig_3", "objection", "felt pricey", "[f7]", "1", "Pinecone", "candidate", "2026-06-04"],
    ],
    links: ["fact_ids → facts"],
    note: "(+ embedding(vector) cluster centroid · learned_time · superseded_at) — using the Bistro corpus (5 restaurants raise the accounting gap in 5 different phrasings).",
  },
  {
    name: "contradictions",
    why: "conflicts on a POSITION topic — surfaced (not averaged away) so the brain can reason about drift. Detected by comparing the comparable tokens.",
    cols: ["id", "dimension", "fact_a", "fact_b", "kind", "note", "status"],
    fk: [2, 3],
    rows: [
      ["con_1", "runway", "fA", "fB", "conditional", "runway: “18 months” vs “9 months” — conditional on: after hiring 2 AEs", "open"],
      ["con_2", "icp", "fC", "fD", "drift", "icp: “mid_market” (Jan) vs “enterprise” (Apr)", "open"],
    ],
    links: ["fact_a → facts", "fact_b → facts"],
    note: "Only checked on position topics (runway · icp · pricing). Customer topics (objection · competitor · pain) accumulate as signals instead.",
  },
  {
    name: "positions",
    why: "the company's drift-aware STANCE on one topic — compiled from that topic's facts + contradictions, with confidence and explicit gaps. Never recommends.",
    cols: ["id", "name", "summary", "confidence", "contradiction_ids", "gaps"],
    fk: [4],
    rows: [
      ["pos_1", "runway", "Base runway ~18mo; drops to ~9mo IF 2 AEs hired — conditional, not a flat conflict", "medium", "[con_1]", "[“current clean monthly burn”]"],
      ["pos_2", "icp", "Mostly mid-market, but recent deals drift toward enterprise", "medium", "[con_2]", "[“win/loss by segment”]"],
    ],
    links: ["fields.fact_ids → facts", "signal_ids → signals", "contradiction_ids → contradictions"],
    note: "(+ fields[]{claim, fact_ids} cited sub-claims · valid_time · compiled_at · embedding(vector)) — only TWO stances are compiled: runway and ICP.",
  },
];

// ── the 2nd LLM call (Compose → positions): how a stance is built ──
const POS_STEPS: { n: string; t: string; d: string }[] = [
  { n: "1", t: "Fixed topics", d: "Only two stances are compiled — runway and ICP. Recurring customer patterns like objections are served straight from signals, so they need no stance — build only what earns its place." },
  { n: "2", t: "Gather by dimension", d: "For each topic, pull every fact tagged that dimension (skipping web-researched ones), plus that dimension's contradictions and any related signals. Skip the topic if it has no facts." },
  { n: "3", t: "Hand structure to the LLM", d: "It gets the typed facts + contradictions (each with id, tier, date, qualifier) — NOT the raw emails. It reads artifacts, not text." },
  { n: "4", t: "LLM writes the stance", d: "summary (drift-aware — states conflicts plainly), fields[] (each cites fact_ids), confidence (lowered by unresolved conflicts / thin evidence), gaps (concrete missing things — each can later trigger research)." },
  { n: "5", t: "Save", d: "Store the position row + edges linking it to its signals (composed_from) and contradictions (addresses)." },
];

const POS_INPUT = `Position to compile: runway
EVIDENCE (cite these ids):
- [fA] (E4, valid Jan): runway = 18 months — "…about 18 months…"
- [fB] (E3, valid Mar, ONLY IF: after hiring 2 AEs): runway = 9 months — "…"
CONTRADICTIONS on this dimension:
- [conditional] runway: "18 months" vs "9 months" — conditional on: after hiring 2 AEs`;

const POS_OUTPUT = `{
  "summary": "Base runway ~18 months; drops to ~9 months IF 2 AEs
              are hired. Not a flat conflict — the 9-month case is conditional.",
  "fields": [
    { "claim": "base runway ~18 months", "fact_ids": ["fA"] },
    { "claim": "~9 months if 2 AEs hired", "fact_ids": ["fB"] }
  ],
  "confidence": "medium",
  "gaps": ["current clean monthly burn"]
}`;

// the deterministic detection steps for a contradiction
const CONTRA_STEPS: { n: string; t: string; d: string }[] = [
  { n: "1", t: "Keep position topics", d: "Only facts on runway · icp · pricing that carry a comparable VALUE. Customer topics (objection/competitor/pain) are skipped — they're meant to pile up as signals, not clash." },
  { n: "2", t: "Group by topic", d: "Bucket those facts by dimension — e.g. all runway facts together." },
  { n: "3", t: "Group by value", d: "Inside a topic, group by the canonical comparable token (“18 months”, “9 months”)." },
  { n: "4", t: "More than one value = conflict", d: "If a topic has 2+ different values, that's a contradiction. It contrasts the two best-supported values (the headline clash), not every pair." },
  { n: "5", t: "Tag the kind", d: "A tiny rule labels WHY they differ — conditional / drift / direct (see below)." },
  { n: "6", t: "Write the row", d: "Store dimension, the two fact ids, the kind, and a human-readable note." },
];

const KINDS: { kind: string; rule: string; example: string }[] = [
  { kind: "conditional", rule: "either fact has a qualifier — an “only if”", example: "runway 18mo vs 9mo “after hiring 2 AEs”" },
  { kind: "drift", rule: "no condition, but > 14 days apart — the view changed over time", example: "ICP mid_market (Jan) vs enterprise (Apr)" },
  { kind: "direct", rule: "no condition, same period — a flat disagreement", example: "runway 18mo vs 12mo, both this week" },
];

// the kind is decided by THIS order — the first test that's true wins
const KIND_FLOW = `Does EITHER fact have a condition (qualifier)?
   ├─ YES → conditional
   └─ NO ↓
Are the two facts more than 14 days apart?
   ├─ YES → drift
   └─ NO ↓
        → direct`;

// ── the LLM call (Extract): input · menus · output format · how it fills the tables ──
const EXTRACT_INPUT = `Source id: note/board-feb
Type: note · Date: 2026-02-18 · Author: Elena Suri
--- BODY (sacred — quote verbatim) ---
Raj reported ~$4.2M in the bank and current spend
around $300k/month, so about 14 months of runway.`;

const EXTRACT_OUTPUT = `{
  "facts": [{
    "type": "claim",
    "value": "runway ≈ 14 months at ~$300k/mo",
    "quote": "so about 14 months of runway",
    "speaker": "Raj Mehta",
    "confidence": 0.9,
    "evidence_tier": "E2",
    "dimension": "runway",
    "qualifier": "at current burn",
    "comparable": "14 months"
  }],
  "entities": [
    { "name": "Raj Mehta", "type": "person" },
    { "name": "Northwind Robotics", "type": "company" }
  ],
  "relationships": [
    { "subject": "Raj Mehta", "predicate": "works_at",
      "object": "Northwind Robotics" }
  ]
}`;

const FACT_FIELDS: { f: string; kind: "list" | "free" | "num"; who: string }[] = [
  { f: "type", kind: "list", who: "LLM picks from 13 → code validates (else → claim)" },
  { f: "value", kind: "free", who: "LLM writes a one-line restatement" },
  { f: "quote", kind: "free", who: "LLM copies verbatim → code verifies it's in the source (else rejected)" },
  { f: "speaker", kind: "free", who: "LLM, or null" },
  { f: "confidence", kind: "num", who: "LLM, 0–1" },
  { f: "evidence_tier", kind: "list", who: "LLM picks E1–E5 → code validates (else → E2)" },
  { f: "dimension", kind: "list", who: "LLM guesses → CODE derives from text (LLM = fallback only)" },
  { f: "qualifier", kind: "free", who: "LLM, a condition, or null" },
  { f: "comparable", kind: "free", who: "LLM canonical token, or null" },
];

const MENUS: { name: string; fixed: boolean; values: string }[] = [
  { name: "type", fixed: true, values: "claim · pain_point · objection · workflow · buying_signal · buyer_role · competitor · pricing_hint · willingness_to_pay · feature_request · product_feedback · constraint · risk" },
  { name: "evidence_tier", fixed: true, values: "E1 casual · E2 in passing · E3 clear · E4 strong · E5 decision-grade" },
  { name: "entity type", fixed: true, values: "person · company · investor · competitor" },
  { name: "dimension", fixed: false, values: "runway · icp · budget_authority · competitor (code-derived) · pricing (LLM) · null" },
  { name: "predicate", fixed: false, values: "free text — examples: works_at · founded · invested_in · competes_with" },
];

// the design philosophy — the principles behind this build, in my own words
const PHILOSOPHY: { q: string; how: string }[] = [
  {
    q: "Do the hard thinking once — when the information arrives, not when it's asked for.",
    how: "Ingest is where the work happens: raw text is parsed, interpreted, linked, and turned into finished structured records. Answering a question is then mostly looking things up over those records — fast and consistent — instead of re-reading the whole week from scratch every time.",
  },
  {
    q: "Use the model only where language is genuinely needed; let code do the rest.",
    how: "The model touches exactly two points — turning raw text into typed facts, and writing a stance from already-structured evidence. Merging duplicate names, wiring the graph, comparing values, clustering patterns are all plain code I can read, test, and reproduce. The parts that must be reliable never hinge on a model being consistent.",
  },
  {
    q: "Store nothing the system can't prove.",
    how: "Every fact keeps the exact words it came from and where they were said, and that quote is checked against the real source before it's saved — if it isn't there, the fact is dropped. So every later claim and link traces back to something real; the system can always show its work.",
  },
  {
    q: "Build only what earns its place.",
    how: "A few things that are correct and explainable beat many that are shallow. A compiled stance exists only for topics that truly need one; patterns better expressed as recurring evidence stay that way. Less surface, more trust.",
  },
];

const FILL_STEPS: { n: string; t: string; d: string }[] = [
  { n: "1", t: "Verify the quote", d: "each fact's quote must appear verbatim in the source body — if not, the fact is rejected (provenance can't be invented)." },
  { n: "2", t: "Snap to the lists", d: "coerce type → 13-enum (else claim), evidence_tier → E1–E5 (else E2), entity type → 4 (else company)." },
  { n: "3", t: "Derive the dimension", d: "canonicalDimension(value+quote, LLM-guess) sets the final dimension from the text; the LLM's guess is only the fallback." },
  { n: "4", t: "Write the rows", d: "facts[] → facts table · entities[] → mentions table (raw) · relationships[] → relationships table (raw). Connect later compiles mentions→entities and relationships→edges." },
];

// the deterministic build steps for a signal — shown as a mini-walkthrough under the signals table
const SIGNAL_STEPS: { n: string; t: string; d: string }[] = [
  { n: "1", t: "Drop internal", d: "Keep only CUSTOMER-evidence facts (type ≠ claim). Internal claims like runway/ICP go to Positions, not signals." },
  { n: "2", t: "Group by type", d: "Bucket the remaining facts by their type (all objections together, all feature_requests together, …)." },
  { n: "3", t: "Embed each fact", d: "Turn each fact's text into a vector (a list of numbers that captures meaning). Similar meaning → similar numbers." },
  { n: "4", t: "Cluster by meaning", d: "A fact joins a cluster when its vector is close to the cluster's seed — cosine ≥ 0.55 (relaxed to 0.40 if they share a dimension). So 5 differently-worded accounting facts still land together — “by meaning, not keywords.”" },
  { n: "5", t: "Label + count", d: "Each cluster becomes one signal. label = the cluster's strongest fact (highest evidence tier E1…E5, then confidence). count = facts in it; companies = the distinct customers they came from." },
  { n: "6", t: "Promote", d: "Set the tier from count + # companies (ladder below). Promotion only goes up — it never demotes." },
];

const LADDER: { tier: string; rule: string }[] = [
  { tier: "decision_grade", rule: "count ≥ 3  AND  ≥ 3 companies" },
  { tier: "validated", rule: "count ≥ 3  AND  ≥ 2 companies" },
  { tier: "emerging", rule: "count ≥ 2" },
  { tier: "candidate", rule: "just 1" },
];

// ── Phase 2 retrieval — fetching from memory ──
const RETRIEVE_TARGETS: { target: string; keyword: string; semantic: string; cutoff: string; keep: string }[] = [
  { target: "position", keyword: "hint words (runway · burn · cash · raise — or — icp · mid-market · enterprise · drift) → pick that position", semantic: "nearest position by meaning", cutoff: "< 0.65 strict", keep: "at most 1 (none if not confident)" },
  { target: "signals", keyword: "type words (objection · competitor · pain) → up to 3 of that type", semantic: "nearest signals", cutoff: "< 0.95 loose", keep: "top 5 (both passes merged)" },
  { target: "facts", keyword: "— (facts come from the chosen position + signals)", semantic: "nearest 10 facts", cutoff: "< 0.95 loose", keep: "union of all sources, then cap 30" },
];

const RETRIEVE_MATCH = `similarFacts(questionVector, 10)  →
[ { fact: { id: "fact_001", value: "runway ≈ 14 months", … }, distance: 0.41 },
  { fact: { id: "fact_018", value: "runway = 9 months",   … }, distance: 0.58 },
  { fact: { id: "fact_044", value: "…",                   … }, distance: 0.97 } ]
                                               ↑ > 0.95 → dropped
keep the rows whose distance < 0.95`;

const RETRIEVE_ROW = `fact_001   ← a kept match is the FULL row, not just an id
  value:         "runway ≈ 14 months at ~$300k/mo"
  quote:         "so about 14 months of runway"      ← the receipt
  source_id:     note/board-feb
  speaker:       Raj Mehta
  dimension:     runway · qualifier: at current burn · comparable: 14 months
  evidence_tier: E2 · confidence: 0.9 · valid_time: 2026-02-18`;

const RETRIEVE_BUNDLE = `{
  position:  runway   (confidence: medium · gaps: ["current clean burn"])
  signals:   []
  facts: [ fact_001  runway ≈ 14 months      "so about 14 months…"    note/board-feb
           fact_018  runway = 9 months        "…9 months if we hire…"  slack/finance
           fact_022  burn $380–430k (unclean) "…not clean yet…"         memo/cfo-burn ]
  contradictions: [ con_1  runway: 18mo vs 9mo — conditional ]
  gaps:  ["current clean monthly burn"]
}`;

const RETRIEVE_STEPS: { n: string; t: string; d: string }[] = [
  { n: "1", t: "Embed the question", d: "turn the question into a vector; lowercase the text for keyword matching." },
  { n: "2", t: "Pick a position", d: "keyword hit → that position (done, no distance needed). Else the nearest position, but only if distance < 0.65. Else no position." },
  { n: "3", t: "Pick signals", d: "type-keyword → up to 3 of that type; PLUS semantically-near signals (< 0.95). Merge, keep top 5." },
  { n: "4", t: "Gather facts", d: "the position's cited facts + EVERY fact on its dimension (dimension-complete) + the signals' facts + the nearest facts (< 0.95). Merge the ids (a duplicate counts once)." },
  { n: "5", t: "Expand 1 hop", d: "for any fact that's one side of a contradiction, pull in the other side too — never half a conflict." },
  { n: "6", t: "Cap + attach", d: "trim to 30 facts; attach the contradictions touching them + the position's gaps. Return the bundle." },
];

export function DataModel() {
  return (
    <div className="dm">
      <section className="card dmhero">
        <h2 className="dmtitle">Memory — Documentation</h2>
        <p className="dmtitlesub">
          How the decision brain turns a raw week into <b>structured, cited memory</b>: every table, the
          <b> two LLM seams</b>, and the reasoning behind each choice. (Phase 1 — what Phase 2's agent reads to decide.)
        </p>
        <div className="dmbar">
          <div className="dmbarh">Philosophy — why it's built this way</div>
          {PHILOSOPHY.map((b, i) => (
            <div key={i} className="dmbaritem">
              <div className="dmbarq">{b.q}</div>
              <div className="dmbarhow">{b.how}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>The tables — a worked example <span className="muted small">Northwind: “Raj works_at Northwind” · “14 months of runway”</span></h3>
        <p className="dmintro">
          Each table below shows its real <b>columns</b> and example <b>rows</b>, one line of <b>why</b> it exists, which
          columns <b className="fkcol">link</b> to other tables, and a badge for <b>how it's produced</b>. We add more
          tables here as the walkthrough covers them.
        </p>
        <div className="dmlegend2">
          <span className="dmbuilt llm">🧠 LLM seam</span> the model writes it (facts · mentions · relationships → and later positions)
          <span className="dmbuilt code">⚙ deterministic</span> pure code, no LLM (everything else)
        </div>
      </section>

      {/* the LLM call itself: input → menus → output JSON → how the tables get filled */}
      <section className="card">
        <h3><span className="dmbuilt llm">🧠 LLM call #1</span> Extract — input · menus · output · how it fills the tables</h3>

        <div className="dmsub">1 · what the LLM reads (one source)</div>
        <pre className="dmcode">{EXTRACT_INPUT}</pre>

        <div className="dmsub">2 · the fields it fills per fact <span className="muted small">— list = pick from a menu · free = its own words · num = a number</span></div>
        <div className="dmscroll">
          <table className="dbtable">
            <thead><tr><th>field</th><th>kind</th><th>who decides</th></tr></thead>
            <tbody>
              {FACT_FIELDS.map((r) => (
                <tr key={r.f}>
                  <td className="vcell"><code>{r.f}</code></td>
                  <td><span className={"kindchip " + r.kind}>{r.kind}</span></td>
                  <td className="muted small">{r.who}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dmsub">3 · the menus it must pick from</div>
        {MENUS.map((m) => (
          <div key={m.name} className="dmmenu">
            <span className={"kindchip " + (m.fixed ? "list" : "free")}>{m.fixed ? "fixed list" : "guided"}</span>
            <code>{m.name}</code> <span className="muted small">{m.values}</span>
          </div>
        ))}

        <div className="dmsub">4 · what it returns (strict JSON — three lists)</div>
        <pre className="dmcode">{EXTRACT_OUTPUT}</pre>

        <div className="dmsub">5 · how code turns that output into table rows</div>
        <ol className="dmsteps">
          {FILL_STEPS.map((s) => (
            <li key={s.n}>
              <span className="dmstepn">{s.n}</span>
              <span className="dmstept"><b>{s.t}</b> — {s.d}</span>
            </li>
          ))}
        </ol>
      </section>

      {TABLES.map((t) => (
        <section key={t.name} className="card">
          <div className="dmth">
            <code>{t.name}</code>
            {BUILT[t.name] && <span className={"dmbuilt " + BUILT[t.name]!.kind}>{BUILT[t.name]!.label}</span>}
          </div>
          <div className="dbwhy1"><span className="dbschemak">why</span> {t.why}</div>
          <div className="dmscroll">
            <table className="dbtable">
              <thead>
                <tr>{t.cols.map((c, i) => <th key={c} className={t.fk.includes(i) ? "fkcol" : ""}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {t.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((cell, ci) => <td key={ci} className={"vcell" + (t.fk.includes(ci) ? " fkcol" : "")}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.note && <div className="dmnote">{t.note}</div>}
          {t.links.length > 0 && (
            <div className="dmlinks2">{t.links.map((l) => <span key={l} className="dmlink2">{l}</span>)}</div>
          )}
        </section>
      ))}

      {/* full walkthrough of how the signals table is built (deterministic, no LLM) */}
      <section className="card">
        <h3>How a signal is built <span className="muted small">deterministic · no LLM · embeddings as a math utility</span></h3>
        <ol className="dmsteps">
          {SIGNAL_STEPS.map((s) => (
            <li key={s.n}>
              <span className="dmstepn">{s.n}</span>
              <span className="dmstept"><b>{s.t}</b> — {s.d}</span>
            </li>
          ))}
        </ol>

        <div className="dmsub">Clustering threshold</div>
        <p className="dmintro">
          Closeness is <b>cosine similarity</b> between the two facts' vectors (1.0 = identical meaning, 0 = unrelated).
          The bar is <b>0.55</b>, relaxed to <b>0.40</b> when two facts already share a <code>dimension</code> — a recall
          aid so differently-phrased facts on the same topic still merge.
        </p>

        <div className="dmsub">Promotion ladder <span className="muted small">— count = how often · companies = how widespread</span></div>
        <div className="dmscroll">
          <table className="dbtable">
            <thead><tr><th>tier</th><th>rule</th></tr></thead>
            <tbody>
              {LADDER.map((l) => (
                <tr key={l.tier}><td className="vcell"><span className="chip">{l.tier}</span></td><td className="muted small">{l.rule}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dmintro">
          So Signal <code>sig_1</code> (5 facts across 5 companies) is <b>decision_grade</b>; the one-off “pricey”
          stays <b>candidate</b>. The <b>companies</b> count is the guard: one loud customer repeating itself 5 times
          would be <b>emerging</b>, not decision_grade — it needs <b>≥ 3 different companies</b> to be market-wide.
        </p>
      </section>

      {/* full walkthrough of how a contradiction is detected (deterministic, no LLM) */}
      <section className="card">
        <h3>How a contradiction is detected <span className="muted small">deterministic · no LLM · just compares values</span></h3>
        <p className="dmintro">
          The LLM already normalized every fact into a <b>(topic, value)</b> pair at Extract — <code>dimension</code> +
          <code>comparable</code>. So detecting a clash needs no language understanding: <b>same topic, different value.</b>
        </p>
        <ol className="dmsteps">
          {CONTRA_STEPS.map((s) => (
            <li key={s.n}>
              <span className="dmstepn">{s.n}</span>
              <span className="dmstept"><b>{s.t}</b> — {s.d}</span>
            </li>
          ))}
        </ol>

        <div className="dmsub">The kind — decided by this checklist (first match wins)</div>
        <pre className="dmflow">{KIND_FLOW}</pre>
        <div className="dmscroll">
          <table className="dbtable">
            <thead><tr><th>kind</th><th>rule</th><th>example</th></tr></thead>
            <tbody>
              {KINDS.map((k) => (
                <tr key={k.kind}>
                  <td className="vcell"><span className="chip warn">{k.kind}</span></td>
                  <td className="muted small">{k.rule}</td>
                  <td className="muted small">{k.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dmintro">
          <b>Order matters:</b> the qualifier is checked <i>first</i> — so a fact that's both conditional <i>and</i> far
          apart in time is labeled <b>conditional</b>, because the condition is the bigger reason they differ. The
          14-day gap is only checked when there's no condition.
        </p>
        <p className="dmintro">
          Why three kinds? Because the brain responds to each differently: <b>conditional</b> → “not a real clash, here's
          the condition” (don't average); <b>drift</b> → “the newer one likely wins, the old one is stale”;
          <b>direct</b> → “a genuine inconsistency — reconcile it.” That's the difference between “these numbers don't
          match!” and a brain that explains <i>why</i>. (Signals look for <b>sameness</b>; contradictions for <b>difference</b>.)
        </p>
      </section>

      {/* the 2nd LLM call: how a position (stance) is compiled */}
      <section className="card">
        <h3><span className="dmbuilt llm">🧠 LLM call #2</span> Positions — compiling a drift-aware stance</h3>

        <div className="dmdesign">
          <div className="dmdesignh">Design note — why only two positions (and the production path)</div>
          <p>
            <b>Scope (on purpose):</b> a compiled stance is built only for the strategic topics that genuinely need
            one — here, <b>runway</b> and <b>ICP</b>. Recurring customer patterns like objections are already captured
            as <b>signals</b>, so they don't need a stance. Few stances, each one earning its place — <i>restraint over
            surface.</i>
          </p>
          <p>
            <b>Is this what I'd ship to production? No.</b> There I'd make the topic list <b>dynamic</b> — build a
            position for any dimension with enough decision-grade evidence, or make it config-driven (runway, ICP,
            pricing, GTM, hiring…).
          </p>
          <p>
            <b>Why that's a one-line change:</b> the compiler (<code>composePosition</code>) is <b>dimension-agnostic</b> —
            nothing in it is runway- or ICP-specific. The <i>only</i> hardcoded thing is the list of topics
            (<code>TARGETS</code>). Generalizing = make <code>TARGETS</code> dynamic; the compile logic already supports it.
            <span className="muted"> (Contradictions are already detected on <code>pricing</code> too — so a pricing
            position is the natural next one, just not one of the three questions.)</span>
          </p>
        </div>

        <p className="dmintro">
          The 2nd and final LLM call. It reads the <b>structured evidence</b> (a topic's facts + contradictions),
          <b> not the raw text</b>, and writes one stance per topic. Two hard rules: <b>never invent a fact</b>,
          <b> never recommend an action</b> (recommending is Phase 2's job).
        </p>
        <ol className="dmsteps">
          {POS_STEPS.map((s) => (
            <li key={s.n}>
              <span className="dmstepn">{s.n}</span>
              <span className="dmstept"><b>{s.t}</b> — {s.d}</span>
            </li>
          ))}
        </ol>

        <div className="dmsub">what it reads (structured evidence, not raw emails)</div>
        <pre className="dmcode">{POS_INPUT}</pre>

        <div className="dmsub">what it returns (strict JSON → the position row)</div>
        <pre className="dmcode">{POS_OUTPUT}</pre>

        <p className="dmintro">
          So <code>pos_1</code> states the runway stance <b>with its condition intact</b> — confidence <b>medium</b>
          (an unresolved conditional), and a concrete <b>gap</b> (“current clean monthly burn”) that Phase 2 can chase.
          Contrast: <b>signals</b> = customer recurrence (code); <b>positions</b> = internal stance per topic (LLM).
        </p>
      </section>

      {/* ── Phase 2 retrieval ── */}
      <section className="card">
        <h3>Retrieval — fetching from memory <span className="muted small">Phase 2 · deterministic · no LLM</span></h3>
        <p className="dmintro">
          Given a question, retrieval pulls the relevant slice of memory into <b>one bundle</b> — using keyword hints +
          semantic (vector) search + a graph hop. <b>No LLM chooses what to fetch</b>; the LLM only judges the bundle afterward.
        </p>

        <div className="dmsub">what “distance” means</div>
        <p className="dmintro">
          Every item has an <b>embedding</b> (a meaning-vector); the question becomes one too. <b>Distance</b> = how far
          apart in meaning (≈0 identical, →1 unrelated). pgvector returns the nearest; a <b>cutoff</b> keeps only
          close-enough matches. <b>Lower cutoff = stricter.</b>
        </p>

        <div className="dmsub">the three things it fetches — keyword first, then semantic</div>
        <div className="dmscroll">
          <table className="dbtable">
            <thead><tr><th>target</th><th>keyword pass</th><th>semantic pass</th><th>cutoff</th><th>keep</th></tr></thead>
            <tbody>
              {RETRIEVE_TARGETS.map((r) => (
                <tr key={r.target}>
                  <td className="vcell"><code>{r.target}</code></td>
                  <td className="muted small">{r.keyword}</td>
                  <td className="muted small">{r.semantic}</td>
                  <td><span className="chip">{r.cutoff}</span></td>
                  <td className="muted small">{r.keep}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dmintro">
          <b>Why two cutoffs?</b> The position is the big routing call — <b>strict (0.65)</b>, better none than the wrong
          one. Signals and facts are just candidates the LLM judges later — <b>loose (0.95)</b>, favour recall.
        </p>
      </section>

      <section className="card">
        <h3>What you end up holding</h3>

        <div className="dmsub">1 · a semantic match returns FULL rows + a distance (not an id)</div>
        <pre className="dmcode">{RETRIEVE_MATCH}</pre>

        <div className="dmsub">2 · a kept fact is the complete row — with its receipt</div>
        <pre className="dmcode">{RETRIEVE_ROW}</pre>

        <div className="dmsub">3 · the bundle — the full picture handed to the next step</div>
        <pre className="dmcode">{RETRIEVE_BUNDLE}</pre>
        <p className="dmintro">
          Every <code>facts[]</code> entry is a full row like the one above — each carrying its own quote + source. So
          you hold <b>one position</b>, the <b>signals</b>, several <b>complete fact rows</b>, the <b>conflicts</b> touching
          them, and the <b>gaps</b> — never just an id or a lone value.
        </p>
      </section>

      <section className="card">
        <h3>The full flow, step by step</h3>
        <ol className="dmsteps">
          {RETRIEVE_STEPS.map((s) => (
            <li key={s.n}>
              <span className="dmstepn">{s.n}</span>
              <span className="dmstept"><b>{s.t}</b> — {s.d}</span>
            </li>
          ))}
        </ol>

        <div className="dmsub">deepen — the optional deeper fetch</div>
        <p className="dmintro">
          When the agent's <b>assess</b> step finds the evidence thin, <code>expandNeighbors</code> walks <b>further along
          the graph</b> from the facts in hand — signal-cluster siblings · contradiction partners · same-speaker facts ·
          related-entity facts (1 hop on the entity edges). It expands <b>along the graph, never by loosening the
          distance</b> — so it gathers more <b>without drifting off-topic.</b>
        </p>
      </section>
    </div>
  );
}
