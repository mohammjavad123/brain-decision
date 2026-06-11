# Decision Brain

A **decision brain** for a scaling CEO. Drop in a founder's week — calls, emails, notes, a tweet, a Slack thread — and it builds a **queryable, cited, contradiction-aware memory**. When the CEO asks a hard question, an **agent** answers from that memory, expands the graph or searches the web when memory is thin, and returns a **defensible recommendation with receipts** that a human approves or rejects.

> **The design principle:** *LLMs live at the seams, algorithms live in the path.*
> The LLM is used only where judgment is irreducible — turning messy text into typed facts, composing a drift-aware position, deciding what to do next, and writing the final answer. Everything that should be deterministic — clustering, thresholds, entity resolution, contradiction detection, time-travel, provenance, and grounding checks — is plain code. **No model sits in the read path's plumbing.**

---

## Run it — one command

**Prerequisites:** Node **20+** and a **Gemini API key** (free from [Google AI Studio](https://aistudio.google.com/apikey)). No Docker, no database to install.

```bash
git clone https://github.com/mohammjavad123/brain-decision && cd brain-decision
npm install
cp .env.example .env            # then paste your GEMINI_API_KEY into .env
npm start                       # the one command
```

Open **http://localhost:8787**. `npm start` is self-contained: it installs the UI deps, builds the React app, **serves the UI and the API on one port**, and **builds the brain from the week's data automatically on first run**.

**First run (~2–3 min, once):** it downloads a small local embedding model (~110 MB, no key) and runs the write-time pipeline live in the console (`extract → connect → signals → positions`). Every later start is instant — the brain is cached on disk. If no key is set, it tells you exactly what to add and exits gracefully.

| `.env` | |
|---|---|
| `GEMINI_API_KEY` | **required** — powers the LLM seams |
| `TAVILY_API_KEY` | optional — real web research for gap-filling; **degrades honestly** without it |
| `EMBEDDING_PROVIDER` | optional — defaults to a free, local, 768-dim model (no key) |

### Troubleshooting
- **"Port 8787 already in use"** → `lsof -ti:8787 | xargs kill`, or `WEB_PORT=8788 npm start`.
- **"memory is empty and no key set"** → add `GEMINI_API_KEY` to `.env`, re-run `npm start`.
- **Start completely fresh** → delete `.data/` and restart; it re-seeds.

---

## The live demo

Two modes on one page:

**① Ask the brain** — type a CEO question and **watch the agent think in real time**: the *Flow* tab lights up each step of the loop as it fires; the *Trace* tab shows the full reasoning. End with an approve/reject on the recommendation. Try:
- *"What runway can I defend in this week's investor update?"* — the hero question.
- *"Which objection is killing deals — and is it real?"*
- *"Is our ICP actually mid-market, or are we drifting up?"*

**② Build memory** — paste raw items (one or a whole batch) and **watch them become memory live**: parse → extract typed facts → connect the entity graph → cluster signals → compile positions, with the graph drawing as it builds. Buttons: **load corpus** (the full week), **load example**, **Ingest** (additive — new items join the brain), **clean memory** (wipe and start a new subject).

> A tight demo: **clean memory → load corpus → Ingest** (watch it assemble), then **Ask the brain**.

---

## Architecture at a glance

```
  RAW WEEK                PHASE 1 · build memory (write-time)              PHASE 2 · the decision (read-time)
  ────────                ──────────────────────────────────              ──────────────────────────────────
  calls                   extract → verify → embed → store                 a CEO question
  emails       ───────▶   resolve entities · wire graph · contradictions   ↓  the agent loop  ↓     ───▶  cited
  notes                   cluster signals · promote                        retrieve · assess ·            recommendation
  tweet                   compose positions                                deepen / research ·            + logged decision
  slack                                                                    synthesize · verify            (human approves)
                                 │                                                  │
                                 ▼                                                  ▼
                      ONE store: Postgres + pgvector  ◀──── reads: pure SQL, no LLM ────
                      (bi-temporal · append-only · content-addressed)
```

---

# Phase 1 — building the memory

The whole point of Phase 1 is to turn a pile of conversations into **structure an agent can reason over** — fast, cited, and honest about change over time.

### Why one store: Postgres + pgvector (not two databases)
Relational data **and** the meaning-vectors live in the **same row**. So *"what in memory means the same as X?"* and *"filter by dimension/date/company"* are answered by **one SQL query**, not a vector DB plus a relational DB kept in sync. One index every layer reads from; reads stay model-free and fast. Locally it runs as **PGlite** (Postgres + pgvector, in-process — zero setup); in production you point the same schema at hosted Postgres.

### Why bi-temporal & append-only
Every record carries **`valid_time`** (true in the world), **`learned_time`** (when we recorded it), and **`superseded_at`** (a tombstone; empty = current). Nothing is ever destructively overwritten, so a new fact never erases an old belief — *"what did we think on May 20?"* is just a filtered query. That's what lets the brain hold a year of inputs and still show how a position **drifted**.

### The tables, and the thinking behind each
| table | what it holds | why it exists |
|---|---|---|
| **sources** | the raw items, never edited | provenance is sacred; identity = hash of the body, so re-ingesting is a no-op |
| **facts** | the typed atoms — a normalized `value`, the **verbatim quote** + character offsets, an evidence tier (E1–E5), a `dimension`, a `qualifier`, and a canonical `comparable` | a fact is the smallest unit that is at once **cited, typed, confidence-scored, time-aware, and embeddable** — everything downstream is built from it |
| **entities** | one canonical record per real-world person/company/investor/competitor (+ aliases) | one *Maya Chen*, not three string variants — the graph needs real nodes |
| **edges** | the typed graph: `subject –predicate→ object`, plus scored `fact →member_of→ signal` links | this is the **knowledge graph** — walkable with a `JOIN`, and every claim clicks back to its exact quotes |
| **signals** | the same claim aggregated across calls — count, companies, promotion tier | turns scattered mentions into *"this objection recurs across 6 companies"* |
| **contradictions** | conflicts as first-class rows (direct / **conditional** / drift) | *"18 months"* vs *"9 months"* of runway is something the brain must **notice and keep**, not smooth over |
| **positions** | the compiled stance (ICP, runway) with per-field citations + gaps | the drift-aware answer to *"where do we actually stand?"* — and the gaps are what trigger research |
| **decisions** | the append-only log: question · answer · confidence · evidence · recommendation · human verdict | the loop closes here — every recommendation and its human call are auditable |

### How the dots connect (all deterministic)
- **Entities** — resolved by normalize + token-containment, then embedding similarity, then a distinctive shared-token merge (so *"lost halberd"* still maps to **Halberd Freight**).
- **The graph** — relationships are wired into typed edges; people → companies → deals → competitors become a structure you traverse, not a pile of rows.
- **Signals** — facts that *mean* the same thing cluster **by embedding**, then promote on **pure thresholds** (candidate → emerging → validated → decision-grade).
- **Contradictions** — detected only on the dimensions the brain tracks as a single stance (runway, ICP, pricing), comparing the canonical `comparable` of the two best-supported values — so it catches the real conflict without drowning in noise.
- **Positions** — composed from the validated signals + contradictions, with confidence and explicit gaps.

> The combination is the point: **SQL** for fast, exact, time-aware reads; **vectors** for meaning (clustering + retrieval); **graph edges** for the connections between people, companies, and deals. One store, three lenses.

---

# Phase 2 — the agent

This is the **decision point**. It's a small, explicit state machine (LangGraph) — not a free-roaming agent — so the control flow is deterministic and auditable. **`assess` is the single hub** every loop routes back through.

```
                        ┌─────────────────────── THE AGENT LOOP ───────────────────────┐
                        │                                                               │
 question ─▶ refine ─▶ retrieve ─▶  ASSESS  ─"answer"────────────────▶ synthesize ─▶ verify ─┬─ grounded ─▶ log ─▶ DECISION
              (LLM)     (memory)     (LLM)  │                            (LLM)    (algorithm)│        (cited · human approves)
                          ▲          ▲ hub  ├─"deeper_memory"─▶ deepen ──┤                   │
                          │          │      │                  (walk graph)                  │
                          │          │      └─"research_web" ──▶ research ┤                   │
                          │          │                          (web search)                 │
                          │          └────────────────────────────────────┘                  │
                          └────────────────────────── ungrounded → re-assess ─────────────────┘
```

- **refine** *(LLM)* — rewrites the question into the vocabulary the founder's notes actually use, to improve recall.
- **retrieve** *(algorithm)* — routes into memory: vector ANN for the best anchors + a *dimension-complete* fetch (a position question pulls every fact on its dimension) + contradiction partners.
- **assess** *(LLM — the hub)* — the **enrichment decision**: is the evidence enough? It picks one of three: **answer** (synthesize now), **deeper_memory** (the missing piece is likely *in* memory — go expand the graph), or **research_web** (the gap needs *external* info — go search). It never sends private numbers to the web; a contradiction is reconciled when answering, not researched.
- **deepen** *(algorithm — graph enrichment)* — walks the typed graph out from the matched facts (signal siblings, contradiction partners, same-speaker, related-entity), then loops **back to assess**. It expands by *structure*, not by loosening similarity, so it stays on-topic.
- **research** *(LLM + web tool)* — searches the web, evaluates findings, and folds them back as **cited** facts (tier E2, isolated from first-party signals), then loops **back to assess**.
- **synthesize** *(LLM)* — composes the answer over the small retrieved set: leads with the decision, **reconciles contradictions** (says *why* values differ), flags **stale** figures and **unknown** current values instead of bluffing, calibrates confidence, cites a fact for every claim, ends in one recommended action. *It recommends; the human decides.*
- **verify** *(algorithm — the honesty gate)* — a deterministic grounding check: every cited fact must resolve to a real retrieved fact, or the claim is sent back / dropped. **No LLM grades itself.**
- **log** — writes the decision to the append-only log, pending the human's verdict.

The loop is **adaptive but bounded** — `assess` chooses to deepen/research each pass; convergence plus depth/round caps guarantee it terminates. **Everywhere: it recommends, the human decides — no autonomous side-effects.**

---

## Operable by any agent — MCP

Beyond the UI, the brain exposes a **Model Context Protocol** server (`npm run mcp`) so an external agent (e.g. Claude Desktop) can drive it: ask a question, read positions / signals / contradictions, walk a fact's provenance, and read or resolve the decision log — all over a clean, well-scoped interface, with no autonomous actions.

---

## Does it actually answer correctly?

`npm run eval` encodes the **ground truth** the data supports for each question — which sources must be cited, what reasoning must appear, the expected confidence band, whether a contradiction must surface — and scores the real agent against it.

- **ICP drift** → medium; surfaces the mid-market ↔ upmarket drift, weighs both sides.
- **Killer objection** → medium; budget authority recurs across companies (the competitor is a *competitor*, not the objection).
- **Defensible runway (hero)** → medium; reconciles **18mo (stale — burn rose)** vs **current (unknown)** vs **~9mo (conditional on the hires)**, researches the benchmark, and recommends getting the recomputed figure.
- **Top competitor (control)** → high; recurring, no contradiction.

---

## What I deliberately scoped out (honestly)

- **Sources are sample files** standing in for live Zoom/Gmail/Notion integrations.
- **Entity resolution** is deterministic (normalize + embedding + shared-token); a hosted version would add an LLM canonicalization pass for the hardest cases.
- **Contradiction detection** compares canonical values on position dimensions; a semantic NLI / LLM-judge is the scale-time upgrade (the schema doesn't change).
- **Multi-tenant isolation** is out of scope (single founder).
- Position **confidence** is rated conservatively at compile time; the *answer's* confidence is judged independently and lands correctly.
