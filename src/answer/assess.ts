import { structured } from "../llm/structured.js";
import { Assessment } from "../schema/index.js";
import type { Fact } from "../schema/index.js";
import type { Retrieved } from "./route.js";
import { config } from "../config.js";

/**
 * The `assess` node — the agent's decision (C): given the question + retrieved evidence, choose the
 * next step — `answer`, `deeper_memory` (the info is likely in memory, expand the graph), or
 * `research_web` (needs external/public info). The LLM judges over the SMALL retrieved set, never the
 * corpus; private/internal unknowns are never sent to research.
 */
const SYSTEM = `You are the assess step of a decision brain. Given the CEO question and what was retrieved
from company memory (plus any web research already folded in), pick the NEXT step:

- "answer"        — the evidence is enough to answer well.
- "deeper_memory" — thin, but the missing piece is likely already in memory and just wasn't pulled;
                    expand along the memory graph.
- "research_web"  — the gap needs EXTERNAL / public info (benchmarks, market norms, how others do it);
                    list the specific web-answerable gaps.

Only research GENERIC external facts (market norms, "what do others typically do", public benchmarks). NEVER
research (a) private/internal data — exact burn, churn, internal metrics — or (b) company-specific STRATEGIC
questions like "what should WE price / position / build" — those need internal discovery, not a web benchmark,
so they stay honest unknowns ("answer", with the gap flagged). A contradiction is reconciled when answering,
not researched. Prefer "answer"; only deepen or research when it would actually change the answer.

Reason briefly, then output ONLY the JSON. Worked examples (illustrative — one per branch):
• ENOUGH → answer: the runway position is well-evidenced; the only unknown (current burn) is INTERNAL.
  {"need":"answer","research_gaps":[],"reasoning":"enough to frame a defensible answer; the missing burn is an internal unknown, so flag it as a gap rather than research it"}
• MISSING-BUT-INTERNAL → deeper_memory: the question needs the competitor a deal was lost to, which is in memory but wasn't retrieved.
  {"need":"deeper_memory","research_gaps":[],"reasoning":"the competitor is likely already in memory on a connected node — expand the graph before answering"}
• NEEDS-EXTERNAL → research_web: asks for a healthy post-raise runway buffer; memory has our own runway but no public benchmark.
  {"need":"research_web","research_gaps":["typical post-Series-A runway buffer in months"],"reasoning":"our own runway is known; the benchmark is public info not in memory, so research that specific gap"}`;

function bundle(question: string, r: Retrieved, researchFacts: Fact[]): string {
  const parts: string[] = [`QUESTION: ${question}`];
  if (r.position) parts.push(`POSITION ${r.position.name} (confidence ${r.position.confidence}): ${r.position.summary}`);
  if (r.position?.gaps.length) parts.push(`PRE-FLAGGED GAPS (only research web-answerable ones): ${r.position.gaps.join("; ")}`);
  if (r.signals.length) parts.push(`SIGNALS: ${r.signals.map((s) => `${s.label} (${s.promotion}, count ${s.count})`).join("; ")}`);
  if (r.facts.length) parts.push(`FACTS: ${r.facts.map((f) => `${f.value}${f.qualifier ? ` [only if ${f.qualifier}]` : ""}`).join("; ")}`);
  if (r.contradictions.length) parts.push(`CONTRADICTIONS (reconcile, don't research): ${r.contradictions.map((c) => `[${c.kind}] ${c.note}`).join("; ")}`);
  if (researchFacts.length) parts.push(`WEB RESEARCH ALREADY DONE: ${researchFacts.map((f) => f.value).join("; ")}`);
  return parts.join("\n");
}

export type Need = "answer" | "deeper_memory" | "research_web";

export async function assessSufficiency(
  question: string,
  r: Retrieved,
  researchFacts: Fact[] = [],
  groundingNote = "",
): Promise<{ need: Need; gaps: string[]; reasoning: string }> {
  const note = groundingNote
    ? `\n\nGROUNDING GAP (a prior answer couldn't cite this): ${groundingNote}\n` +
      `If the support likely sits in memory, choose deeper_memory; if it needs external info, research_web.`
    : "";
  const j = await structured({
    system: SYSTEM,
    user: bundle(question, r, researchFacts) + note,
    schema: Assessment,
    toolName: "assess",
    toolDescription: "Decide: answer, search memory deeper, or research the web — with one-line reasoning.",
    model: config.answerModel, // answer-time → fast model
    maxTokens: 1200, // room for low thinking + the JSON (Gemini counts thinking against max_tokens)
    reasoningEffort: "low", // a 3-way decision — minimal thinking is plenty
  });
  return { need: j.need as Need, gaps: j.research_gaps ?? [], reasoning: j.reasoning };
}
