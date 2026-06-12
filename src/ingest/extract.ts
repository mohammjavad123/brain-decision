import { structured } from "../llm/structured.js";
import { ExtractionResult } from "../schema/index.js";
import type { Source } from "../schema/index.js";
import { config } from "../config.js";

/**
 * Seam #1 — Extract. The ONLY LLM call in ingest. Reads one raw item, emits typed atoms.
 * The `quote` is verified against the source afterwards (the pipeline rejects any fact whose
 * quote isn't in the body) — so the model cannot invent provenance.
 */
const SYSTEM = `You are the extraction seam of a decision brain. You read ONE raw item from a founder's
week and extract atomic, TYPED facts — never summaries. Free-text summaries lie; typed atoms don't.

Rules for facts:
- One distinct claim per fact. Atomic.
- "quote" MUST be copied VERBATIM from the body (an exact substring). Never paraphrase. If you cannot
  quote it exactly, do NOT extract it — the quote is verified against the source.
- "value": a short normalized restatement, e.g. "runway = 18 months at current burn".
- "type": best fit — claim | objection | pain_point | competitor | pricing_hint | buying_signal |
  buyer_role | willingness_to_pay | feature_request | product_feedback | workflow | constraint | risk.
- "dimension": the axis the fact is about. Use EXACTLY these canonical slugs when they apply:
    • "runway"           — cash, runway, burn, months of cash left
    • "icp"              — target customer / market segment: mid-market, enterprise, upmarket,
                           self-serve, who we sell to, ICP drift
    • "budget_authority" — friction about budget / approval / sign-off / procurement (type these as
                           "objection", even when mild, e.g. "sign-off needed above pilot")
    • "pricing"          — explicit price points or willingness-to-pay thresholds
    • "competitor"       — a named competitor (type these as "competitor")
  Use null only when none apply. Facts on the SAME dimension are how contradictions surface.
- "qualifier": any condition attached to the claim — e.g. "after hiring 2 AEs", "for a pilot",
  "under $10k", "before the AE hires". null if unconditional. This is load-bearing: it decides
  whether two facts truly conflict (a conditional 9-month runway does not flatly contradict 18 months).
- "comparable": a SHORT canonical token used to compare facts on the SAME dimension — e.g. "18 months",
  "9 months", "mid_market", "enterprise". Reflect what IS claimed, not what is negated ("enterprise is NOT
  our ICP" → comparable "mid_market"). null if the fact isn't a comparable value on its dimension.
- "evidence_tier": E1 casual mention … E5 explicit decision-grade statement.
- "confidence": 0–1, how sure you are the atom is correctly captured.
- "speaker": who said/wrote it, or null.

Also extract:
- "entities": every person, company, investor, or competitor named. Use the CANONICAL name only —
  the bare company/person, never folding in a verb or state. (e.g. "lost halberd" → "Halberd Freight";
  "the acme folks" → "Acme Freight"; "freight pilot" → "FreightPilot".) Prefer the fullest known form.
- "relationships": subject→predicate→object links. Include explicit ones AND infer the obvious
  structural ones from context (surfacing connections is the job). Examples:
  {"subject":"Jordan Rivera","predicate":"works_at","object":"Acme Freight"},
  {"subject":"FreightPilot","predicate":"competes_with","object":"Loomwork"}.
  Inference rules: an investor update from a founder to an investor about a company implies the
  founder works_at/founded the company AND the investor invested_in the company; a board note by a
  CTO implies that person works_at the company; a prospect call implies the prospect company evaluated Loomwork.

Low temperature. Strict schema. No commentary. Reason about the item silently, then output ONLY the JSON object.

Worked example (illustrative — a different company; mirror this shape, not its content):
INPUT: "Ops note (RiverCorp): we're at roughly 12 months of cash at the current spend; the new VP wants sign-off on anything over $25k."
OUTPUT:
{"facts":[
  {"type":"claim","value":"runway ≈ 12 months at current spend","quote":"roughly 12 months of cash at the current spend","speaker":null,"confidence":0.85,"evidence_tier":"E3","dimension":"runway","qualifier":"at current spend","comparable":"12 months"},
  {"type":"objection","value":"VP sign-off required above $25k","quote":"the new VP wants sign-off on anything over $25k","speaker":null,"confidence":0.8,"evidence_tier":"E3","dimension":"budget_authority","qualifier":"over $25k","comparable":null}
],"entities":[{"name":"RiverCorp","type":"company"}],"relationships":[]}
Note: each quote is copied verbatim; nothing is inferred beyond what the text says.`;

export async function extractFromSource(source: Source): Promise<ExtractionResult> {
  const who = source.author ?? source.participants.join(", ") ?? "unknown";
  const user = `Source id: ${source.id}
Type: ${source.type}
Date: ${source.date}
Author/participants: ${who}

--- BODY (sacred — quote verbatim) ---
${source.body}`;

  return structured({
    system: SYSTEM,
    user,
    schema: ExtractionResult,
    toolName: "record_extraction",
    toolDescription: "Record the typed facts, entities, and relationships found in this source.",
    model: config.extractModel,
    maxTokens: 4096,
  });
}
