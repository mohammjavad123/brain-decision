import { embedOne } from "../llm/embed.js";
import { resolveDecision, getDecision, insertSource, insertFact } from "../db/queries.js";
import { newId, nowIso, sha256 } from "../util.js";
import type { Fact, Source } from "../schema/index.js";

/**
 * Step 5 — close the loop. When the human approves or rejects a recommendation, fold that recorded
 * outcome BACK INTO MEMORY as an append-only, decision-grade (E5) fact, sourced from the decision
 * itself. This is the "recorded outcome → back into memory" half of the challenge's decision loop.
 *
 * On-thesis: the re-entry is deterministic ("algorithms in the path") — no LLM beyond the single
 * embedding needed so future SIMILARITY and DIMENSION-COMPLETE retrieval surface it automatically
 * (no change to the retrieval code). It's APPENDED, never overwriting — prior beliefs stay queryable
 * (bi-temporal), and the new fact carries the decision as its provenance source.
 */

const DIMENSION_HINTS: [RegExp, string][] = [
  [/runway|burn|cash|raise|fundrais|months? left/, "runway"],
  [/icp|mid-?market|enterprise|upmarket|segment|self-serve/, "icp"],
  [/pricing|price|budget|discount|sign-?off|authority/, "pricing"],
];
function inferDimension(question: string): string | null {
  const s = question.toLowerCase();
  for (const [re, dim] of DIMENSION_HINTS) if (re.test(s)) return dim;
  return null;
}

export async function resolveAndFold(
  id: string,
  verdict: "approved" | "rejected",
  note: string | null,
): Promise<{ ok: boolean; factId?: string }> {
  const existing = await getDecision(id);
  if (!existing) return { ok: false };

  const at = nowIso();
  const wasPending = existing.status === "pending";
  await resolveDecision(id, verdict, note, at); // record the human's verdict (Step 5, half 1)
  if (!wasPending) return { ok: true }; // already folded once — don't duplicate the memory

  // ── fold the recorded outcome back into memory (Step 5, half 2) ──
  const verb = verdict === "approved" ? "approved" : "rejected";
  const sourceId = `decision/${id}`;
  const body =
    `Founder ${verb} the recommendation for "${existing.question}" ` +
    `(stated at ${existing.confidence} confidence)${note ? ` — note: ${note}` : ""}: ${existing.recommendation}`;
  const source: Source = {
    id: sourceId,
    type: "decision",
    date: at,
    author: "Maya Chen",
    participants: ["Maya Chen"],
    body,
    hash: sha256(body),
  };
  await insertSource(source);

  const value = `Founder ${verb} this recommendation (${existing.confidence} confidence): ${existing.recommendation}`;
  const fact: Fact = {
    id: newId("fact"),
    type: "decision",
    value,
    quote: existing.recommendation,
    source_id: sourceId,
    speaker: "Maya Chen",
    location_start: null,
    location_end: null,
    confidence: verdict === "approved" ? 0.95 : 0.9,
    evidence_tier: "E5", // a human-ratified decision is decision-grade evidence
    dimension: inferDimension(existing.question),
    qualifier: verdict === "rejected" ? "founder rejected this recommendation" : null,
    comparable: null,
    valid_time: at,
    learned_time: at,
    superseded_at: null,
  };
  const embedding = await embedOne(`${existing.question}\n${existing.recommendation}`);
  await insertFact(fact, embedding);
  return { ok: true, factId: fact.id };
}
