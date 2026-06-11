# Decision Brain

A **decision brain** for a scaling CEO. Drop in a founder's week (calls, emails, notes, a tweet); it builds a **queryable, cited, contradiction-aware memory**; and when the CEO asks a hard question, an **agent** answers from that memory — expanding the graph or searching the web when memory is thin — and hands back a **defensible recommendation with receipts** that a human approves or rejects.

> Built for the VSI / Builders Studio challenge (persona: **Maya Chen / Loomwork**). Two source docs inform the design:
> - **[File 1] VSI Architecture Overview** — *how Builders turns conversations into decisions* (philosophy).
> - **[File 2] The Build Challenge** — *the task, the 3 questions, the rubric.*

---

## The one idea everything follows

> **"LLMs live at the seams, algorithms live in the path."** — [File 1]

- **LLM at the seams** — only where judgment is irreducible: *extract* typed facts from messy text, *compose* a drift-aware position, *assess* what to do next, *synthesize* the answer.
- **Algorithms in the path** — everything that should be deterministic: clustering, promotion thresholds, entity resolution, contradiction detection, time-travel, provenance walks, and **grounding verification**. **No LLM in the read path's plumbing.**

---

## Run it — one command

**Prerequisites:** Node **20+** and **one LLM key** (a free [Google AI Studio](https://aistudio.google.com/apikey) Gemini key works great). That's all — no Docker, no database to install, no second key.

```bash
git clone https://github.com/mohammjavad123/brain-decision && cd brain-decision
npm install                                   # root deps (pinned by package-lock.json)
cp .env.example .env && echo "add your GEMINI_API_KEY to .env"   # then paste your key into .env
npm start                                     # the one command — builds UI, seeds, serves
```

Then open **http://localhost:8787**. `npm start` is self-contained: it installs the UI's deps, builds the React app, **serves the UI *and* the API on one port**, and **seeds the brain from `data/corpus/` automatically on first run**.

**What to expect on first run (~2–3 min, once):** it downloads the local embedding model (~110 MB, no key) and runs the write-time pipeline over Maya's 14-item week with your key. You'll see it build live in the console (`extract → connect → signals → positions`). Every later start is instant (the brain is cached in `.data/`). If you started with no key, it tells you exactly what to add and exits gracefully.

### `.env`

| var | required? | what it does |
|---|---|---|
| `LLM_PROVIDER` | no (default `openai`) | `gemini` or `openai` — the brain is provider-agnostic |
| `GEMINI_API_KEY` | if `gemini` | the LLM seams (Gemini's OpenAI-compatible endpoint) |
| `OPENAI_API_KEY` | if `openai` | the LLM seams |
| `TAVILY_API_KEY` | no | real web research for gap-filling; **degrades honestly** without it |
| `EMBEDDING_PROVIDER` | no (default `local`) | `local` = transformers.js **all-mpnet-base-v2**, 768-dim, **no key, free** |

Per-seam models are auto-selected by provider (override via `EXTRACT_MODEL` / `COMPOSE_MODEL` / `ANSWER_MODEL` / `SYNTHESIZE_MODEL`). On Gemini the defaults are **Flash** for the cheap/high-volume seams (extract, refine, assess) and **Pro** for the reasoning seams (compose, synthesize).

> **One-process DB.** Memory is **PGlite** (Postgres + pgvector, in-process — zero setup). It's single-process, so **don't run `npm run seed` while the server is up** — change memory through the **UI buttons** instead (below). In production you swap the connection string for Supabase Postgres + pgvector — *same schema, same queries.*

### Other entry points

```bash
npm run web        # API only (no UI build) — for dev alongside `cd web && npm run dev`
npm run seed       # (re)build memory from the corpus  [server must be DOWN]
npm run eval       # acceptance eval — scores Q1–Q4 against ground truth
npm run mcp        # the MCP agent surface (stdio)      [server must be DOWN]
npm run inspect    # dump facts / entities / signals / positions
```

### Troubleshooting
- **"Port 8787 already in use"** — a server is already running. `lsof -ti:8787 | xargs kill`, or `WEB_PORT=8788 npm start`.
- **"memory is empty and no …_KEY is set"** — add your key to `.env` and re-run `npm start`.
- **Single-process DB** — memory is PGlite (in-process). Don't run `npm run seed` *while* `npm start` is up; to change memory at runtime use the UI's **clean memory** / **Ingest** buttons instead.
- **Start fresh** — delete `.data/` and restart; it re-seeds.

---

## What you can do in the UI

Two modes, one page (http://localhost:8787):

**① Ask the brain** — type a CEO question, watch the **agent loop** light up node-by-node in real time (the *Flow* tab) or read the full *Trace*, then approve/reject the recommendation. The agent **streams** every step.

**② Build memory** — paste raw items (one or many) and watch them become typed memory live: **parse → extract → connect → signals → positions**, with the entity graph drawing as it builds. Buttons:
- **load corpus** — drops Maya's full 14-item week into the box
- **load example** — a single rich weekly-sync item
- **Ingest** — runs the real Phase-1 pipeline on whatever's pasted; **additive** (new items join the existing brain; identical bodies are skipped by content hash)
- **clean memory** — wipes the whole brain so you can start a new subject and rebuild

Great demo arc: **clean memory → load corpus → Ingest** (watch it assemble), then **Ask the brain**.

---

## Architecture at a glance

```
  RAW WEEK                  PHASE 1  ·  build memory (write-time)                 PHASE 2  ·  the decision (read-time)
  ────────                  ───────────────────────────────────                  ──────────────────────────────────
  calls                     extract → verify → embed → store                      a CEO question
  emails        ────────▶   resolve entities · wire edges · contradictions  ──▶   ↓  the agent loop  ↓        ──▶  cited
  notes                     cluster signals · promote                             retrieve · assess ·              recommendation
  tweet                     compose positions                                     deepen / research ·              + logged decision
  slack                                                                           synthesize · verify              (human approves)
                                   │                                                      │
                                   ▼                                                      ▼
                       ONE store: Postgres + pgvector  ◀──────── reads (pure SQL, no LLM) ───────
                       (bi-temporal · append-only · content-addressed)
```

LLM seams are marked ✦ below; everything else is deterministic.

---

# Phase 1 — Build the memory

```
raw item ─[extract ✦ LLM]→ typed facts (+entities +relationships +comparable)
         ─[verify quote · embed]→ stored                        (algorithms)
         ─[resolve entities · wire edges · detect contradictions]→ graph   (algorithms)
         ─[cluster by meaning · promote]→ signals                (algorithms)
         ─[compose ✦ LLM]→ positions
```

### One store: Postgres + pgvector
Relational data **and** vector search live in the same row, so *"what means the same as X?"* and *"filter by dimension/date"* are **one SQL query**, not two systems to sync. *[File 1]: "one index every layer reads from… reads stay sub-100ms forever."*

### Bi-temporal & append-only
Every record carries **`valid_time`** (true in the world), **`learned_time`** (when we recorded it), **`superseded_at`** (tombstone; empty = current). Nothing is ever destructively updated → *"what did we believe on May 20?"* is one query. *[File 2]: "a new fact never silently overwrites an old one."*

### The 8 tables (what each is for)
| table | role |
|---|---|
| `sources` | raw items, **sacred**; identity = `sha256(normalized body)` → re-ingest is a no-op |
| `facts` | the typed atoms — `type`, `value`, **verbatim `quote`** + char offsets, `evidence_tier` (E1–E5), `dimension`, `qualifier`, **`comparable`**, bi-temporal, `embedding` |
| `entities` | one canonical record per real-world thing (+ `aliases`) |
| `edges` | the typed graph — `subject –predicate→ object`, plus scored `fact →member_of→ signal` links |
| `signals` | the same claim aggregated across calls — `count`, `companies`, `promotion` (candidate→emerging→validated→decision_grade) |
| `contradictions` | conflicts as first-class rows — `kind` ∈ direct/**conditional**/drift/superseded |
| `positions` | the compiled drift-aware stance (ICP, runway) with per-field citations + `gaps` |
| `decisions` | the append-only decision log (question · answer · confidence · evidence · recommendation · human verdict) |

### How the dots connect (all deterministic)
- **Entity resolution** — normalize + token-containment (*Acme* → *Acme Freight*), then embedding similarity, then a **distinctive shared-token** merge (catches *"lost halberd"* → `Halberd Freight`). *[File 2]: "one canonical person, not three string-matches."*
- **Signals** — cluster facts **by embedding meaning** (not keywords); promote on **pure thresholds**.
- **Contradictions** — only on **position dimensions** (runway/icp/pricing), comparing the canonical `comparable` of the **two best-supported** values → robust to an over-eager extractor (no `C(n,2)` explosion). *[File 2]: "'18 months' vs '9 months' is a contradiction the brain must notice."*

---

# Phase 2 — The agentic decision layer

This is the part the rubric calls **"the decision point"** and **"agent surface."** It's a **LangGraph.js `StateGraph`** — explicit nodes and edges, not a free-for-all ReAct agent — so the control flow is deterministic and auditable. **`assess` is the single hub** every loop routes back through.

```
                        ┌──────────────────── THE AGENT LOOP (LangGraph StateGraph) ────────────────────┐
                        │                                                                               │
 question ──▶ refine ──▶ retrieve ──▶  ASSESS  ──"answer"──────────────────────────▶ synthesize ──▶ verify ──┬─ grounded ─▶ log ─▶ DECISION
              ✦ LLM       (memory)      ✦ LLM  │                                        ✦ LLM      (algorithm)│        (cited, human approves)
                            ▲           ▲ hub  │                                            ▲                 │
                            │           │      ├─"deeper_memory"─▶ deepen ─────────────────┤                 │
                            │           │      │                  (walk the graph)         │                 │
                            │           │      └─"research_web" ──▶ research ───────────────┤                 │
                            │           │                          (Tavily web search)     │                 │
                            │           └──────────────────────────────────────────────────┘                 │
                            └────────────────────────────── ungrounded → re-assess ───────────────────────────┘
```

**Node by node:**

1. **`refine`** ✦ — rewrites the CEO's question into a retrieval query in the *vocabulary the founder's notes actually use* (bridges "which objection kills deals" → "budget authority sign-off approval stall"). Improves recall before retrieval.

2. **`retrieve`** *(algorithm)* — deterministic routing into memory: keyword/type hints + **pgvector** ANN for the best anchors, **dimension-complete** fetch (a position question pulls *every* fact on its dimension), plus a 1-hop **contradiction-partner** pull. Never an LLM.

3. **`assess`** ✦ — **the hub.** Given the question + retrieved evidence, it makes a **3-way decision**:
   - **`answer`** — the evidence is enough → go synthesize.
   - **`deeper_memory`** — thin, but the missing piece is *likely already in memory* → **enrich** by expanding the graph.
   - **`research_web`** — the gap needs *external/public* info (benchmarks, market norms) → **search the web**.
   It will **never** send private/internal unknowns (exact burn) to the web — that stays an honest gap. A contradiction is **reconciled when answering, not researched.**

4. **`deepen`** *(algorithm — graph enrichment)* — when `assess` says *deeper_memory*, walk the **typed graph** out from the matched facts: signal-cluster siblings, contradiction partners, same-speaker facts, related-entity facts (1 hop on the entity edges). **It expands by structure, not by loosening the vector threshold** — so it stays on-topic instead of drifting. Then it loops **back to `assess`**.

5. **`research`** ✦ + tool — when `assess` says *research_web*, call **Tavily**, evaluate the findings, and **fold them back as cited facts** (`evidence_tier: E2`, source `web/…`), kept isolated from first-party signals. Loops **back to `assess`**.

6. **`synthesize`** ✦ — composes the answer over the **small retrieved set** (never the corpus): leads with the decision-useful bottom line, **reconciles contradictions** (says *why* values differ — condition vs. date), flags **stale** figures and **unknown** current values instead of bluffing, calibrates confidence, labels external benchmarks, cites a `fact_id` for **every** claim, and ends in **one** recommended next action. *It recommends; the human decides.*

7. **`verify`** *(algorithm — the honesty gate)* — **deterministic grounding check**: every claim's cited `fact_id`s must resolve to real retrieved facts. If a claim is ungrounded, it loops **back to `assess`** to find support (bounded); if it still can't, the claim is dropped and confidence downgraded. *No LLM judges itself here — an algorithm does.*

8. **`log`** *(algorithm)* — writes the decision (question, answer, confidence, evidence, recommendation, gaps) to the append-only **decision log**, `status: pending`, awaiting the human's approve/reject.

**The loop is adaptive but bounded:** `assess` chooses to deepen/research each pass; **convergence** (a hop adds no new facts) plus caps (`MAX_DEPTH=3`, `MAX_RESEARCH_ROUNDS=2`, `MAX_VERIFY_RETRIES=1`) guarantee termination. **Hard rule, everywhere: it recommends, the human decides — no autonomous side-effects.**

### Why this shape
*[File 2] design questions answered directly:* **"how does the agent decide memory vs. research?"** → the `assess` hub. **"keep answers honest?"** → deterministic `verify` + per-claim citations + explicit confidence/gaps. **"research what it doesn't know?"** → `research` folds web findings back as *cited* facts, not a raw dump.

---

## The agent surface — MCP

The brain is **operable by any external agent**, not just our UI (rubric #6). `npm run mcp` exposes a Model Context Protocol server (stdio) with 7 well-scoped tools — point Claude Desktop at it via `claude_desktop_config.json`:

| tool | does |
|---|---|
| `query_brain` | ask a CEO question → runs the full loop → cited recommendation + logs the decision |
| `get_position` | a compiled position (ICP/runway) with citations + gaps |
| `list_signals` / `list_contradictions` | read the aggregated signals / first-class contradictions |
| `get_provenance` | a fact → its exact source, quote, speaker, location |
| `list_decisions` / `resolve_decision` | read the log / record the human's verdict (records only — never acts) |

---

## Does it actually work? — the eval

```bash
npm run eval        # server must be DOWN (single-process DB)
```

Encodes the **ground truth** the data supports for each question (must-cite sources, must-mention reasoning, expected confidence band, whether a contradiction must surface) and scores the real agent against it. Current: **29/29** on Maya's week.

- **Q1 ICP drift** → medium; surfaces the mid-market ↔ upmarket drift, weighs both sides.
- **Q2 objection** → medium; budget authority is the recurring, cross-company killer (FreightPilot is a *competitor*, not the objection).
- **Q3 runway (hero)** → medium; reconciles **18mo (stale — burn rose after eng hires)** vs **current (unknown)** vs **~9mo (conditional on the AE hires)**, researches the benchmark, recommends getting the recomputed figure.
- **Q4 competitor (control)** → high; FreightPilot, recurring, no contradiction.

---

## Repo map

```
src/schema/    typed contracts (Zod) — data model + LLM seam I/O
src/db/        client (PGlite+pgvector) · migrate · queries (the read/write path)
src/ingest/    extract ✦ · verify quote · embed · store · parse pasted items
src/connect/   resolve entities · wire edges · detect contradictions   (algorithms)
src/signals/   cluster + promotion ladder                              (algorithms)
src/positions/ compose ICP + runway ✦
src/answer/    refine ✦ · route · assess ✦ · deepen · research ✦ · synthesize ✦ · verify · graph (the loop)
src/llm/       structured() — the one provider-aware file (OpenAI / Gemini) · local embeddings
src/web/       the one-process server: UI (static) + API (SSE) + /ingest + /reset + /corpus
src/mcp/       MCP server — the agent surface
web/           React + Vite UI (Ask the brain · Build memory)
data/corpus/   Maya's week (~14 messy items)
scripts/       eval · deeptest (3× stability) · smoke
```

---

## What I deliberately scoped out (honesty, per [File 2])

- **Sources are mocked** as markdown in `data/corpus/` (no live Zoom/Gmail/Notion).
- **Entity resolution** = normalize + embedding + shared-token. Production path: an LLM canonicalization pass for the hardest cases.
- **Contradiction detection** = canonical-`comparable` compare on position dimensions. Production path: an NLI / LLM-judge for free-text semantic conflicts (schema unchanged).
- **Position confidence** on Gemini is rated conservatively (compiles "low"); the *answer* confidence is judged independently at synthesis and lands correctly. A compose-prompt calibration tweak would align the stored value.
- **Graph** = triple-store rows + `JOIN`s (right at this scale). Production path at huge scale: a dedicated graph store.
- **Multi-tenant isolation** is deferred (single founder).
```
