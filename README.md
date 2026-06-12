# Decision Brain

Reads a founder's week (calls, emails, notes, a tweet, Slack), builds a **cited, contradiction-aware memory**, and answers a CEO's hard questions with a **defensible recommendation + receipts** that a human approves or rejects.

*This README is the **flow** — what's here and how it moves.*

---

## Run it — one command

**Prerequisites:** Node **18+** and a **Gemini API key** (free from [Google AI Studio](https://aistudio.google.com/apikey)). No Docker, no DB to install.

```bash
git clone https://github.com/mohammjavad123/brain-decision && cd brain-decision
npm install
cp .env.example .env            # paste your GEMINI_API_KEY into .env
npm start                       # the one command
```

Open **http://localhost:8787**. `npm start` builds the UI, **serves UI + API on one port**, and **builds the brain on first run** (~2–3 min; later starts are instant).

| `.env` | |
|---|---|
| `GEMINI_API_KEY` | **required** |
| `TAVILY_API_KEY` | optional — web research (degrades honestly without it) |
| `EMBEDDING_PROVIDER` | optional — defaults to a free, local 768-dim model |

*In the UI:* **Ask the brain** (watch the agent think) · **Build memory** → *load corpus → Ingest* (watch raw text become memory live).
*Troubleshooting:* port busy → `lsof -ti:8787 | xargs kill`; fresh start → delete `.data/`.

---

## Phase 1 — the memory (write-time)

```
raw item ─[extract: LLM]→ typed facts ─[verify quote · embed]→ stored
         ─[resolve entities · wire graph · detect contradictions]→ graph
         ─[cluster · promote]→ signals ─[compose: LLM]→ positions
```

**How a fact is made:** the LLM reads one item and emits *typed atoms* — `value` (normalized), the **verbatim quote**, `speaker`, `dimension` (runway / icp / budget…), `qualifier`, a canonical `comparable`, `evidence_tier` (E1–E5). The quote is **verified against the source** (or rejected), an **embedding** is computed, and it's stored in one Postgres row.

**Store:** one **Postgres + pgvector** database (relational + vectors in the same row). Local = PGlite (in-process, zero setup). **Bi-temporal & append-only** — every record has `valid_time`, `learned_time`, `superseded_at`; nothing is overwritten.

**The tables — 8 compiled, + 2 raw extraction tables:**

| table | holds |
|---|---|
| `sources` | raw items (id = hash of body) |
| `facts` | typed atoms: value · verbatim quote + offsets · tier · dimension · qualifier · comparable · embedding |
| `mentions` | raw entity mentions per source (before resolution) |
| `relationships` | raw subject–predicate→object per source (before wiring) |
| `entities` | one canonical person / company / investor / competitor (+ aliases) |
| `edges` | typed graph: `subject –predicate→ object`, plus scored `fact →member_of→ signal` |
| `signals` | a claim aggregated across calls: count · companies · promotion tier |
| `contradictions` | conflicts as rows: direct / conditional / drift |
| `positions` | compiled stance (ICP, runway) + per-field citations + gaps |
| `decisions` | append-only log: question · answer · confidence · evidence · recommendation · human verdict |

## pgvector / similarity — used in 3 places

Embeddings turn meaning into a vector; pgvector measures distance (`<=>`). That distance — **no LLM** — is used in three places (the user query is only the third):

**1 · Cluster facts → signals (write-time).** Facts whose vectors are close mean the same thing:
```
"can't get budget approved"  ┐
"the VP holds the budget"    ├─ close vectors ─▶  one signal "budget authority" · count 9 · 6 companies
"sign-off above the pilot"   ┘
```
**2 · Resolve entities (write-time).** *Maya* / *Maya Chen* → one node, merged by similarity.
**3 · Route the question (read-time).** Embed the CEO's question → fetch the closest facts + positions.

---

## Phase 2 — the agent loop (read-time)

An explicit state machine (LangGraph). **`assess` is the hub** every path returns to.

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

| node | does |
|---|---|
| **refine** *(LLM)* | rewrite the question into the founder's vocabulary |
| **retrieve** *(algorithm)* | pgvector routing + dimension-complete fetch + contradiction partners |
| **assess** *(LLM · hub)* | enough evidence? → **answer** / **deeper_memory** / **research_web** |
| **deepen** *(algorithm)* | walk the graph out from matched facts → back to assess |
| **research** *(LLM + web)* | search, fold findings back as cited facts → back to assess |
| **synthesize** *(LLM)* | reconcile contradictions, flag stale/unknown, cite every claim, one action |
| **verify** *(algorithm)* | every cited fact must resolve to a real fact, else loop back |
| **log** | write the decision to the append-only log, pending the human verdict |

It's a **bounded** adaptive loop: `assess` *can* deepen or research repeatedly, but on a small corpus the neighbourhood is usually pulled in one hop — so in practice it runs **retrieve → assess → (maybe one deepen/research) → synthesize**. Bounded by convergence + depth/round caps. **No autonomous side-effects.**

**Closing the loop (Step 5).** When the human **approves or rejects** a recommendation, the verdict is recorded **and** the outcome is folded **back into memory** — appended as a **decision-grade (E5) fact** whose source is the decision itself. It's deterministic (no LLM, just one embedding), so the next related question retrieves it via the same similarity + dimension paths. *memory → decision → recorded outcome → back into memory.*

---

## Agent surface — MCP (FastMCP, over stdio)

The brain is **operable by an agent, not just this UI.** It exposes a [**FastMCP**](https://github.com/punkpeye/fastmcp) server on **stdio**, so any MCP client (Claude Desktop, Claude Code, or any agent) can spawn it and drive the whole brain. (`npm install` already pulls in FastMCP — no extra step.)

```bash
npm run mcp        # start the FastMCP server (stdio)
```

**Three tools — one per verb of the design: decide · verify · close the loop.** The surface exposes the
*agent*, not its internals: `query_brain` **is** the root agent — a single call retrieves from memory and, when
the gap warrants it, **autonomously deepens the memory graph and/or runs real web search inside that one call**.
Those two internal steps are never separate tools — the graph decides when to take them, not the caller.

| tool | does |
|---|---|
| `query_brain` | runs the **full agent** on a CEO question (retrieve → deepen / research as needed, internally) → cited recommendation + logs a pending decision |
| `get_provenance` | the receipts — walk any cited fact id → its verbatim source quote · speaker · location |
| `resolve_decision` | record the human verdict **and fold the outcome back into memory** so future queries retrieve it |

**Use it from Claude Desktop / Code** — add to `claude_desktop_config.json`:
```json
{ "mcpServers": { "decision-brain": { "command": "npm", "args": ["run", "mcp"], "cwd": "/absolute/path/to/brain-decision" } } }
```

**Try it interactively** with the MCP Inspector — the easiest way (it attaches a client, so the 3 tools are clickable in a browser UI):
```bash
npx @modelcontextprotocol/inspector npm run mcp
```
*(Running `npm run mcp` on its own just waits on stdio for a client to connect — a “could not infer client capabilities” notice there is expected, not an error.)*

> ⚠ The local store (PGlite) is **single-process** — run **either** the web UI (`npm start`) **or** the MCP server, never both at once (they share `.data/`).

`npm run eval` scores the agent on the 3 CEO questions against ground truth.
