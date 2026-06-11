import { structured } from "../llm/structured.js";
import { SynthesizedAnswer } from "../schema/index.js";
import type { Fact } from "../schema/index.js";
import type { Retrieved } from "./route.js";
import { config } from "../config.js";

/**
 * Seam #2 at the decision point. Synthesizes an answer over the SMALL retrieved set (a compiled
 * position + signals + facts + contradictions + any research) — never the corpus. Recommends only.
 */
const SYSTEM = `You are the synthesis seam at a decision brain's decision point. Using ONLY the provided
evidence (position, signals, typed facts, contradictions, any web research), produce a DECISION BRIEF for the
CEO. You RECOMMEND; the human decides — never imply you acted. Never invent beyond the evidence.

Emit four parts:
- bottom_line — ONE line, the decision-useful headline. When evidence conflicts or is conditional, this is the
  FRAMING, not a false-precise number.
- recommendation — the single next action (ideally the one that gets the missing figure or resolves the decision).
- reasoning — the "why" as a FEW concise points, EACH backed by the fact ids that support it (its receipts).
  Only established points belong here; anything the evidence doesn't establish goes in gaps, never asserted.
- gaps — the blind spots: what the evidence could NOT confirm. State plainly; never invent.

Rules:
- Figures are tied to a DATE and a CONDITION — surface every state, never collapse to one number:
   · conflicting → reconcile: say WHY they differ (date/condition) and which is defensible; never average or hide;
   · a figure a later fact changed → STALE: say so, and that the CURRENT value is UNKNOWN until recomputed;
   · conditional ("X if we hire") → scenarios, led by the deciding condition.
- Confidence ≤ "medium" when a load-bearing figure is unverified, conditional, or stale; well-evidenced but
  conditional/contradicted is "medium"; "low" only if the evidence barely supports an answer. Prefer "I don't know" over bluffing.
- A "web/" fact is an EXTERNAL benchmark — say so; never present it as the founder's own data.`;

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
    model: config.synthesizeModel, // the decision point
    maxTokens: 3072, // room for low thinking + the cited answer
    reasoningEffort: "low",
  });
}
