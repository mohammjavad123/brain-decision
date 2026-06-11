import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { route, expandNeighbors, type Retrieved } from "./route.js";
import { refineQuery } from "./refine.js";
import { assessSufficiency, type Need } from "./assess.js";
import { synthesize } from "./synthesize.js";
import { researchGap } from "./research.js";
import { researchAvailable } from "../research/tavily.js";
import { getFacts, insertDecision } from "../db/queries.js";
import { newId, nowIso } from "../util.js";
import type { Decision, Citation, Fact, SynthesizedAnswer } from "../schema/index.js";

/**
 * The agent loop, as an explicit LangGraph StateGraph (we define every node + edge — no ReAct blob).
 *
 *   START → refine → retrieve → assess ─┬─ answer ─────────────▶ synthesize → verify ─┬─ grounded → log → END
 *                                       ├─ deeper_memory ─▶ deepen ─┐ (loops to assess)│
 *                                       └─ research_web ──▶ research ┘                 └─ ungrounded → assess
 *
 * `assess` is the single decision node (the loop hub): every pass it picks answer / deepen / research,
 * and even a failed `verify` routes back to it. It's a BOUNDED adaptive loop — `assess` *can* deepen or
 * research repeatedly — but on a small corpus the graph neighbourhood is usually pulled in ONE hop, so in
 * practice it runs retrieve → assess → (maybe one deepen/research) → synthesize. Convergence (a hop adds
 * nothing new) + budget caps bound it. retrieve/deepen/verify are deterministic; research is the one
 * external tool; synthesize is the seam. Logs a PENDING decision.
 */
const MAX_RESEARCH_ROUNDS = 1; // one web attempt — don't burn repeated searches on a gap the web can't fill
const MAX_DEPTH = 3; // budget cap on graph-deepening hops (the agent + convergence usually stop sooner)
const MAX_VERIFY_RETRIES = 1;

type Conf = "low" | "medium" | "high";
const downgrade = (c: Conf): Conf => (c === "high" ? "medium" : "low");

const S = Annotation.Root({
  question: Annotation<string>(),
  refinedQuery: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  inScope: Annotation<boolean>({ reducer: (_, b) => b, default: () => true }),
  retrieved: Annotation<Retrieved | null>({ reducer: (_, b) => b, default: () => null }),
  gaps: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  need: Annotation<Need>({ reducer: (_, b) => b, default: () => "answer" }),
  assessReasoning: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  depth: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  memoryExhausted: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  iterations: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  researchFacts: Annotation<Fact[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  synthesized: Annotation<SynthesizedAnswer | null>({ reducer: (_, b) => b, default: () => null }),
  groundingFeedback: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  verifyRetries: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  needsRetry: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  decision: Annotation<Decision | null>({ reducer: (_, b) => b, default: () => null }),
});
type State = typeof S.State;

// refine — the root agent's intake: judge scope, then rewrite the question into a retrieval query (B)
async function refineNode(state: State): Promise<Partial<State>> {
  const r = await refineQuery(state.question);
  return { refinedQuery: r.query, inScope: r.in_scope };
}

// the root agent recognizes an out-of-scope question and declines instead of running the whole pipeline
function routeAfterRefine(state: State): "retrieve" | "decline" {
  return state.inScope ? "retrieve" : "decline";
}

async function declineNode(state: State): Promise<Partial<State>> {
  const decision: Decision = {
    id: newId("dec"),
    question: state.question,
    answer:
      "That's outside what I track. I'm a decision brain for your company's week — ask me about ICP, runway, " +
      "deals, objections, competitors, the team, or fundraising.",
    confidence: "low",
    evidence: [],
    reasoning: [],
    contradiction_ids: [],
    research_fact_ids: [],
    gaps: [],
    recommendation: "Ask about the company's strategy, finances, pipeline, or competitors.",
    status: "pending",
    human_note: null,
    created_at: nowIso(),
    resolved_at: null,
  };
  return { decision }; // not logged — a decline isn't a recommendation
}

// retrieve — DETERMINISTIC: vector anchors + dimension-complete + light graph expansion (no LLM)
async function retrieveNode(state: State): Promise<Partial<State>> {
  const r = await route(state.question, state.refinedQuery || undefined);
  return { retrieved: r, gaps: r.gaps };
}

// deepen — one more hop of graph-neighbor expansion from the matched facts (adaptive depth)
async function deepenNode(state: State): Promise<Partial<State>> {
  const before = state.retrieved!.facts.length;
  const r = await expandNeighbors(state.retrieved!);
  const grew = r.facts.length > before;
  return { retrieved: r, gaps: r.gaps, depth: state.depth + 1, memoryExhausted: !grew };
}

// assess — the single decision node: answer · deeper_memory · research_web (C)
async function assessNode(state: State): Promise<Partial<State>> {
  const a = await assessSufficiency(state.question, state.retrieved!, state.researchFacts, state.groundingFeedback);
  return { need: a.need, gaps: a.gaps, assessReasoning: a.reasoning };
}

function routeAfterAssess(state: State): "deepen" | "research" | "synthesize" {
  if (state.need === "deeper_memory" && state.depth < MAX_DEPTH && !state.memoryExhausted) return "deepen";
  if (state.need === "research_web" && state.gaps.length > 0 && researchAvailable() && state.iterations < MAX_RESEARCH_ROUNDS)
    return "research";
  return "synthesize";
}

// research — fill the gap with the web tool; fold findings back as cited facts; loop to assess
async function researchNode(state: State): Promise<Partial<State>> {
  const r = state.retrieved!;
  const dim = r.position?.name === "runway" ? "runway" : r.position ? "icp" : null;
  const facts: Fact[] = [];
  for (const gap of state.gaps.slice(0, 2)) {
    const out = await researchGap(gap, dim);
    facts.push(...out.facts);
  }
  return { researchFacts: facts, gaps: [], iterations: state.iterations + 1 };
}

/**
 * Pure + testable. What to tell `synthesize` about research. The key case (BUG-2): `assess` chose
 * research_web but it was DROPPED (no key / no web-answerable gap / round cap) or returned nothing —
 * then `researchFacts` is empty and we must tell synthesize to treat it as an UNRESEARCHED gap, so it
 * never answers as if it had researched.
 */
export function researchNote(opts: { need: Need; researchFactsLen: number; hasGaps: boolean; available: boolean }): string {
  if (opts.need === "research_web" && opts.researchFactsLen === 0) {
    return opts.available
      ? "external research was attempted for a gap but returned nothing usable — treat it as an UNRESEARCHED gap; do NOT answer as if you researched it"
      : "web research is unavailable (no TAVILY_API_KEY) — treat any external gap as UNRESEARCHED; do NOT answer as if you researched it";
  }
  if (!opts.available && opts.hasGaps) return "web research unavailable (TAVILY_API_KEY not set)";
  return "";
}

// synthesize — the seam: cited answer + confidence + recommendation + structured reasoning
async function synthesizeNode(state: State): Promise<Partial<State>> {
  const r = state.retrieved!;
  const note = researchNote({
    need: state.need,
    researchFactsLen: state.researchFacts.length,
    hasGaps: r.gaps.length > 0,
    available: researchAvailable(),
  });
  const syn = await synthesize(state.question, r, state.researchFacts, note, state.groundingFeedback);
  return { synthesized: syn };
}

/**
 * Pure + testable. Keep only reasoning points whose every cited fact resolves, and cite ONLY the ids
 * that back those kept points. NO fallback to "all retrieved facts" — an ungrounded answer must ship
 * with NO citations rather than launder the whole retrieval set as if it backed the claims.
 */
export function groundReasoning(
  reasoning: { point: string; fact_ids: string[] }[],
  knownIds: Set<string>,
): { reasoning: { point: string; fact_ids: string[] }[]; usedIds: string[] } {
  const grounded = (c: { fact_ids: string[] }) => c.fact_ids.length > 0 && c.fact_ids.every((id) => knownIds.has(id));
  const kept = reasoning.filter(grounded).map((c) => ({ point: c.point, fact_ids: c.fact_ids }));
  const usedIds = [...new Set(kept.flatMap((c) => c.fact_ids))];
  return { reasoning: kept, usedIds };
}

// verify_grounding — DETERMINISTIC: every claim must cite fact ids that resolve to real facts
async function verifyNode(state: State): Promise<Partial<State>> {
  const syn = state.synthesized!;
  const r = state.retrieved!;
  const known = new Set((await getFacts([...new Set(syn.reasoning.flatMap((c) => c.fact_ids))])).map((f) => f.id));
  const grounded = (c: { fact_ids: string[] }) => c.fact_ids.length > 0 && c.fact_ids.every((id) => known.has(id));
  const unsupported = syn.reasoning.filter((c) => !grounded(c));

  // an ungrounded reasoning point → the agent is under-evidenced → loop back to `assess` to deepen/research
  if (unsupported.length > 0 && state.verifyRetries < MAX_VERIFY_RETRIES) {
    return {
      needsRetry: true,
      verifyRetries: state.verifyRetries + 1,
      groundingFeedback: `A prior answer made points it couldn't cite: "${unsupported.map((c) => c.point).join('" | "')}". Find support or drop them.`,
    };
  }

  const ok = unsupported.length === 0;
  // cite ONLY the facts that back grounded reasoning — no laundering. If nothing grounds, evidence is [].
  const { reasoning, usedIds } = groundReasoning(syn.reasoning, known);
  const cited = await getFacts(usedIds);
  const evidence: Citation[] = cited.map((f) => ({ fact_id: f.id, quote: f.quote, source_id: f.source_id, speaker: f.speaker }));

  // compose a readable brief for the log / CLI / MCP / eval (the UI renders the structured fields)
  const answer =
    syn.bottom_line + (reasoning.length ? "\n\nWhy:\n" + reasoning.map((c, i) => `${i + 1}. ${c.point}`).join("\n") : "");

  const decision: Decision = {
    id: newId("dec"),
    question: state.question,
    answer,
    confidence: ok ? syn.confidence : downgrade(syn.confidence as Conf),
    evidence,
    reasoning,
    contradiction_ids: r.contradictions.map((c) => c.id),
    research_fact_ids: state.researchFacts.map((f) => f.id),
    gaps: syn.gaps,
    recommendation: syn.recommendation,
    status: "pending",
    human_note: null,
    created_at: nowIso(),
    resolved_at: null,
  };
  return { needsRetry: false, decision };
}

function routeAfterVerify(state: State): "assess" | "log" {
  return state.needsRetry ? "assess" : "log";
}

async function logNode(state: State): Promise<Partial<State>> {
  await insertDecision(state.decision!);
  return {};
}

const graph = new StateGraph(S)
  .addNode("refine", refineNode)
  .addNode("decline", declineNode)
  .addNode("retrieve", retrieveNode)
  .addNode("deepen", deepenNode)
  .addNode("assess", assessNode)
  .addNode("research", researchNode)
  .addNode("synthesize", synthesizeNode)
  .addNode("verify", verifyNode)
  .addNode("log", logNode)
  .addEdge(START, "refine")
  .addConditionalEdges("refine", routeAfterRefine, { retrieve: "retrieve", decline: "decline" })
  .addEdge("decline", END)
  .addEdge("retrieve", "assess")
  .addConditionalEdges("assess", routeAfterAssess, { deepen: "deepen", research: "research", synthesize: "synthesize" })
  .addEdge("deepen", "assess")
  .addEdge("research", "assess")
  .addEdge("synthesize", "verify")
  .addConditionalEdges("verify", routeAfterVerify, { assess: "assess", log: "log" })
  .addEdge("log", END)
  .compile();

export type AnswerResult = { decision: Decision; retrieved: Retrieved; researched: Fact[] };

export async function runAgent(question: string, opts: { log?: (m: string) => void } = {}): Promise<AnswerResult> {
  const log = opts.log ?? (() => {});
  const final = await graph.invoke({ question });
  log(`• decision ${final.decision?.id} (pending) · researched ${final.researchFacts.length} fact(s)`);
  return { decision: final.decision!, retrieved: final.retrieved!, researched: final.researchFacts };
}

// ── streaming for the live UI (emit the node actually running, with process detail) ──
export type AgentEvent = { node: string; phase: "active" | "done"; label: string; detail: string[]; decision: Decision | null };

function activeLabel(node: string): string {
  return (
    {
      refine: "reading the question · is it in scope?…",
      decline: "out of scope — declining politely…",
      retrieve: "reading compiled memory (vector + graph)…",
      deepen: "expanding the memory graph one hop…",
      assess: "deciding — answer, dig deeper, or research?…",
      research: "searching the web · folding findings back as cited facts…",
      synthesize: "writing the cited answer…",
      verify: "checking every claim is grounded…",
      log: "writing the pending decision…",
    }[node] ?? "working…"
  );
}

function doneLabel(node: string, u: Partial<State>): string {
  switch (node) {
    case "refine": return u.inScope === false ? "out of scope" : `in scope · query → "${u.refinedQuery ?? ""}"`;
    case "decline": return "declined — not in this brain's memory";
    case "retrieve": return `read memory → ${u.retrieved?.position?.name ?? "no position"} · ${u.retrieved?.facts?.length ?? 0} facts`;
    case "deepen": return `expanded graph (hop ${u.depth ?? "?"}) → ${u.retrieved?.facts?.length ?? 0} facts${u.memoryExhausted ? " · neighborhood exhausted" : ""}`;
    case "assess": return u.need === "answer" ? "enough to answer" : u.need === "deeper_memory" ? "dig deeper in memory" : "research the web";
    case "research": return `folded ${(u.researchFacts ?? []).length} web fact(s)`;
    case "synthesize": return `drafted answer (confidence: ${u.synthesized?.confidence ?? "?"})`;
    case "verify": return u.needsRetry ? "ungrounded — looping back to dig" : "every claim grounded ✓";
    case "log": return "pending decision written";
    default: return node;
  }
}

function detailFor(node: string, u: Partial<State>): string[] {
  const d: string[] = [];
  if (node === "refine" && u.refinedQuery) d.push(u.refinedQuery);
  else if ((node === "retrieve" || node === "deepen") && u.retrieved) {
    const r = u.retrieved;
    d.push(`position: ${r.position?.name ?? "none"}${r.position ? ` (confidence ${r.position.confidence})` : ""}`);
    if (r.signals.length) d.push(`signals: ${r.signals.map((s) => s.label).slice(0, 3).join(" · ")}`);
    d.push(`${r.facts.length} fact(s)${r.contradictions.length ? ` · ${r.contradictions.length} contradiction(s)` : ""}`);
  } else if (node === "assess") {
    if (u.assessReasoning) d.push(u.assessReasoning);
    if (u.gaps?.length) d.push(...u.gaps.map((g) => `↳ ${g}`));
  } else if (node === "research") {
    d.push(...(u.researchFacts ?? []).map((f) => `+ ${f.value} (${f.source_id})`));
  } else if (node === "synthesize" && u.synthesized) {
    d.push(`${u.synthesized.reasoning?.length ?? 0} cited reason(s)`);
  } else if (node === "log" && u.decision) {
    d.push(`decision ${u.decision.id} · ${u.decision.evidence.length} citation(s)`);
  }
  return d;
}

function predictNext(node: string, u: Partial<State>, st: { rounds: number; depth: number; exhausted: boolean }): string | null {
  switch (node) {
    case "refine": return u.inScope === false ? "decline" : "retrieve";
    case "decline": return null;
    case "retrieve":
    case "deepen": return "assess";
    case "assess":
      if (u.need === "deeper_memory" && st.depth < MAX_DEPTH && !st.exhausted) return "deepen";
      if (u.need === "research_web" && (u.gaps?.length ?? 0) > 0 && researchAvailable() && st.rounds < MAX_RESEARCH_ROUNDS) return "research";
      return "synthesize";
    case "synthesize": return "verify";
    case "verify": return u.needsRetry ? "assess" : "log";
    default: return null;
  }
}

export async function* streamAgent(question: string): AsyncGenerator<AgentEvent> {
  yield { node: "refine", phase: "active", label: activeLabel("refine"), detail: [], decision: null };
  const st = { rounds: 0, depth: 0, exhausted: false };
  const stream = await graph.stream({ question }, { streamMode: "updates" });
  for await (const chunk of stream) {
    for (const [node, raw] of Object.entries(chunk)) {
      const u = (raw ?? {}) as Partial<State>;
      if (node === "research") st.rounds++;
      if (node === "deepen") {
        st.depth = u.depth ?? st.depth + 1;
        st.exhausted = !!u.memoryExhausted;
      }
      yield { node, phase: "done", label: doneLabel(node, u), detail: detailFor(node, u), decision: u.decision ?? null };
      const next = predictNext(node, u, st);
      if (next) yield { node: next, phase: "active", label: activeLabel(next), detail: [], decision: null };
    }
  }
}
