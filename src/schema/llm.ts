/**
 * The I/O contracts for the two LLM seams. Both are STRICT schemas — the model is forced to
 * emit exactly this shape (via tool-use), and we validate before anything touches memory.
 * "Always low-temperature, strict-schema output — no chain-of-thought in the product path."
 *
 * Seam #1 — Extract  (raw text → typed facts + entities + relationships)
 * Seam #2 — Compose  (validated signals/facts/contradictions → Position, and question → answer)
 *
 * Note what the LLM does NOT emit: ids, source_id, valid_time, learned_time, location, embedding.
 * Those are filled deterministically by the system. The `quote` is verified against the source.
 */
import { z } from "zod";
import { Confidence } from "./types.js";

// ─── Seam #1: Extract ────────────────────────────────────────────────────────
// Enums are accepted as free strings here and coerced to the canonical vocabulary in the pipeline,
// so a single near-miss (e.g. "Objection ") never fails the whole source's extraction.

export const ExtractedFact = z.object({
  type: z
    .string()
    .describe(
      "one of: claim|pain_point|objection|workflow|buying_signal|buyer_role|competitor|pricing_hint|willingness_to_pay|feature_request|product_feedback|constraint|risk",
    ),
  value: z.string().describe("normalized one-line claim, e.g. 'runway = 18 months at current burn'"),
  quote: z.string().describe("VERBATIM span copied from the source text — must appear exactly"),
  speaker: z.string().nullable().describe("who said it, or null if not attributable"),
  confidence: z.number().min(0).max(1).describe("how certain this atom is correctly extracted"),
  evidence_tier: z.string().describe("E1 casual mention … E5 full buying narrative"),
  dimension: z
    .string()
    .nullable()
    .describe("the axis this is about: 'runway' | 'icp' | 'pricing' | 'budget_authority' | null"),
  qualifier: z
    .string()
    .nullable()
    .describe("any condition attached, e.g. 'after hiring 2 AEs', or null"),
  comparable: z
    .string()
    .nullable()
    .describe(
      "a SHORT canonical token for comparing facts on the same dimension — e.g. '18 months', '9 months', " +
        "'mid_market', 'enterprise'. Reflect what IS being claimed, NOT what is negated (for 'enterprise is NOT " +
        "our ICP', the claimed ICP is mid_market, so comparable='mid_market'). null if not comparable.",
    ),
});
export type ExtractedFact = z.infer<typeof ExtractedFact>;

export const ExtractedEntity = z.object({
  name: z.string(),
  type: z.string().describe("person|company|investor|competitor"),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntity>;

export const ExtractedRelationship = z.object({
  subject: z.string(),
  predicate: z.string().describe("founded | works_at | invested_in | competes_with | …"),
  object: z.string(),
});
export type ExtractedRelationship = z.infer<typeof ExtractedRelationship>;

export const ExtractionResult = z.object({
  facts: z.array(ExtractedFact),
  entities: z.array(ExtractedEntity),
  relationships: z.array(ExtractedRelationship),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

// ─── Seam #2a: Compose a Position ─────────────────────────────────────────────

export const ComposedPositionField = z.object({
  claim: z.string(),
  fact_ids: z.array(z.string()).describe("ids of the facts that cite this claim (from the input)"),
});

export const ComposedPosition = z.object({
  summary: z.string().describe("the compiled stance — drift-aware, neutral, evidence-weighted"),
  fields: z.array(ComposedPositionField),
  confidence: Confidence,
  gaps: z.array(z.string()).describe("what's missing/unknown — each gap may trigger research at read-time"),
});
export type ComposedPosition = z.infer<typeof ComposedPosition>;

// ─── Seam #2b: Synthesize an answer (question-time, over a SMALL retrieved set) ──

// A decision brief: a one-line call, the cited "why" (receipts), the blind spots, and a next action.
export const SynthesizedReason = z.object({
  point: z.string().describe("one concise reason driving the recommendation, in plain language"),
  fact_ids: z.array(z.string()).describe("ids of provided facts that back THIS point — its receipts (used by verify_grounding)"),
});
export const SynthesizedAnswer = z.object({
  bottom_line: z.string().describe("the decision-useful headline in ONE line; when evidence conflicts or is conditional this is the FRAMING, never a false-precise number"),
  recommendation: z.string().describe("the single recommended next action — RECOMMEND ONLY, never an action taken"),
  confidence: Confidence,
  reasoning: z
    .array(SynthesizedReason)
    .describe("the 'why' — a few concise points, EACH backed by cited fact ids. Only established points; anything unproven belongs in gaps, never here"),
  gaps: z.array(z.string()).describe("blind spots — what the evidence/research could NOT establish; state plainly, never invent"),
});
export type SynthesizedAnswer = z.infer<typeof SynthesizedAnswer>;

// ─── Refine: rewrite the question into a better retrieval query (B) ──
export const RefinedQuery = z.object({
  in_scope: z
    .boolean()
    .describe(
      "Is this question IN SCOPE for a company decision brain — about the founder's business captured in memory " +
        "(strategy, ICP, runway/finances, deals/pipeline, objections, competitors, team, product, customers)? " +
        "General questions (weather, world trivia, coding help, chit-chat) are OUT of scope → false.",
    ),
  query: z.string().describe("a concise semantic-search query over the founder's notes/calls/facts — expand to the concrete vocabulary those notes likely use"),
  looking_for: z.string().describe("one line: what good evidence to answer this question looks like"),
});
export type RefinedQuery = z.infer<typeof RefinedQuery>;

// ─── Assess: the agent's decision — answer, search memory deeper, or research the web (C) ──
export const Assessment = z.object({
  need: z
    .enum(["answer", "deeper_memory", "research_web"])
    .describe(
      "Decide the next step: 'answer' = the evidence is enough to answer well; 'deeper_memory' = relevant " +
        "info is likely already in memory but wasn't fully retrieved (search broader); 'research_web' = the " +
        "gap needs external/public info that is not in memory.",
    ),
  reasoning: z.string().describe("one concise line: why"),
  research_gaps: z
    .array(z.string())
    .describe(
      "ONLY when need='research_web': specific, web-answerable gaps. NEVER private/internal data the web " +
        "cannot provide (e.g. a company's exact burn rate). Empty otherwise.",
    ),
});
export type Assessment = z.infer<typeof Assessment>;

// ─── Research fold-back: turn web findings into cited facts ─────────────────────
// "research the gaps … fold findings back as cited facts — not a raw web dump."

export const ResearchedFinding = z.object({
  claim: z.string().describe("a single normalized fact learned from the source"),
  quote: z.string().describe("verbatim snippet from the page supporting the claim"),
  relevance: z.number().min(0).max(1).describe("how directly this answers the gap"),
});
export const ResearchExtraction = z.object({
  findings: z.array(ResearchedFinding),
});
export type ResearchExtraction = z.infer<typeof ResearchExtraction>;
