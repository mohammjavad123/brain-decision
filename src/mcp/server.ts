import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { answer } from "../answer/index.js";
import { formatDecision } from "../format.js";
import { nowIso } from "../util.js";
import {
  provenanceForFact,
  currentContradictions,
  getPositionByName,
  currentSignals,
  listDecisions,
  getDecision,
  resolveDecision,
} from "../db/queries.js";

/**
 * The agent surface. The brain is OPERABLE by an agent — not just queryable: an agent can ask,
 * walk provenance, read positions/signals/contradictions, and record the human's approve/reject.
 * No tool ever takes an autonomous action; `resolve_decision` only RECORDS a verdict it's given.
 */
const server = new McpServer({ name: "decision-brain", version: "0.1.0" });
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

server.tool(
  "query_brain",
  "Ask the decision brain a CEO question. Retrieves from memory, researches open gaps with real web search, returns a cited recommendation, and logs a pending decision. Recommends only — the human decides.",
  { question: z.string() },
  async ({ question }) => {
    const { decision } = await answer(question);
    return text(formatDecision(decision));
  },
);

server.tool(
  "get_provenance",
  "Walk a fact id back to its exact source: verbatim quote, speaker, location, and the source item.",
  { fact_id: z.string() },
  async ({ fact_id }) => {
    const p = await provenanceForFact(fact_id);
    if (!p) return text(`No fact ${fact_id}`);
    return text(
      JSON.stringify(
        {
          fact: { id: p.fact.id, value: p.fact.value, quote: p.fact.quote, dimension: p.fact.dimension },
          source: { id: p.source.id, type: p.source.type, author: p.source.author, date: p.source.date },
          speaker: p.fact.speaker,
          location: [p.fact.location_start, p.fact.location_end],
        },
        null,
        2,
      ),
    );
  },
);

server.tool("list_contradictions", "List detected contradictions (first-class rows).", {}, async () => {
  const cs = await currentContradictions();
  return text(cs.map((c) => `[${c.kind}] ${c.note}`).join("\n") || "none");
});

server.tool(
  "get_position",
  "Get a compiled, drift-aware position by name (e.g. 'ICP' or 'runway') with its citations and gaps.",
  { name: z.string() },
  async ({ name }) => {
    const p = await getPositionByName(name);
    return text(p ? JSON.stringify(p, null, 2) : `No position '${name}'`);
  },
);

server.tool("list_signals", "List signals (claims aggregated across calls) with their promotion tier.", {}, async () => {
  const s = await currentSignals();
  return text(
    s.map((x) => `[${x.promotion}] ${x.type}: "${x.label}" (count ${x.count}, ${x.companies.length} companies)`).join("\n"),
  );
});

server.tool("list_decisions", "List the append-only decision log.", {}, async () => {
  const ds = await listDecisions();
  return text(ds.map((d) => `${d.id} [${d.status}] ${d.question} → ${d.recommendation}`).join("\n\n") || "none");
});

server.tool(
  "resolve_decision",
  "Record the human's approve/reject verdict on a logged decision. The human decides; this only records the verdict it is given — it never approves on its own.",
  { id: z.string(), verdict: z.enum(["approved", "rejected"]), note: z.string().optional() },
  async ({ id, verdict, note }) => {
    if (!(await getDecision(id))) return text(`No decision ${id}`);
    await resolveDecision(id, verdict, note ?? null, nowIso());
    return text(`Decision ${id} → ${verdict}`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("decision-brain MCP server running on stdio");
