# Decision Brain

A **decision brain** for a scaling CEO. Drop in a founder's week — calls, emails, notes, a tweet, a Slack thread — and it builds a **queryable, cited, contradiction-aware memory**. Ask it a hard question and an **agent** answers from that memory (expanding the graph or searching the web when memory is thin) and returns a **defensible recommendation with receipts** that a human approves or rejects.

---

## Run it — one command

**Prerequisites:** Node **20+** and a **Gemini API key** (free from [Google AI Studio](https://aistudio.google.com/apikey)). No Docker, no database to install.

```bash
git clone https://github.com/mohammjavad123/brain-decision && cd brain-decision
npm install
cp .env.example .env            # then paste your GEMINI_API_KEY into .env
npm start                       # the one command
```

Open **http://localhost:8787**. `npm start` installs the UI deps, builds the React app, **serves the UI and the API on one port**, and **builds the brain from the week's data automatically on first run**.

**First run (~2–3 min, once):** it downloads a small local embedding model (~110 MB, no key) and runs the write-time pipeline live in the console (`extract → connect → signals → positions`). Later starts are instant — the brain is cached on disk. With no key set, it tells you exactly what to add and exits gracefully.

| `.env` | |
|---|---|
| `GEMINI_API_KEY` | **required** — powers the LLM seams |
| `TAVILY_API_KEY` | optional — real web research; **degrades honestly** without it |
| `EMBEDDING_PROVIDER` | optional — defaults to a free, local 768-dim model (no key) |

**Two things to try in the UI:**
- **Ask the brain** — type a question and watch the agent think step-by-step. Start with *"What runway can I defend in this week's investor update?"*
- **Build memory** — click **load corpus → Ingest** and watch raw text become typed facts, an entity graph, signals, and positions, live.

*Troubleshooting:* port busy → `lsof -ti:8787 | xargs kill` or `WEB_PORT=8788 npm start`; start fresh → delete `.data/` and restart.

---

# How it works

**The one design rule:** *LLMs live at the seams, algorithms live in the path.* The model is used only where judgment is irreducible — turning text into typed facts, composing a position, deciding the next step, writing the answer. **Everything else is plain, deterministic code:** clustering, similarity math, entity resolution, contradiction detection, time-travel, grounding checks.

## How a fact is created

A **fact** is the atom everything is built from. Creating one (write-time):

1. A raw item arrives (a call, email, note…).
2. **The LLM extraction seam reads it once** and emits *typed atoms* — for each claim: a normalized `value` (*"runway = 18 months"*), the **verbatim quote** it came from, the `speaker`, a `dimension` (runway / icp / budget…), an optional `qualifier` (*"after hiring 2 AEs"*), a canonical `comparable` (*"18 months"*), and an `evidence_tier` (E1 casual … E5 decision-grade).
3. **The quote is verified** to be a real substring of the source — if it isn't, the fact is rejected. This is the anti-hallucination guard: the model can't invent provenance.
4. **An embedding is computed** — a 768-number vector that captures the fact's *meaning*.
5. The fact + its embedding are stored in **one Postgres row** (pgvector).

Only **step 2** is the LLM. Steps 3–5 are deterministic. The result: a claim that is cited, typed, time-stamped, and searchable by meaning.

## Where "similarity" is actually used (it's not just the query)

We have embeddings (meaning → vector) and **pgvector** (distance between vectors, the `<=>` operator). That distance — **never an LLM** — does the heavy lifting in **three** places. The user query is only the last one:

**1 · Clustering facts into signals — *write-time*.**
After extraction we have a pile of facts. Facts whose vectors are *close* mean the same thing:

```
"can't get budget approved mid-cycle"  ┐
"the VP holds the budget"              ├─ vectors are close ─▶  ONE signal: "budget authority"
"needs sign-off above the pilot"       ┘                        count 9 · 6 companies · decision-grade
```

We group facts by vector proximity, count how many calls/companies they span, and **promote** the cluster by threshold (candidate → emerging → validated → decision-grade). This is how scattered mentions become *"this objection recurs across 6 companies."* **No LLM — vector distance + a counting threshold.**

**2 · Resolving entities by meaning — *write-time*.**
Name variants for the same real thing (*"Maya"* / *"Maya Chen"*) are merged using embedding similarity (plus token rules), so the graph has **one canonical node**, not three strings.

**3 · Routing the user's question — *read-time*.**
When the CEO asks something, we embed the question and use pgvector to fetch the **closest facts and positions** — the retrieval step. This is the *only* place tied to the user query.

> So similarity isn't a search box bolted on the side — **it's the mechanism that builds the memory's structure** (signals + entity graph) at write-time, and *also* routes questions at read-time. The embedding model is a deterministic transform; everything that consumes it (clustering, merging, retrieval) is algorithm, not model.

## Why one store: Postgres + pgvector

The relational data **and** the meaning-vectors live in the **same row**, so *"what means the same as X?"* and *"filter by dimension/date/company"* are **one SQL query**, not a vector DB plus a relational DB kept in sync. One index every layer reads from; reads stay model-free and fast. Locally it's **PGlite** (Postgres + pgvector, in-process, zero setup); in production the same schema points at hosted Postgres.

## Bi-temporal & append-only (so beliefs can drift, not vanish)

Every record carries `valid_time` (true in the world), `learned_time` (when we recorded it), and `superseded_at` (tombstone; empty = current). Nothing is destructively overwritten — a new fact never erases an old belief, so *"what did we think on May 20?"* is just a filtered query. That's what lets a **position visibly drift** over time.

## The tables, and the thinking behind each

| table | holds | why |
|---|---|---|
| **sources** | raw items, never edited | provenance is sacred; identity = hash of the body → re-ingest is a no-op |
| **facts** | the typed atoms (value · verbatim quote · tier · dimension · qualifier · comparable · embedding) | the smallest unit that is at once **cited, typed, scored, time-aware, embeddable** |
| **entities** | one canonical person/company/investor/competitor (+ aliases) | one *Maya Chen*, not three strings — the graph needs real nodes |
| **edges** | the typed graph: `subject –predicate→ object`, plus scored `fact → signal` links | the knowledge graph — walkable with a `JOIN`, every claim clicks back to its quotes |
| **signals** | the same claim aggregated across calls (count · companies · tier) | turns scattered mentions into *"recurs across 6 companies"* |
| **contradictions** | conflicts as first-class rows (direct / **conditional** / drift) | *18mo* vs *9mo* runway must be **noticed and kept**, not smoothed over |
| **positions** | the compiled stance (ICP, runway) + per-field citations + gaps | the drift-aware *"where do we stand?"* — its gaps trigger research |
| **decisions** | append-only log: question · answer · confidence · evidence · recommendation · human verdict | the loop closes here; every call is auditable |

**One store, three lenses:** SQL for fast time-aware reads · vectors for meaning (clustering + retrieval) · graph edges for the connections between people, companies, and deals.

---

# The agent (the decision point)

A small, explicit state machine (LangGraph) — not a free-roaming agent — so the flow is deterministic and auditable. **`assess` is the single hub** every loop routes back through.

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

- **refine** *(LLM)* — rewrite the question into the words the founder's notes actually use (better recall).
- **retrieve** *(algorithm)* — pgvector routing (above) + a *dimension-complete* fetch + contradiction partners.
- **assess** *(LLM — the hub)* — **is the evidence enough?** Picks one of three: **answer**, **deeper_memory** (the piece is likely *in* memory → expand the graph), or **research_web** (needs *external* info → search). Private numbers never go to the web; a contradiction is reconciled, not researched.
- **deepen** *(algorithm)* — walk the typed graph out from the matched facts (signal siblings, contradiction partners, same speaker, related entity), then loop **back to assess**. Expands by *structure*, not by loosening similarity → no drift.
- **research** *(LLM + web)* — search, evaluate, fold findings back as **cited** facts (kept separate from first-party data), then loop **back to assess**.
- **synthesize** *(LLM)* — lead with the decision; **reconcile contradictions** (say *why* values differ); flag **stale** figures and **unknown** current values instead of bluffing; cite a fact for every claim; one recommended action. *It recommends; the human decides.*
- **verify** *(algorithm — the honesty gate)* — every cited fact must resolve to a real retrieved fact, or the claim is sent back / dropped. **No LLM grades itself.**
- **log** — write the decision to the append-only log, pending the human's verdict.

Adaptive but bounded — `assess` chooses to deepen/research each pass; convergence + depth/round caps guarantee termination. **No autonomous side-effects, ever.**

### Operable by any agent — MCP
Beyond the UI, `npm run mcp` exposes a Model Context Protocol server so an external agent (e.g. Claude Desktop) can ask questions, read positions/signals/contradictions, walk a fact's provenance, and read or resolve the decision log — over a clean interface, no autonomous actions.

### Does it answer correctly?
`npm run eval` encodes the **ground truth** per question (must-cite sources, required reasoning, confidence band, whether a contradiction must surface) and scores the real agent: ICP drift (medium, both sides) · killer objection (medium, budget authority across companies) · **defensible runway** (medium — reconciles *18mo stale* vs *current unknown* vs *~9mo conditional*, researches the benchmark) · top competitor (high, control).

---

## What I deliberately scoped out (honestly)
- **Sources are sample files** standing in for live Zoom/Gmail/Notion integrations.
- **Entity resolution** is deterministic (normalize + embedding + shared-token); a hosted version would add an LLM canonicalization pass for the hardest cases.
- **Contradiction detection** compares canonical values on position dimensions; a semantic NLI / LLM-judge is the scale-time upgrade (schema unchanged).
- **Multi-tenant isolation** is out of scope (single founder).
