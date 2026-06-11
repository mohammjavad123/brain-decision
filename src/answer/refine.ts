import { structured } from "../llm/structured.js";
import { RefinedQuery } from "../schema/index.js";
import { config } from "../config.js";

/**
 * The `refine` node (B) — a fast LLM rewrite of the CEO question into a better SEMANTIC SEARCH query.
 * It bridges the vocabulary gap between how a CEO phrases a question and how the founder's raw notes
 * actually read (e.g. "which objection is killing deals" → "sales objection budget authority sign-off
 * approval blocking deals"). Improves recall before the deterministic retrieval runs.
 */
const SYSTEM = `Rewrite a CEO's question into a short SEMANTIC SEARCH query over the startup's own notes,
calls, emails, and typed facts. Use the concrete words those sources would actually use (a founder's or
salesperson's vocabulary, synonyms). No question marks, no fluff. Then one line: what good evidence to
answer this looks like.`;

export async function refineQuery(question: string): Promise<RefinedQuery> {
  return structured({
    system: SYSTEM,
    user: `CEO question: ${question}`,
    schema: RefinedQuery,
    toolName: "refine",
    toolDescription: "Rewrite the question into a retrieval query and what good evidence looks like.",
    model: config.answerModel,
    maxTokens: 300,
  });
}
