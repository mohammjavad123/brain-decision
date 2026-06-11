/**
 * The decision point. The agent loop is an explicit LangGraph StateGraph (see ./graph.ts):
 *   retrieve (deterministic) → assess ⇄ research (the one LLM-controlled, bounded decision)
 *   → synthesize (seam) → log a PENDING decision. It recommends; the human decides later.
 *
 * `answer` is the entry the CLI and MCP server call.
 */
export { runAgent as answer, type AnswerResult } from "./graph.js";
