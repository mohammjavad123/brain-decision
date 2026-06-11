import { embedOne } from "../llm/embed.js";
import {
  similarPositions,
  similarSignals,
  similarFacts,
  getFacts,
  currentFacts,
  currentSignals,
  currentContradictions,
  factsByDimension,
  allEntities,
  allEdges,
} from "../db/queries.js";
import type { Position, Signal, Fact, Contradiction } from "../schema/index.js";

/**
 * Route a question to the relevant compiled memory — DETERMINISTIC (no LLM). Three ingredients:
 *  1. keyword/type HINTS so known positions + signal-types route reliably,
 *  2. pgvector ANN to find the best anchors (+ dimension-complete: a position pulls ALL its dimension's facts),
 *  3. a 1-hop GRAPH EXPANSION from the anchors along the typed edges — staying on-topic instead of
 *     drifting by loosening the similarity threshold.
 * `expandNeighbors` (used by the agent's `deepen` step) walks further out along the graph from the
 * already-matched facts. Always returns *some* cited evidence; the LLM seam judges relevance.
 */
export type Retrieved = {
  position: Position | null;
  signals: Signal[];
  facts: Fact[];
  contradictions: Contradiction[];
  gaps: string[];
};

const POSITION_HINTS: Record<string, string[]> = {
  ICP: ["icp", "mid-market", "midmarket", "upmarket", "enterprise", "segment", "drift", "self-serve", "customer"],
  runway: ["runway", "burn", "cash", "raise", "fundrais", "investor update", "months left"],
};

const SIGNAL_HINTS: { type: string; kw: string[] }[] = [
  { type: "objection", kw: ["objection", "blocker", "blocking", "killing", "kills", "stall", "stuck", "pushback", "push back", "deal"] },
  { type: "competitor", kw: ["competitor", "compete", "losing to", "lose to", "rival", "alternative", "freightpilot"] },
  { type: "pain_point", kw: ["pain", "problem", "frustrat", "struggle", "complaint"] },
];

const MAX_FACTS = 30;

export async function route(question: string, embedText?: string): Promise<Retrieved> {
  const qv = await embedOne(embedText ?? question);
  // match keyword hints against the ORIGINAL question AND the refined query — so refinement helps the
  // keyword-routing too (a hint word the founder didn't use but the refine step surfaced still routes).
  const ql = `${question} ${embedText ?? ""}`.toLowerCase();
  const SIM = 0.95;

  // POSITION — keyword hint first, else a confident vector match
  const posHits = await similarPositions(qv, 5);
  let position: Position | null = null;
  const hinted = posHits.find((h) => (POSITION_HINTS[h.position.name] ?? []).some((k) => ql.includes(k)));
  if (hinted) position = hinted.position;
  else if (posHits[0] && posHits[0].distance < 0.65) position = posHits[0].position;

  // SIGNALS — type hint (objection/competitor question → those signals) + vector
  const sigById = new Map<string, Signal>();
  const hintType = SIGNAL_HINTS.find((h) => h.kw.some((k) => ql.includes(k)))?.type;
  if (hintType) for (const s of (await currentSignals()).filter((s) => s.type === hintType).slice(0, 3)) sigById.set(s.id, s);
  for (const h of await similarSignals(qv, 8)) if (h.distance < SIM) sigById.set(h.signal.id, h.signal);
  const signals = [...sigById.values()].slice(0, 5);

  // ANCHOR FACTS — position (dimension-complete) + signals + most-similar facts
  const ids = new Set<string>();
  if (position) {
    for (const fld of position.fields) for (const id of fld.fact_ids) ids.add(id);
    // dimension-complete: a position question sees EVERY fact on its dimension (runway always sees the burn fact)
    for (const f of await factsByDimension(position.name.toLowerCase())) ids.add(f.id);
  }
  for (const s of signals) for (const id of s.fact_ids) ids.add(id);
  for (const h of await similarFacts(qv, 10)) if (h.distance < SIM) ids.add(h.fact.id);
  let facts = await getFacts([...ids]);

  // light 1-hop expansion: contradiction partners (the other side of any conflict an anchor is in)
  const allContra = await currentContradictions();
  const have = new Set(facts.map((f) => f.id));
  const add = new Set<string>();
  for (const c of allContra) {
    if (have.has(c.fact_a) && !have.has(c.fact_b)) add.add(c.fact_b);
    if (have.has(c.fact_b) && !have.has(c.fact_a)) add.add(c.fact_a);
  }
  if (add.size) facts = [...facts, ...(await getFacts([...add]))];
  facts = facts.slice(0, MAX_FACTS);

  const fset = new Set(facts.map((f) => f.id));
  const contradictions = allContra.filter((c) => fset.has(c.fact_a) || fset.has(c.fact_b));
  return { position, signals, facts, contradictions, gaps: position?.gaps ?? [] };
}

/**
 * `deepen` — graph-neighbor expansion from the already-matched facts (NOT a looser vector search, so
 * no drift). Walks: signal-cluster siblings · same-speaker facts · related-entity facts (1 hop on the
 * entity graph) · contradiction partners. Bounded by MAX_FACTS.
 */
export async function expandNeighbors(prior: Retrieved): Promise<Retrieved> {
  const facts = [...prior.facts];
  const have = new Set(facts.map((f) => f.id));
  const add = new Set<string>();

  const [sigs, contras, allF, ents, edges] = await Promise.all([
    currentSignals(),
    currentContradictions(),
    currentFacts(),
    allEntities(),
    allEdges(),
  ]);

  // (1) signal-cluster siblings — any signal touching an anchor fact contributes ALL its members
  const touched = sigs.filter((s) => s.fact_ids.some((id) => have.has(id)));
  for (const s of touched) for (const id of s.fact_ids) if (!have.has(id)) add.add(id);

  // (2) contradiction partners
  for (const c of contras) {
    if (have.has(c.fact_a)) add.add(c.fact_b);
    if (have.has(c.fact_b)) add.add(c.fact_a);
  }

  // (3) same-speaker + (4) related-entity facts (1 hop on the entity relationship edges)
  const speakers = new Set(facts.map((f) => (f.speaker ?? "").toLowerCase()).filter(Boolean));
  const nameToId = new Map<string, string>();
  for (const e of ents) {
    nameToId.set(e.name.toLowerCase(), e.id);
    for (const a of e.aliases ?? []) nameToId.set(a.toLowerCase(), e.id);
  }
  const idToName = new Map(ents.map((e) => [e.id, e.name.toLowerCase()]));
  const anchorEntIds = new Set([...speakers].map((s) => nameToId.get(s)).filter(Boolean) as string[]);
  const related = new Set<string>();
  for (const e of edges) {
    if (anchorEntIds.has(e.from_id)) related.add(idToName.get(e.to_id) ?? "");
    if (anchorEntIds.has(e.to_id)) related.add(idToName.get(e.from_id) ?? "");
  }
  for (const f of allF) {
    const sp = (f.speaker ?? "").toLowerCase();
    if (!have.has(f.id) && !add.has(f.id) && (speakers.has(sp) || related.has(sp))) add.add(f.id);
  }

  const expanded = [...facts, ...(await getFacts([...add].filter((id) => !have.has(id))))].slice(0, MAX_FACTS);
  const fset = new Set(expanded.map((f) => f.id));
  return {
    position: prior.position,
    signals: [...new Set([...prior.signals, ...touched])].slice(0, 8),
    facts: expanded,
    contradictions: contras.filter((c) => fset.has(c.fact_a) || fset.has(c.fact_b)),
    gaps: prior.gaps,
  };
}
