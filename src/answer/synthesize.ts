import { structured } from "../llm/structured.js";
import { SynthesizedAnswer } from "../schema/index.js";
import type { Fact } from "../schema/index.js";
import type { Retrieved } from "./route.js";
import { config } from "../config.js";

/**
 * Seam #2 at the decision point. Synthesizes an answer over the SMALL retrieved set (a compiled
 * position + signals + facts + contradictions + any research) — never the corpus. Recommends only.
 */
const SYSTEM = `You are the synthesis seam at a decision brain's decision point. Answer the CEO's question
using ONLY the provided evidence (position, signals, typed facts, contradictions, any web research). You
RECOMMEND; the human decides — never imply you acted.

- Cite fact ids for every claim. Put honest unknowns in "gaps", not in claims. Never invent beyond the evidence.
- Lead with the decision-useful bottom line. When evidence conflicts or is conditional, the bottom line is
  the FRAMING — not one false-precise number.
- Figures are tied to a DATE and a CONDITION — handle them honestly:
   · conflicting values → reconcile: say WHY they differ (condition or date) and which is defensible; never average or hide;
   · a figure whose basis a later fact changed → STALE: say so, and that the CURRENT value is UNKNOWN until recomputed;
   · conditional values ("X if we hire") → scenarios, led by the deciding condition.
  Surface every state that applies — stale prior · unknown current · conditional future — never collapse them into one number.
- Confidence ≤ "medium" when a load-bearing figure is unverified, conditional, or stale. Use "low" only if
  the evidence barely supports an answer — well-evidenced but conditional/contradicted is "medium". Prefer "I don't know" over bluffing.
- A "web/" fact is an EXTERNAL benchmark — say so; never present it as the founder's own data.
- End with ONE next action — ideally the one that gets the missing figure or resolves the open decision.`;

function factLine(f: Fact): string {
  return (
    `- [${f.id}] (${f.evidence_tier}, valid ${f.valid_time}, src ${f.source_id}` +
    `${f.qualifier ? `, ONLY IF: ${f.qualifier}` : ""}): ${f.value} — "${f.quote}"`
  );
}

export async function synthesize(
  question: string,
  r: Retrieved,
  researched: Fact[],
  researchNote: string,
  feedback = "",
): Promise<SynthesizedAnswer> {
  const parts: string[] = [`QUESTION: ${question}`];

  if (r.position) {
    parts.push(`\nCOMPILED POSITION — ${r.position.name} (confidence ${r.position.confidence}):\n${r.position.summary}`);
  }
  if (r.signals.length) {
    parts.push(
      `\nSIGNALS:\n` +
        r.signals
          .map((s) => `- [${s.type}] "${s.label}" — ${s.promotion}, count ${s.count}, across ${s.companies.length} companies (${s.companies.join(", ")})`)
          .join("\n"),
    );
  }
  if (r.facts.length) parts.push(`\nFACTS (cite these ids):\n` + r.facts.map(factLine).join("\n"));
  if (r.contradictions.length) {
    parts.push(`\nCONTRADICTIONS detected:\n` + r.contradictions.map((c) => `- [${c.kind}] ${c.note}`).join("\n"));
  }
  if (researched.length) parts.push(`\nWEB RESEARCH (folded in as cited facts):\n` + researched.map(factLine).join("\n"));
  if (researchNote) parts.push(`\nNOTE: ${researchNote}. Be explicit that this gap is unresearched.`);
  if (feedback) parts.push(`\nGROUNDING FEEDBACK — your previous answer failed verification, fix it: ${feedback}`);

  return structured({
    system: SYSTEM,
    user: parts.join("\n"),
    schema: SynthesizedAnswer,
    toolName: "answer",
    toolDescription: "Return the synthesized, cited answer and a single recommended next action.",
    model: config.synthesizeModel, // the decision point → stronger reasoning model
    maxTokens: 1500,
  });
}
