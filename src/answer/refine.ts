import { structured } from "../llm/structured.js";
import { RefinedQuery } from "../schema/index.js";
import { config } from "../config.js";

/**
 * The `refine` node (B) — a fast LLM rewrite of the CEO question into a better SEMANTIC SEARCH query.
 * It bridges the vocabulary gap between how a CEO phrases a question and how the founder's raw notes
 * actually read (e.g. "which objection is killing deals" → "sales objection budget authority sign-off
 * approval blocking deals"). Improves recall before the deterministic retrieval runs.
 */
const SYSTEM = `You are the intake step of a company decision brain. First decide if the question is IN SCOPE —
about the founder's own business held in memory (strategy, ICP, runway/finances, deals, objections,
competitors, team, product, customers). General questions (weather, world trivia, coding help, chit-chat)
are OUT of scope. Then rewrite an in-scope question into a short SEMANTIC SEARCH query over the startup's
notes/calls/emails/facts — the concrete words those sources would use (no question marks, no fluff) — and
one line on what good evidence looks like. (For out-of-scope questions, still return a best-effort query.)`;

export async function refineQuery(question: string): Promise<RefinedQuery> {
  return structured({
    system: SYSTEM,
    user: `CEO question: ${question}`,
    schema: RefinedQuery,
    toolName: "refine",
    toolDescription: "Rewrite the question into a retrieval query and what good evidence looks like.",
    model: config.refineModel, // tiniest/fastest — intake is just scope + a query rewrite
    maxTokens: 768,
    reasoningEffort: "low",
  });
}
