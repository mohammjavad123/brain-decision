# Phase 2 — Core Role & Criteria (extracted from the 2 files)

> Step 0 of designing Phase 2: pin down **what the files demand** before we design anything.
> Everything below is grounded in verbatim lines (see `/bullders/SOURCE-OF-TRUTH.md`). Nothing invented.

---

## Where Phase 2 lives in the files

- **File 1** calls it the **"open frontier"** — the layer *above* the deterministic spine:
  > "The spine above is deterministic and fast by design. The open frontier is **agent-native**."
  And names the exact piece we're building:
  > **Research & synthesis agent** — "Answer a CEO-level question by retrieving from memory, researching the gaps, and proposing a cited next action." → *"That frontier is the subject of the accompanying build challenge."*
- **File 2** makes it **Steps 4 & 5** of the loop — *"the decision point."*

So Phase 1 (memory) was the spine. **Phase 2 is the frontier the challenge is actually about.**

---

## THE CORE ROLE (one sentence, verbatim)

> "Give the CEO … an agent that **reads their week, builds its own memory, researches what it doesn't know, and hands back a decision they can defend — with the receipts.**"

For Phase 2 specifically (Steps 4–5), the role is:
> "retrieve what's known, **research the gaps with real tools (web/search) and fold findings back as cited facts**, then **synthesize an answer that's explicit about confidence and unknowns — ending in a recommended next action**" → then **log it** (question, facts/sources, confidence, action, gaps, the human's approve/reject).

And the hard rule that frames all of it:
> **"It recommends. It never acts. No autonomous side-effects, ever."**

---

## THE CRITERIA Phase 2 must clear (each grounded; tagged to the rubric / non-negotiables)

| # | Criterion | Verbatim line | Source |
|---|---|---|---|
| 1 | **Model-free reads** — answering must not re-reason the corpus | "answering a question must **not mean re-reasoning the whole corpus each time**." | non-neg #3 + rubric #1 (Architecture, highest weight) |
| 2 | **Decide: memory vs research** — know when it has enough vs must go look | "How does the agent decide **when to answer from memory vs. go research**?" | open design Q |
| 3 | **Research quality** — evaluate findings, fold back as **cited facts** | "it researches, **evaluates** what it finds, and **folds it back as cited facts — not a raw web dump**." | rubric #3 |
| 4 | **Provenance** — every answer cites the exact source | "Every fact and **every answer** cites the exact source it came from." | non-neg #1 + rubric #2 |
| 5 | **Honesty** — confidence + unknowns + contradictions; research before guessing | "states confidence, says what it doesn't know, and **researches before it guesses**." · "would rather say 'I don't know, here's what I'd check' than bluff." | non-neg #2 + rubric #2 |
| 6 | **Human decides** — recommend only, no side-effects | "It recommends. It never acts. **No autonomous side-effects, ever.**" | non-neg #4 |
| 7 | **Every decision logged** — append-only, auditable, full record, loops back | "the question, the facts and sources it leaned on, the confidence, the proposed action, the open gaps, and the human's approve/reject." → "memory → decision → recorded outcome → **back into memory**." | non-neg #5 + rubric #5 |
| 8 | **Agent surface** — operable by an agent over MCP, drives the **whole loop** | "the brain has to be **operable by an agent, not just queryable by a human**." | rubric #6 + Michael |
| 9 | **Read artifacts, don't improvise** — discipline at output | "**Compile and normalise on the way in, and let the agent read artifacts rather than improvise at output. Intelligence over features.**" | Michael (tie-breaker) |
| 10 | **Answer all 3 questions; Q3 deep** | Q1 ICP · Q2 objection · Q3 runway. "Answer the other two solidly but **don't gold plate them; put the depth into Q3**." | File 2 + Michael |

---

## The 5 open design questions we must answer & defend (their words)

1. millisecond queryability *(answered in Phase 1)*
2. connect entities across sources + how much LLM *(answered in Phase 1)*
3. **when to answer from memory vs go research** ← Phase 2
4. **keep answers honest — citations, contradictions, confidence** ← Phase 2
5. **the interface an agent drives it through** ← Phase 2 (MCP)

---

## The 3 questions Phase 2 must answer (verbatim)

- **Q1 — ICP:** "Is our ICP actually mid-market, or are we drifting up?" → surface tweet-vs-update drift, weigh both sides. *(reads the ICP **position**)*
- **Q2 — objection:** "Which objection is killing deals — and is it real?" → budget authority across N calls: quantify, cite, judge vs the evidence bar. *(reads the budget **signal**)*
- **Q3 — runway (HERO):** "What runway can I defend in this week's investor update?" → reconcile 18mo↔9mo, **research the burn math**, recommend a defensible number + caveat, **log the decision**. *(reads the runway **position** + triggers research)*

> ### ★ Michael's explicit Q3 acceptance test (his words — design straight at this)
> > "Contradiction handling, real research, and a logged decision **in one pass** is exactly what I want to see."
>
> So the Q3 walkthrough must show, in a single run:
> 1. **Contradiction handling** — surface + reconcile the 18mo ↔ 9mo runway clash (with both cited).
> 2. **Real research** — a real web/search tool fills the burn-math gap; findings folded back as **cited facts**.
> 3. **A logged decision** — append-only record: question, facts/sources, confidence, recommendation, gaps, human approve/reject.
>
> Plus the line he says he's **watching**: *"let the agent read artifacts rather than improvise at output. Intelligence over features."* → the agent **reads the compiled runway position**; the LLM only synthesizes the final answer over that small set + the fresh research. No corpus re-reading.

---

## What this means for the design (constraints to honor — not yet the design)

- The read path stays **deterministic**: route → retrieve pre-compiled artifacts/signals/positions. **The LLM appears only at the final synthesis seam**, over a *small* retrieved set + fresh research — never the whole corpus.
- **Research is gap-triggered**, not default: a position/answer's open `gaps` decide whether to go to the web.
- Research output is **re-ingested as cited facts** (provenance preserved), not pasted prose.
- The answer object carries **confidence, citations, contradictions surfaced, unknowns**.
- It ends in a **recommendation + a logged, append-only decision** that a human approves/rejects — and the outcome flows back into memory.
- The **MCP server** must let an agent drive the entire loop (ask, get provenance, list contradictions, research, log, approve/reject), not just read.

---

## The agentic layer — what it must HAVE (the parts), straight from Steps 4 & 5

> Steps 1–3 = Phase 1 (done). The **agentic layer = Step 4 ("Answer & research — the decision point") + Step 5 ("Log the decision")**. Breaking those two beats into the required parts:

| # | Part it must have | The verbatim line it comes from |
|---|---|---|
| A | **A question entry point** — takes a CEO question | "Given a CEO question…" |
| B | **Retrieve what's known** — pull the relevant memory (position/signals/facts), fast + model-free | "retrieve what's known" · "answering must not mean re-reasoning the whole corpus" |
| C | **Decide: memory vs research** — detect the gap, choose whether to look | "research **the gaps**" · "How does the agent decide when to answer from memory vs. go research?" |
| D | **A real research tool** — web/search; evaluate; **fold findings back as cited facts** | "research the gaps with **real tools (web/search)** and **fold findings back as cited facts**" (rubric: "not a raw web dump") |
| E | **A synthesizer** — one LLM pass over the *small* retrieved set + research → answer **explicit about confidence + unknowns**, citations, contradictions | "**synthesize an answer that's explicit about confidence and unknowns**" |
| F | **A recommendation** — a proposed next action, recommend-only | "ending in a **recommended next action**" · "it recommends; the human decides. **No autonomous action, ever.**" |
| G | **An append-only decision log** — stores all 6: question · facts+sources · confidence · proposed action · open gaps · human's approve/reject | "the question, the facts and sources it leaned on, the confidence, the proposed action, the open gaps, and the **human's approve / reject**" |
| H | **Human approve/reject + loop-back** — the trigger; outcome re-enters memory | "this closes the loop: **memory → decision → recorded outcome → back into memory**" |
| I | **An agent interface (MCP)** — an agent (not just a script) drives the *whole* loop | "What's the **interface an agent (not just your script) drives it through**?" |

**The shape of one pass (A→H), with the LLM at exactly one seam (E):**
```
question ─▶ B retrieve (algo) ─▶ C gap? ──no──▶ E synthesize ─▶ F recommend ─▶ G log ─▶ H human
                                   └─yes─▶ D research → fold back as cited facts ─┘
```
Everything except **E (synthesize)** is deterministic. Research (D) only fires when C finds a gap. The answer reads the **compiled position** (Michael's "read artifacts, don't improvise").

## DESIGN — to fill in next (after we agree the parts above)

*(the step-by-step agent-loop design goes here once the parts A–I are confirmed)*
