# Connections & the Entity Graph — Design Explainer

> A standalone explanation of **how we connect people, companies, investors, and deals across sources**,
> **why** we do it, whether it's the right call **at this project's level**, and **how the algorithm works**,
> with a full worked example. Written to be reviewed independently.
>
> Source docs referenced:
> - **[File 1] VSI Architecture Overview** (the philosophy)
> - **[File 2] The Build Challenge** (the task + rubric)

---

## 1. What problem this solves (why connections at all)

After extraction, memory is a **pile of isolated facts**. Each fact knows *its own* quote and source, but facts don't know about *each other*. That's not enough, because the CEO's real questions live **across** facts and sources:

- *"Is the **Maya** in this call the same **Maya Chen** in that email?"* → needs **entity resolution.**
- *"Who do we **keep losing to**, and at which accounts?"* → needs **relationships** (who competes with whom, who chose whom).
- *"Which **investor** is asking about which **strategy**?"* → needs people↔companies↔topics linked.

**Both source docs require this explicitly — it is not optional:**

- **[File 2], Step 3 "Connect the dots":** *"Relate the entities and surface what conflicts. The same person across three calls is one person… Output: **structure the agent can traverse, not just a pile of rows**."*
- **[File 2], rubric:** *"Entity resolution is real (one canonical person, not three string-matches). **Relationships and contradictions are first-class**."*
- **[File 2], a design question we must answer:** *"How do you **connect people, companies, investors, deals across sources**?"*
- **[File 2] even lists the connections to surface:** `Maya→founded→Loomwork · Northpeak→invested_in→Loomwork · Jordan→at→Acme Freight · Loomwork↔competes↔FreightPilot`.
- **[File 1]:** *"Cross-entity graph — Deterministically wire people · companies · deals · concepts into a **typed graph the brain can traverse**."*

So the connection layer is a **graded requirement** from both files. The only design freedom is *how* we build it.

---

## 2. Is a "graph" the right tool at THIS level? (honest justification)

**Short answer: yes — because we use the *lightest possible* form of a graph, which is nearly free to include and is required by the brief.**

It's important to separate two things people conflate:

| "Graph" as a **concept** | "Graph" as a **heavy database** |
|---|---|
| entities + typed relationships you can traverse | Neo4j / a dedicated graph engine + its own infra |
| **what the brief asks for** | **overkill at this scale** |
| we store it as **2 small tables + a `JOIN`** | we deliberately do **NOT** use this |

We implement the *concept* in the **lightest** way: a **triple store** — two ordinary SQL tables (`entities`, `edges`) inside the Postgres we already run. At this project's size that is **~13 entities and ~11 edges**. The cost of having it is therefore **near zero**:

- no new database, no new service, no new query language;
- one extra small table (`edges`) and a `JOIN` to traverse it.

**The honest caveat (so a reviewer sees the full picture):** at only ~12 source items, the three demo questions (ICP, objection, runway) are answered mostly from **positions, signals, and contradictions** — they don't *deeply* traverse the graph. So the entity graph is *partly ahead of immediate need* for those three questions specifically.

**Why we include it anyway — and why that's the right call:**
1. It's **explicitly required and graded** ([File 2]: *"relationships… first-class"*, *"connect people, companies, investors, deals"*).
2. It's **almost free** at this scale (two tables + a join — not a graph DB).
3. It's the **foundation the agentic layer stands on** ([File 1] §05 names *"Cross-entity graph"* as the first agent-native frontier). Building it now means the agent has something to traverse later.
4. It is the **standard, production-grade pattern** (see §4), so it scales without redesign.

So: cheap + required + foundational + standard → including it is justified, *and* we're honest that for the 3 demo questions it's not yet heavily exercised.

---

## 3. How it works — the algorithm, step by step (full worked example)

We'll use **three real source items** from Maya's week (abridged):

```
A) email/northpeak-update-may   (from Maya, to Northpeak, about Loomwork)
   "runway ~18 months at current burn. we're moving upmarket…"

B) call/acme-eval               (Jordan Rivera @ Acme Freight)
   "…we can't get budget approved mid-cycle… we also looked at FreightPilot."

C) email/lost-to-freightpilot   (Priya)
   "Halberd Freight went with FreightPilot."
```

### Step 1 — Extraction (the LLM seam) emits entity *mentions* + *relationships*

While the LLM reads each item to extract facts, it **also** lists the entities named and the relationships between them — **for free, in the same pass** (no extra LLM call):

```
from A:  entities  Maya Chen (person), Northpeak (investor), Loomwork (company)
         relations Maya Chen —founded→ Loomwork ;  Northpeak —invested_in→ Loomwork
from B:  entities  Jordan Rivera (person), Acme Freight (company), FreightPilot (competitor)
         relations Jordan Rivera —works_at→ Acme Freight ;  FreightPilot —competes_with→ Loomwork
from C:  entities  Halberd Freight (company), FreightPilot (competitor)
         relations Halberd Freight —chose→ FreightPilot
```

These are just *strings* so far. The next two steps are **pure algorithms — no LLM.**

### Step 2 — Entity resolution (deterministic): collapse names into canonical nodes

Goal: *"one canonical person, not three string-matches."* Two passes:

**Pass 1 — normalize + token-containment.**
- Normalize each name: lowercase, strip punctuation → tokens. (`"Maya Chen"` → `{maya, chen}`; `"Maya"` → `{maya}`.)
- If one name's tokens are a **subset** of another's (same type), they're the same thing → merge, keep the **longest** surface form as canonical, the rest as **aliases**.
  - `{maya} ⊂ {maya, chen}` → **Maya Chen** (alias: *Maya*).
  - `{acme} ⊂ {acme, freight}` → **Acme Freight** (alias: *Acme*).

**Pass 2 — embedding similarity (semantic safety net).**
- Embed each surviving name as `"type: name"` and merge any two **same-type** nodes whose vectors are **very close** (cosine ≥ 0.90 — conservative).
- This catches variants that aren't substrings (paraphrases). The high threshold means *Acme Freight* and *Halberd Freight* (both "…Freight", but clearly different) **do not** merge.

**Result — the `entities` table:**

| id | name | type | aliases |
|---|---|---|---|
| ent_1 | Maya Chen | person | [Maya] |
| ent_2 | Loomwork | company | [] |
| ent_3 | Northpeak | investor | [] |
| ent_4 | Jordan Rivera | person | [] |
| ent_5 | Acme Freight | company | [Acme] |
| ent_6 | FreightPilot | competitor | [] |
| ent_7 | Halberd Freight | company | [] |

> *Why this beats the rubric's "three string-matches" worry:* Pass 1 handles exact/sub-string variants; Pass 2 adds **meaning-based** merging via embeddings. So we resolve by *meaning*, not only by string equality.

### Step 3 — Edge wiring (deterministic): point the relationships at canonical ids

For each relationship `(subject, predicate, object)`:
1. Look up `subject` and `object` in a **name+alias index** of the resolved entities (with a containment fallback).
2. If both resolve to an entity id → store an **edge row**: `{from_id, predicate, to_id, source_id}`.
3. Deduplicate identical edges.

**Result — the `edges` table (entity→entity):**

| id | from_id | predicate | to_id | source_id |
|---|---|---|---|---|
| edge_1 | ent_1 (Maya Chen) | founded | ent_2 (Loomwork) | email/northpeak-update-may |
| edge_2 | ent_3 (Northpeak) | invested_in | ent_2 (Loomwork) | email/northpeak-update-may |
| edge_3 | ent_4 (Jordan Rivera) | works_at | ent_5 (Acme Freight) | call/acme-eval |
| edge_4 | ent_6 (FreightPilot) | competes_with | ent_2 (Loomwork) | call/acme-eval |
| edge_5 | ent_7 (Halberd Freight) | chose | ent_6 (FreightPilot) | email/lost-to-freightpilot |

**A relationship is literally one row: `from_id → predicate → to_id`, and it remembers the `source_id` it came from (provenance).**

### Step 4 — The map this forms

```
   Northpeak ──invested_in──▶ Loomwork ◀──founded── Maya Chen
                                 ▲
                                 │ competes_with
   Jordan Rivera ──works_at──▶ Acme Freight     FreightPilot ◀──chose── Halberd Freight
```

### Step 5 — "Walking" the graph to answer a question (pure SQL, no LLM)

**Question:** *"Who do we keep losing to, and where?"*

```sql
-- 1) who competes with us?
SELECT e.name FROM edges
JOIN entities e ON e.id = edges.from_id
WHERE edges.to_id = 'ent_2' AND edges.predicate = 'competes_with';
-- → FreightPilot  (ent_6)

-- 2) who chose that competitor (a lost deal)?
SELECT e.name, edges.source_id FROM edges
JOIN entities e ON e.id = edges.from_id
WHERE edges.to_id = 'ent_6' AND edges.predicate = 'chose';
-- → Halberd Freight  (cited to email/lost-to-freightpilot)
```

**Answer (assembled deterministically, with citations):** *"FreightPilot — and we lost Halberd Freight to them"* — each hop cites the source item it came from. **No LLM touched the read path.**

---

## 4. Why this design is the clean one (vs the alternatives)

| Approach | Traversable? | Queryable with metadata? | Infra cost | Verdict |
|---|---|---|---|---|
| **No graph (facts only)** | ❌ | — | none | fails the brief ("connect the dots") |
| **Relationships in a JSON blob** | ❌ (can't `JOIN`/filter) | ❌ | none | not first-class; can't traverse |
| **Dedicated graph DB (Neo4j)** | ✅✅ (deep) | separate store | **high** (new service, sync, query lang) | overkill at this scale; breaks "one index" |
| **Triple store in SQL (ours)** | ✅ (1–3 hops via `JOIN`) | ✅ (same store as everything) | **near zero** (2 tables) | ✅ standard, clean, scales, one store |

**Why ours is cleaner:**
- **One store.** Entities/edges sit beside facts, signals, and embeddings — a relationship and a fact are one `JOIN` apart ([File 1]: *"one index every layer reads from"*).
- **Standard pattern.** A triple store (`subject–predicate–object`) is the textbook relational representation of a knowledge graph — exactly what [File 1] describes (*"a stored edge"*, *"a typed graph"*).
- **No new infrastructure.** No graph engine, no second database, no new query language — just rows and `JOIN`s.
- **Provenance built in.** Every edge carries its `source_id`, so a connection clicks back to the item that stated it.
- **Deterministic.** The LLM only *names* the relationships (at the extraction seam, for free); resolving and wiring are pure algorithms ([File 1]: *"Deterministically wire… into a typed graph"*).

---

## 5. What we'd change at larger scale (the honest roadmap)

- **Entity resolution:** add an **LLM canonicalization pass** for genuinely ambiguous merges (e.g. *"NP" → Northpeak*, *"Bob" → Robert*). Right now: normalize + embedding.
- **Deep traversal at huge scale:** if queries need many hops over millions of edges, add **Apache AGE** (a Postgres extension that adds graph/Cypher querying *in the same database*) or move the hot path to a dedicated graph DB. The triple-store schema migrates cleanly to either.
- **Edge confidence:** entity→entity edges could carry a confidence/similarity score too (fact→signal edges already do).

None of these change the schema or the model — they're swaps behind the same interface.

---

## 6. One-paragraph summary (for a reviewer in a hurry)

The brief requires connecting entities across sources into *"structure the agent can traverse"* with *"relationships first-class."* We implement that as a **triple store** — two small SQL tables (`entities`, `edges`) inside the Postgres we already run — which is the standard, production-grade way to put a knowledge graph in a relational DB, at near-zero cost (no graph database). The LLM **names** entities and relationships for free during extraction; **deterministic algorithms** then resolve names into one canonical node each (normalize + token-containment + embedding similarity) and wire the relationships into edge rows with provenance. Traversal is a plain SQL `JOIN`, model-free. At this scale (~13 entities, ~11 edges) it's cheap and partly ahead of immediate need for the three demo questions, but it's required by the rubric and is the foundation the agentic layer traverses — and it scales to millions of edges, or to Apache AGE / a graph DB, without changing the schema.
