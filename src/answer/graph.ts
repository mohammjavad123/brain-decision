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
 * and even a failed `verify` routes back to it. DEPTH is adaptive — `assess` chooses to deepen again
 * each pass; convergence (a hop adds nothing new) + a budget cap just bound it. retrieve/deepen/verify
 * are deterministic; research is the one external tool; synthesize is the seam. Logs a PENDING decision.
 */
const MAX_RESEARCH_ROUNDS = 2;
const MAX_DEPTH = 3; // budget cap on graph-deepening hops (the agent + convergence usually stop sooner)
const MAX_VERIFY_RETRIES = 1;

type Conf = "low" | "medium" | "high";
const downgrade = (c: Conf): Conf => (c === "high" ? "medium" : "low");

const S = Annotation.Root({
  question: Annotation<string>(),
  refinedQuery: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
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

// refine — LLM rewrites the question into a better retrieval query (B)
async function refineNode(state: State): Promise<Partial<State>> {
  const r = await refineQuery(state.question);
  return { refinedQuery: r.query };
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

// synthesize — the seam: cited answer + confidence + recommendation + structured claims
async function synthesizeNode(state: State): Promise<Partial<State>> {
  const r = state.retrieved!;
  const note = !researchAvailable() && r.gaps.length ? "web research unavailable (TAVILY_API_KEY not set)" : "";
  const syn = await synthesize(state.question, r, state.researchFacts, note, state.groundingFeedback);
  return { synthesized: syn };
}

// verify_grounding — DETERMINISTIC: every claim must cite fact ids that resolve to real facts
async function verifyNode(state: State): Promise<Partial<State>> {
  const syn = state.synthesized!;
  const r = state.retrieved!;
  const known = new Set((await getFacts([...new Set(syn.claims.flatMap((c) => c.fact_ids))])).map((f) => f.id));
  const grounded = (c: { fact_ids: string[] }) => c.fact_ids.length > 0 && c.fact_ids.every((id) => known.has(id));
  const unsupported = syn.claims.filter((c) => !grounded(c));

  // ungrounded claim → the agent is under-evidenced → loop back to `assess` to deepen/research
  if (unsupported.length > 0 && state.verifyRetries < MAX_VERIFY_RETRIES) {
    return {
      needsRetry: true,
      verifyRetries: state.verifyRetries + 1,
      groundingFeedback: `A prior answer made claims it couldn't cite: "${unsupported.map((c) => c.claim).join('" | "')}". Find support or drop them.`,
    };
  }

  const ok = unsupported.length === 0;
  const usedIds = [...new Set(syn.claims.filter(grounded).flatMap((c) => c.fact_ids))];
  const fallbackIds = usedIds.length ? usedIds : [...r.facts, ...state.researchFacts].map((f) => f.id);
  const cited = await getFacts(fallbackIds);
  const evidence: Citation[] = cited.map((f) => ({ fact_id: f.id, quote: f.quote, source_id: f.source_id, speaker: f.speaker }));

  const decision: Decision = {
    id: newId("dec"),
    question: state.question,
    answer: syn.answer,
    confidence: ok ? syn.confidence : downgrade(syn.confidence as Conf),
    evidence,
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
  .addNode("retrieve", retrieveNode)
  .addNode("deepen", deepenNode)
  .addNode("assess", assessNode)
  .addNode("research", researchNode)
  .addNode("synthesize", synthesizeNode)
  .addNode("verify", verifyNode)
  .addNode("log", logNode)
  .addEdge(START, "refine")
  .addEdge("refine", "retrieve")
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
      refine: "refining the query for search…",
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
    case "refine": return `query → "${u.refinedQuery ?? ""}"`;
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
    d.push(`${u.synthesized.claims?.length ?? 0} cited claim(s)`);
  } else if (node === "log" && u.decision) {
    d.push(`decision ${u.decision.id} · ${u.decision.evidence.length} citation(s)`);
  }
  return d;
}

function predictNext(node: string, u: Partial<State>, st: { rounds: number; depth: number; exhausted: boolean }): string | null {
  switch (node) {
    case "refine": return "retrieve";
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
