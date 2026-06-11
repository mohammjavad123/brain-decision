import { structured } from "../llm/structured.js";
import { ComposedPosition } from "../schema/index.js";
import type { Contradiction, Fact, Signal } from "../schema/index.js";
import { config } from "../config.js";

/**
 * Seam #2 — Compose. Compiles a venture POSITION from already-structured evidence
 * (typed facts + detected contradictions + signals). It reads structure, not the raw corpus,
 * and it never recommends an action — it just states where the company stands, drift and all.
 */
const SYSTEM = `You are the compose seam of a decision brain. From the provided EVIDENCE (typed facts +
detected contradictions), compile ONE venture POSITION — a drift-aware stance.

Rules:
- "summary": a neutral, evidence-weighted statement of where the company actually stands on this
  dimension. If the evidence conflicts or drifts over time, SAY SO plainly. Do not pick a side or
  smooth it over. Note recency (newer evidence) and conditions (qualifiers) explicitly.
- "fields": the key sub-claims, each with the fact ids that support it. Use ONLY ids present in the
  evidence (e.g. "fact_1a2b"). Every field must be citable.
- "confidence": low | medium | high — lower it when contradictions are unresolved or evidence is thin.
- "gaps": concrete things you'd need to be confident but that are NOT in the evidence — e.g.
  "current monthly burn rate", "win/loss data vs the competitor". Be specific; each gap may trigger research.
- Never invent facts. Never recommend an action. Low temperature, strict schema.`;

export async function composePosition(
  name: string,
  facts: Fact[],
  contradictions: Contradiction[],
): Promise<ComposedPosition> {
  const factLines = facts
    .map(
      (f) =>
        `- [${f.id}] (${f.evidence_tier}, valid ${f.valid_time}, src ${f.source_id}` +
        `${f.qualifier ? `, ONLY IF: ${f.qualifier}` : ""}): ${f.value} — "${f.quote}"`,
    )
    .join("\n");
  const contraLines =
    contradictions.map((c) => `- [${c.kind}] ${c.note}`).join("\n") || "(none detected)";

  const user = `Position to compile: ${name}

EVIDENCE (typed facts — cite these ids):
${factLines}

CONTRADICTIONS detected on this dimension:
${contraLines}`;

  return structured({
    system: SYSTEM,
    user,
    schema: ComposedPosition,
    toolName: "compile_position",
    toolDescription: "Compile the drift-aware venture position from the evidence.",
    model: config.composeModel,
    maxTokens: 2048,
  });
}
