/**
 * The data model — the "typed atoms" the whole brain is built on.
 *
 * Grounding (VSI architecture overview + the build challenge):
 *  - "a typed atom with an evidence tier, a confidence, and a verbatim quote anchored to a range"
 *  - "free-text summaries lie, typed atoms don't"
 *  - "Provenance is a row, not a footnote" — every fact carries quote + source + speaker + location
 *  - "bi-temporal typed claims: every fact carries when it was true AND when we learned it"
 *
 * Everything stored in memory is one of these. Zod is the single source of truth for shape;
 * the DB columns mirror these, and every LLM seam is validated against the matching schema in `llm.ts`.
 */
import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

/** The kinds of typed fact we extract. Mirrors VSI's signal taxonomy + a generic `claim`. */
export const FactType = z.enum([
  "claim", // a stated fact about the company (runway, ICP, pricing, strategy…)
  "decision", // a human-ratified decision folded back into memory (Step 5 loop closure)
  "pain_point",
  "objection",
  "workflow",
  "buying_signal",
  "buyer_role",
  "competitor",
  "pricing_hint",
  "willingness_to_pay",
  "feature_request",
  "product_feedback",
  "constraint",
  "risk",
]);
export type FactType = z.infer<typeof FactType>;

export const EntityType = z.enum(["person", "company", "investor", "competitor"]);
export type EntityType = z.infer<typeof EntityType>;

export const SourceType = z.enum(["call", "email", "note", "tweet", "doc", "slack", "decision"]);
export type SourceType = z.infer<typeof SourceType>;

/** Evidence tier of a single piece of evidence. E1 = casual mention … E5 = full buying narrative. */
export const EvidenceTier = z.enum(["E1", "E2", "E3", "E4", "E5"]);
export type EvidenceTier = z.infer<typeof EvidenceTier>;

/** Signal promotion ladder — one-way (promotion never demotes). Maps to E2..E5 per VSI's UI. */
export const Promotion = z.enum(["candidate", "emerging", "validated", "decision_grade"]);
export type Promotion = z.infer<typeof Promotion>;

/** How two facts relate when they conflict. Classified deterministically from typed fields. */
export const ContradictionKind = z.enum([
  "direct", // same dimension, incompatible values, same conditions
  "conditional", // one side carries a qualifier the other doesn't (e.g. "after +2 AE hires")
  "drift", // same dimension, values diverge over time (valid_time differs)
  "superseded", // newer evidence replaces older on the same dimension
]);
export type ContradictionKind = z.infer<typeof ContradictionKind>;

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

// ─── 1. Source ────────────────────────────────────────────────────────────────
// "raw is sacred" · "Identity is the hash of the normalized body. Re-ingest is a no-op."
export const Source = z.object({
  id: z.string(), // stable human handle, e.g. "email/northpeak-update-may"
  type: SourceType,
  date: z.string(), // ISO — when it happened (→ valid_time of its facts)
  author: z.string().nullable(), // who authored / spoke (single-author items)
  participants: z.array(z.string()).default([]), // for calls
  body: z.string(), // the raw text — SACRED, never mutated
  hash: z.string(), // sha256(normalized body) — content address
});
export type Source = z.infer<typeof Source>;

// ─── 2. Fact (a "learning") ─────────────────────────────────────────────────────
// The atom. Smallest unit that satisfies all five non-negotiables at once.
export const Fact = z.object({
  id: z.string(),
  type: FactType,
  value: z.string(), // normalized claim, e.g. "runway = 18 months (current burn)"
  quote: z.string(), // verbatim — must exist in source.body or the fact is rejected
  source_id: z.string(), // provenance: points back to the item that justifies it
  speaker: z.string().nullable(), // provenance: who said it
  location_start: z.number().nullable(), // char offset of quote in body (would be ms in audio)
  location_end: z.number().nullable(),
  confidence: z.number().min(0).max(1), // extractor certainty (honesty)
  evidence_tier: EvidenceTier, // strength of this single evidence (Q2 "clears the bar")
  dimension: z.string().nullable(), // the axis this fact is about: "runway" | "icp" | "pricing" | …
  qualifier: z.string().nullable(), // condition attached, e.g. "after hiring 2 AEs"
  comparable: z.string().nullable().default(null), // canonical value for conflict comparison, e.g. "18 months" | "mid_market"
  valid_time: z.string(), // ISO — when true in the world
  learned_time: z.string(), // ISO — when we ingested it
  // bi-temporal append-only bookkeeping:
  superseded_at: z.string().nullable().default(null),
});
export type Fact = z.infer<typeof Fact>;

// ─── 3. Entity (canonical) ──────────────────────────────────────────────────────
// "one canonical person, not three string-matches"
export const Entity = z.object({
  id: z.string(),
  name: z.string(), // canonical name
  type: EntityType,
  aliases: z.array(z.string()).default([]),
});
export type Entity = z.infer<typeof Entity>;

// ─── 4. Edge (relationship OR provenance link, as a row) ─────────────────────────
// "Every signal→learning link … is a stored edge with a similarity score."
export const Edge = z.object({
  id: z.string(),
  from_id: z.string(),
  predicate: z.string(), // founded | works_at | invested_in | competes_with | about | member_of
  to_id: z.string(),
  source_id: z.string().nullable().default(null), // which item surfaced this relationship
  similarity: z.number().nullable().default(null), // for fact→signal membership links
});
export type Edge = z.infer<typeof Edge>;

// ─── 5. Signal (Layer 2 — aggregated by meaning) ─────────────────────────────────
// "Learnings that mean the same thing … cluster into a signal … carries the count of calls,
//  the companies, the last-confirmed date — and a promotion status."
export const Signal = z.object({
  id: z.string(),
  type: FactType,
  label: z.string(), // the one canonical claim
  fact_ids: z.array(z.string()),
  count: z.number(),
  companies: z.array(z.string()),
  last_confirmed: z.string(), // ISO — most recent supporting fact
  promotion: Promotion,
  learned_time: z.string(),
  superseded_at: z.string().nullable().default(null),
});
export type Signal = z.infer<typeof Signal>;

// ─── 6. Contradiction (first-class row) ──────────────────────────────────────────
// "'18 months' and '9 months' of runway is a contradiction the brain must notice."
export const Contradiction = z.object({
  id: z.string(),
  dimension: z.string(),
  fact_a: z.string(),
  fact_b: z.string(),
  kind: ContradictionKind,
  note: z.string(),
  status: z.enum(["open", "resolved"]).default("open"),
  learned_time: z.string(),
});
export type Contradiction = z.infer<typeof Contradiction>;

// ─── 7. Position (Layer 3 — compiled stance, drift-aware) ────────────────────────
// "positions (living stances — ICP, pricing, strategy — that visibly drift) …
//  compiled once at write-time with per-field citations."
export const PositionField = z.object({
  claim: z.string(),
  fact_ids: z.array(z.string()), // per-field citations → click through to source quote
});
export type PositionField = z.infer<typeof PositionField>;

export const Position = z.object({
  id: z.string(),
  name: z.string(), // "ICP" | "runway" | "pricing" | …
  summary: z.string(), // the compiled stance (LLM seam #2, write-time)
  fields: z.array(PositionField),
  signal_ids: z.array(z.string()),
  contradiction_ids: z.array(z.string()),
  confidence: Confidence,
  gaps: z.array(z.string()), // what's missing → pre-decides "memory vs research" at read-time
  valid_time: z.string(),
  learned_time: z.string(),
  compiled_at: z.string(),
  superseded_at: z.string().nullable().default(null),
});
export type Position = z.infer<typeof Position>;

// ─── 8. Decision (append-only log) ───────────────────────────────────────────────
// "the question, the facts and sources it leaned on, the confidence, the proposed action,
//  the open gaps, and the human's approve / reject."
export const Citation = z.object({
  fact_id: z.string(),
  quote: z.string(),
  source_id: z.string(),
  speaker: z.string().nullable(),
});
export type Citation = z.infer<typeof Citation>;

// one "why" point in the decision brief — a plain-language reason backed by cited facts (the receipts)
export const ReasoningPoint = z.object({
  point: z.string(),
  fact_ids: z.array(z.string()),
});
export type ReasoningPoint = z.infer<typeof ReasoningPoint>;

export const Decision = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(), // a readable brief composed from the bottom line + reasoning (for the log / CLI / MCP / eval)
  confidence: Confidence,
  evidence: z.array(Citation), // the facts + sources it leaned on
  reasoning: z.array(ReasoningPoint).default([]), // the cited "why" points (the receipts), for the UI brief
  contradiction_ids: z.array(z.string()),
  research_fact_ids: z.array(z.string()), // researched facts folded back in (cited)
  gaps: z.array(z.string()),
  recommendation: z.string(), // it recommends — never acts
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  human_note: z.string().nullable().default(null),
  created_at: z.string(),
  resolved_at: z.string().nullable().default(null),
});
export type Decision = z.infer<typeof Decision>;
