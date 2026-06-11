# Decision Brain — Phase 2 Plan (The Agent), FINAL / Revised

> **Read this cold.** Self-contained — someone with no prior context understands the whole system.
> This is the **locked design** after two design reviews + a code-grounded check. Every choice here is
> one we agreed on; nothing speculative is added. Diagrams are ASCII so they render anywhere.

---

## 0. What this project is (30-second context)

A **"decision brain"** for a startup CEO (persona: **Maya Chen**, founder of **Loomwork**, a Series-A logistics-AI company). It **reads her messy week** (calls, emails, notes, a tweet), **builds a memory** of typed cited facts, **answers hard CEO questions** with citations + research + a recommendation she approves, and **logs every decision**.

Three questions (deepest on Q3):
- **Q1 — ICP:** "Is our ICP mid-market, or are we drifting upmarket?"
- **Q2 — objection:** "Which objection is killing deals — and is it real?"
- **Q3 — runway (hero):** "What runway can I defend in this week's investor update?"

Five non-negotiables: **provenance · honesty about gaps · fast model-free reads · the human decides · every decision logged.**

**Phase 1 (the memory) is built & verified. Phase 2 (the agent) is this plan.**

---

## 1. The big picture — all layers

```
═════ PHASE 1 · BUILD THE MEMORY  (done once, ahead of time — already built) ═════
  Maya's week        🧠 EXTRACT          CONNECT            MEMORY (the brain)
  calls · emails ─▶  facts + quotes ─▶  resolve people, ─▶  positions · signals ·
  notes · tweet      (LLM, write-time)  find conflicts      contradictions · facts
                                        (algorithms)        (typed · cited · fast)

═════ PHASE 2 · ANSWER A QUESTION  (runs every time Maya asks — THIS PLAN) ═════
  question ─▶ THE AGENT ── reads memory, researches gaps, decides ─▶ cited answer + recommendation
                  │                                                        │
       (one LLM-controlled decision: "enough, or research?" — bounded loop)│
                  │                                                        ▼
                  ▼                                                 returns a PENDING decision
            reads compiled artifacts                                       │
                                                          human approves/rejects (separate call)
                                                                           │
                                                              logged ◀──────┘
                                                                 │
                                                                 ▼  back into MEMORY
```

**One sentence:** *Phase 1 does the heavy thinking up front and stores it as memory; Phase 2 is a bounded agent that reads that memory, researches what's missing, and hands Maya a cited recommendation she approves — then logs it.*

---

## 2. The memory the agent reads (Phase 1 — what already exists)

8 tables (Postgres + pgvector). The agent **only reads** these; it never rebuilds them.

| table | what it holds |
|---|---|
| **sources** | raw items, untouched |
| **facts** | typed atoms — each with a **verbatim quote**, source, speaker, confidence, **evidence tier E1–E5**, a 384-dim **embedding**, and (where relevant) a `dimension`, a `qualifier`, and a canonical `comparable` |
| **entities** | canonical people/companies (one "Maya", not three string-matches) |
| **edges** | typed links (the graph), each a stored row with a similarity score |
| **signals** | facts that **mean the same** clustered by embedding, with count + companies + **promotion tier** (candidate→emerging→validated→decision_grade) |
| **contradictions** | first-class conflicts, each typed `kind` = **direct / conditional / drift** |
| **positions** | compiled, drift-aware **stances** (ICP, runway) — cited, with confidence + explicit `gaps` |
| **decisions** | the append-only **decision log** (Phase 2 writes here) |

Two principles that matter for Phase 2: **the LLM only fires at write-time seams (extract, compose)** — reading memory is pure DB queries, **no LLM**; and memory is **bi-temporal + append-only** (new facts never overwrite old ones).

---

## 3. The agent loop (FINAL)

### Design rules (locked)
- Built with **LangGraph.js (`StateGraph`)** — an explicit graph where *we* define every node, edge, and loop (full control; each node defensible). **Not** `createReactAgent` — a ReAct root agent hides the routing we must defend.
- The **LLM controls exactly ONE decision** — *"is memory enough, or research?"* — which can **loop** (assess → research → assess), with a **hard iteration cap**.
- That decision has a **deterministic floor** (below) so it can't silently skip or over-research.
- **Everything else is deterministic.** The LLM appears only where it earns its place.
- The whole loop is exposed over **MCP** (operable by an agent).

### The loop

```
  question
     │
     ▼
 ┌──────────────────┐
 │ 1. refine        │  LLM (light) · OPTIONAL — clean/expand the question for better matching.
 │   (optional)     │  First node to cut if it doesn't visibly improve recall.
 └────────┬─────────┘
          ▼
 ┌──────────────────┐
 │ 2. retrieve_     │  DETERMINISTIC (no LLM) · MULTI-ANCHOR: embed → position → else signals →
 │    memory        │  else facts (by similarity threshold) → JOIN into one cited evidence bundle
 └────────┬─────────┘
          ▼
 ╔══════════════════╗
 ║ 3. assess_       ║  LLM judgment ON TOP OF a deterministic floor → { sufficient?, gaps[],
 ║    sufficiency   ║  contradictions[] }                                  (the ONE LLM decision)
 ╚══╤═══════════╤═══╝◀───────────────────────────────┐
 sufficient │   │ research needed & budget left        │ re-assess after research
    │       │   ▼                                      │
    │       │ ┌──────────────────┐                     │
    │       │ │ 4. research      │  LLM plans 1–2 queries → web tool → SCORE untrusted results
    │       │ │   (web only)     │  → extract to ISOLATED, lower-tier, web-tagged cited facts ──┘
    │       │ └──────────────────┘     (scoped to this decision; NOT fed into positions/signals)
    │       │ research needed & budget spent
    │       └──────────────┐
    ▼                      ▼
 ┌────────────────────────────────┐
 │ 5. synthesize                  │  LLM (strict schema) · RECONCILE conditionals (don't just list
 │                                │  both); output answer + confidence + unknowns + recommendation
 │                                │  + structured citations: [{ claim, fact_ids[] }]
 └────────────┬───────────────────┘
              ▼
 ╔══════════════════╗
 ║ 6. verify_       ║  DETERMINISTIC · each claim's fact_ids resolve AND the quote appears in source?
 ║    grounding     ║  fail → regenerate once; fail twice → drop the claim / downgrade confidence
 ╚════════╤═════════╝
          ▼
 ┌──────────────────┐
 │ 7. log + return  │  DETERMINISTIC · append a PENDING decision and RETURN the recommendation.
 │   (pending)      │  (No in-process pause — MCP is stateless.) The human approves/rejects via a
 └────────┬─────────┘   separate `resolve_decision` call. It recommends; it never acts.
          ▼
      MEMORY  ◀── the decision/outcome folds back in (web research stays isolated)
```

### The deterministic floor on node 3 (so the LLM can't drift)
Research is **forced into consideration** — the LLM cannot skip it — whenever any of these hold:
```
position.confidence < threshold   OR   open contradictions exist   OR   gaps[] is non-empty
```
The LLM then judges *whether the evidence actually answers the question* and *what specifically to research*. Floor = auditable; LLM = judgment. *(Our current code already triggers research deterministically on `gaps`; this floor widens that trigger and the loop adds the LLM judgment + re-assessment.)*

### Node-by-node

| # | Node | LLM? | What it does |
|---|---|:---:|---|
| 1 | **refine** *(optional)* | LLM (light) | rewrite/expand the question for better semantic match; droppable |
| 2 | **retrieve_memory** | **No** | multi-anchor read (position → signals → facts) + table joins → cited bundle |
| 3 | **assess_sufficiency** | LLM + floor | judge enough/gaps/contradictions; route (synthesize / research / synthesize-with-caveats) |
| 4 | **research** | LLM + tool | plan queries → web → score untrusted → extract **isolated** lower-tier cited facts → re-assess |
| 5 | **synthesize** | LLM | reconcile conditionals; cited answer + confidence + unknowns + recommendation + `{claim, fact_ids}` |
| 6 | **verify_grounding** | **No** | resolve fact_ids + quote-in-source; regenerate/downgrade on fail |
| 7 | **log + return** | **No** | append a **pending** decision, return the recommendation |

### State that flows through

```
State = {
  question,
  refined_query?,                            // ← refine (optional)
  anchor, evidence_bundle,                   // ← retrieve_memory (multi-anchor)
  iterations,                                // ← loop counter (hard cap)
  sufficient, gaps, contradictions,          // ← assess
  research_facts,                            // ← research (isolated, lower-tier, web-tagged)
  answer, confidence, unknowns,              // ← synthesize
  recommendation, claims:[{claim,fact_ids}], // ← synthesize (structured citations)
  grounding_ok,                              // ← verify_grounding
  decision_id, status,                       // ← log (pending → approved/rejected via resolve)
}
```

---

## 3b. Retrieval — how memory is fetched (locked after iteration)

The memory fetch combines four things; together they make it robust *without drifting off-target*:

- **A · Strong local embeddings** — `all-mpnet-base-v2` (free, local, **768-dim**). Replaced MiniLM (384), whose weak vectors caused empty retrievals (Q2 found nothing — closest hit was distance 0.807). Swap via `LOCAL_EMBED_MODEL`; OpenAI optional.
- **B · Query refinement** (`refine` node, fast LLM) — rewrites the CEO question into the concrete vocabulary the founder's notes use, *before* embedding. A single rewrite (no step-back / decomposition — see below).
- **C · Adaptive depth** (`assess` decides) — the LLM picks one of: **`answer` · `deeper_memory` · `research_web`**. Bounded loops. *This* is "the agent decides how deep to search."
- **D · Graph-expanded fetch** — vector finds the *anchor*; we then expand **1 hop along the typed `edges`** (signal siblings → the whole cluster · contradiction partners · same-entity facts · related entities) to assemble the **connected neighborhood**. `deeper_memory` = expand further via the graph. Typed edges keep it on-topic — no vector drift (the failure mode of just loosening the similarity threshold). This is File 1's *"typed graph the brain can traverse."*

Plus **two synthesis nudges:** (1) confidence ≤ medium when a key figure is unverified; (2) present **scenarios/ranges**, not a falsely-precise single number, when the answer hinges on unresolved conditions (e.g. runway 18↔9).

**Deliberately skipped (scale-time, → design note):** **step-back** (our position routing already finds the topic) and **query decomposition** (type-hints + graph expansion already cover the facets) — both add per-query LLM cost against *"fast reads / intelligence over features."* They're the right upgrade for a year of data / multi-hop questions, not a 12-item demo.

## 4. How it fetches the details (retrieval / joins)

This is node 2 in full — turning "land in memory" into a **connected, cited trace**.

### 4a. Landing (MULTI-ANCHOR — revised)
```
(refined) query → embed()
  → try POSITIONS   (vector + keyword backstop)  ── clears threshold? use it
  → else SIGNALS    (e.g. Q2 → the budget signal — no position needed)
  → else FACTS      (similarity fallback for a novel question with no position/signal)
```

### 4b. The joins (deterministic — SQL + graph edges, no LLM)
```
        ┌──────────────── ANCHOR: runway position ────────────────┐
        │   "≈18mo at current burn / ≈9mo post-hire"               │
        │   confidence: medium · gaps: [burn rate unverified]      │
        └───┬───────────────┬───────────────┬─────────────────────┘
       fields.fact_ids   composed_from     addresses
            │               │               │
            ▼               ▼               ▼
    ┌──────────────┐  ┌──────────┐   ┌────────────────┐
    │ CITED FACTS  │  │ SIGNALS  │   │ CONTRADICTION  │
    │ 18mo · 9mo*  │  │ (pattern)│   │ runway: 18 ↔ 9 │  (*9mo carries qualifier "+2 AE hires")
    └──────┬───────┘  └────┬─────┘   └───────┬────────┘
      fact.source_id  signal.fact_ids   fact_a / fact_b
            │              │                 │
            ▼              ▼                 ▼
    ┌──────────────┐  member facts     both clashing facts + their sources
    │ SOURCES      │  (the evidence
    │ + speaker    │   behind it)
    │ (PROVENANCE) │
    └──────┬───────┘
           │ fact.speaker / source.author → resolve to entity
           ▼
    ┌──────────────────────────────────────────────┐
    │ ENTITIES (authors) + relationships             │
    │  Devin (CTO) ─works_at→ Loomwork                │
    │  Northpeak ─invested_in→ Loomwork               │
    │  "signals about Devin" = facts Devin said → the │
    │     signals those facts belong to               │
    └──────────────────────────────────────────────┘
```

Joins in words: `position.fields.fact_ids → facts` · `fact.source_id → sources` (provenance) · `position --composed_from--> signals --fact_ids--> facts` · `position --addresses--> contradictions --fact_a/b--> facts` · `fact.speaker → entity` + entity edges · `entity → its facts → their signals` · `position.gaps` carried forward.

### 4c. Output: one small, typed, cited, connected bundle
```
evidence_bundle = { position, cited_facts[+provenance], signals[+members],
                    contradictions[+both sides, with kind], entities[+relationships], gaps }
```
A **sub-graph, not a row dump** — every claim already carries its quote + source. This is "read artifacts, don't improvise."

---

## 5. The research sub-loop (when memory isn't enough)

Fires from node 3 when a gap remains **and** there's iteration budget:
```
assess → research → re-assess → … (HARD cap, e.g. 2 rounds; then synthesize-with-caveats)
```
Inside `research`: the LLM **plans 1–2 web queries** → real **web/search tool** → results are **untrusted** so they're **scored/sanitized** → useful findings **extracted as typed facts**.

**Isolation guarantee (revised — #4):** research facts are
- `provenance = web` (source = the URL), **lower tier (E3, external)**,
- **scoped to the decision** (`research_fact_ids`) and **cited in the answer**,
- **excluded from position/signal compilation** — they **never** flow into the canonical compiled artifacts, so external research can't quietly degrade future first-party reads.

**Trusted vs untrusted:** memory results are already typed/cited and stay **model-free** (never LLM-sanitized); **only web** results get the scoring treatment. Mixing them would break "no LLM in the read path."

---

## 6. Honesty, guardrails, decision log

- **verify_grounding (deterministic — #5):** because `synthesize` emits `[{claim, fact_ids}]`, the check is exact — each `fact_id` resolves **and** its quote appears in the cited source. Fail → regenerate once; fail twice → drop the claim or downgrade confidence. Makes "no hallucinated citations" **structural**.
- **The human decides (#6):** the loop **returns a pending decision** (it does **not** pause an MCP call). The human later calls `resolve_decision` to approve/reject. Recommend-only — **no autonomous action, ever.**
- **Decision log (append-only):** one row per decision, kept forever:
  ```
  decision = { question, evidence(facts+sources), confidence, recommendation, gaps,
               research_fact_ids, contradiction_ids,
               status: pending → approved | rejected, human_note, timestamps }
  ```
  "Why did it say that?" is answerable a week later; approved outcomes loop back into memory.

---

## 7. The agent surface (MCP)

```
query_brain(question)      → runs the loop; returns the cited recommendation + a pending decision
get_provenance(fact_id)    → the quote/source/speaker/location behind any fact
list_contradictions()      → the open conflicts (with kind)
get_position(name)         → a compiled position with citations + gaps
list_signals()             → signals with promotion tiers
list_decisions()           → the append-only log
resolve_decision(id, …)    → record the human's approve/reject
```
Satisfies the bar: *"operable by an agent, not just queryable by a human."*

---

## 8. Worked example — Q3 end-to-end (revised framing)

**Maya asks:** *"What runway can I defend in this week's investor update?"*

1. **refine** → intent: defensible runway figure + its basis.
2. **retrieve_memory** → lands on the **runway position**; joins out:
   - **18 months** (Northpeak investor email, Maya) — *unconditional*
   - **9 months** (board note, Devin) — *conditional, qualifier "+2 AE hires"*
   - contradiction `runway` typed **`conditional`** (our memory already knows it's a scenario split, not a flat conflict)
   - gap: *exact monthly burn not independently verifiable.*
3. **assess_sufficiency** → floor trips (a contradiction + a gap exist) → the LLM judges what's researchable.
4. **research** → the **private burn can't be web-researched**, so research targets a **genuine external gap** (e.g., how Series-A founders present runway / what investors expect) → folded back as an **isolated, lower-tier, web-tagged** cited fact that informs *how to present* — **not** a fabricated burn number → re-assess → sufficient.
5. **synthesize** (RECONCILE the conditional):
   > *"Defend **≈18 months at current burn**, and flag it drops to **≈9 months** once the two AE hires land — present 18 with that explicit caveat. **I can't verify your monthly burn from public data — confirm it and I'll firm this up.** Confidence: medium."* (every number cited).
6. **verify_grounding** → each claim's `fact_ids` resolve + quotes match ✅.
7. **log + return** → pending decision → Maya later **approves** via `resolve_decision` → recorded → back into memory.

That single pass shows **conditional reconciliation + real (external) research + honest gap + a logged decision** — the hero demo, honest under scrutiny.

---

## 9. Deterministic vs LLM — where the model earns its place

| Step | Deterministic | LLM |
|---|:---:|:---:|
| refine *(optional)* | | ✅ (light) |
| retrieve_memory (read + joins, multi-anchor) | ✅ | |
| assess_sufficiency | ✅ (the floor) | ✅ (judgment) |
| research: web call + scoring + write-back + isolation | ✅ | ✅ (plan queries + extract) |
| synthesize (answer + structured citations) | | ✅ |
| verify_grounding | ✅ | |
| log + return pending; resolve verdict | ✅ | |

**Memory reads are always model-free.** LLM only at: refine (light, optional), assess (judgment), research extraction, synthesize.

---

## 10. The rules it honors (grounded)

| Rule (brief) | How Phase 2 satisfies it |
|---|---|
| Provenance | every fact carries quote+source; `verify_grounding` enforces every claim cites a resolvable fact |
| Honesty about gaps | `assess` surfaces gaps/contradictions; researches before guessing; states confidence + unknowns (Q3 explicitly says what it can't verify) |
| Fast, model-free reads | `retrieve_memory` is pure SQL/vector; the LLM never re-reads the corpus |
| The human decides | returns a pending decision; `resolve_decision` records approve/reject; no autonomous action |
| Every decision logged | append-only `decisions`; auditable; outcomes loop back |
| Operable by an agent | the whole loop is MCP tools |
| Intelligence over features | heavy work at write-time; answer-time agent reads compiled artifacts; LLM only where it earns its place |

---

## 11. Scope for two days (what to protect vs cut)

**Differentiators to protect:** the `assess ↔ research` gate, `verify_grounding`, the decision log + human verdict, and the **honest Q3 walkthrough.**
**If time gets tight (in order):** drop `refine` → cut research to **1 round** → trim MCP to `query_brain` + `get_provenance` + `resolve_decision`. **Never** cut polish on the Q3 hero demo.

---

## 12. Build status (what exists vs to-build)

**Already in code (Phase 2 skeleton):** `route` (already multi-anchor: positions + signals + facts) · deterministic gap-trigger research · `research` folding web facts as E3 cited facts · `synthesize` (reconciles, returns `used_fact_ids`) · the full MCP surface · pending decision + `resolve_decision`.

**Built (this session) — implemented with LangGraph.js `StateGraph` in `src/answer/graph.ts`:**
1. ✅ **`assess_sufficiency`** (LLM + deterministic floor, `src/answer/assess.ts`) + the **bounded `assess ↔ research` loop** (cap 2).
2. ✅ **`verify_grounding`** — `synthesize` now emits `[{claim, fact_ids}]`; verify resolves the ids (quote-in-source is guaranteed at ingest) → retry-once edge → else drop unsupported claims + downgrade confidence.
3. ✅ **Web facts isolated** from position compilation (`positions/index.ts` excludes `source` prefixed `web/`; signals already exclude `type=claim`).
4. ✅ **`facts` similarity fallback** in `route` for novel, no-anchor questions.
5. ✅ *(framing)* `assess` is instructed to **never** name private/internal data (e.g. the burn) as a research gap — so Q3 research only targets web-answerable gaps; the private burn stays an honest unknown.

**Verified:** typecheck clean · smoke 10/10 (Phase 1 intact) · `StateGraph` compiles. **Not yet run live** (needs `OPENAI_API_KEY` for the `assess`/`synthesize` seams; `TAVILY_API_KEY` optional for research).

---

### TL;DR
- **Phase 1 (built):** messy week → typed, cited, connected **memory** (8 tables); heavy LLM work once, at write-time.
- **Phase 2 (this plan):** an **agent loop** — *refine? → retrieve (deterministic, multi-anchor) → **assess: enough or research?** (LLM + deterministic floor, bounded loop) → research (web, isolated lower-tier cited facts) → synthesize (reconcile + structured citations) → verify grounding → log a pending decision* — built with **LangGraph.js `StateGraph`**, over MCP.
- The **only** thing the LLM *decides* (bounded) is **"memory vs research."** Everything else is deterministic, cited, isolated where it must be, and logged.
