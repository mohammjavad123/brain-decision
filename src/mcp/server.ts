import { FastMCP } from "fastmcp";
import { z } from "zod";
import { answer } from "../answer/index.js";
import { formatDecision } from "../format.js";
import {
  provenanceForFact,
  currentContradictions,
  getPositionByName,
  currentSignals,
  listDecisions,
  getDecision,
} from "../db/queries.js";
import { resolveAndFold } from "../answer/closeLoop.js";

/**
 * The agent surface (FastMCP over stdio). The brain is OPERABLE by an agent — not just queryable:
 * an external MCP client (Claude Desktop/Code, any agent) spawns this and can ask the FULL agent,
 * walk provenance, read positions/signals/contradictions, and record the human's approve/reject.
 * No tool ever takes an autonomous action; `resolve_decision` only RECORDS a verdict it is given.
 * (Switching to httpStream for remote access is a one-line change to `start` below.)
 */
const server = new FastMCP({ name: "decision-brain", version: "0.1.0" });

server.addTool({
  name: "query_brain",
  description:
    "Ask the decision brain a CEO question. Runs the full agent — retrieves from memory, researches open gaps with real web search, returns a cited recommendation, and logs a pending decision. Recommends only — the human decides.",
  parameters: z.object({ question: z.string() }),
  execute: async ({ question }) => {
    const { decision } = await answer(question);
    return formatDecision(decision);
  },
});

server.addTool({
  name: "get_provenance",
  description: "Walk a fact id back to its exact source: verbatim quote, speaker, location, and the source item.",
  parameters: z.object({ fact_id: z.string() }),
  execute: async ({ fact_id }) => {
    const p = await provenanceForFact(fact_id);
    if (!p) return `No fact ${fact_id}`;
    return JSON.stringify(
      {
        fact: { id: p.fact.id, value: p.fact.value, quote: p.fact.quote, dimension: p.fact.dimension },
        source: { id: p.source.id, type: p.source.type, author: p.source.author, date: p.source.date },
        speaker: p.fact.speaker,
        location: [p.fact.location_start, p.fact.location_end],
      },
      null,
      2,
    );
  },
});

server.addTool({
  name: "list_contradictions",
  description: "List detected contradictions (first-class rows).",
  parameters: z.object({}),
  execute: async () => {
    const cs = await currentContradictions();
    return cs.map((c) => `[${c.kind}] ${c.note}`).join("\n") || "none";
  },
});

server.addTool({
  name: "get_position",
  description: "Get a compiled, drift-aware position by name (e.g. 'ICP' or 'runway') with its citations and gaps.",
  parameters: z.object({ name: z.string() }),
  execute: async ({ name }) => {
    const p = await getPositionByName(name);
    return p ? JSON.stringify(p, null, 2) : `No position '${name}'`;
  },
});

server.addTool({
  name: "list_signals",
  description: "List signals (claims aggregated across calls) with their promotion tier.",
  parameters: z.object({}),
  execute: async () => {
    const s = await currentSignals();
    return (
      s.map((x) => `[${x.promotion}] ${x.type}: "${x.label}" (count ${x.count}, ${x.companies.length} companies)`).join("\n") || "none"
    );
  },
});

server.addTool({
  name: "list_decisions",
  description: "List the append-only decision log.",
  parameters: z.object({}),
  execute: async () => {
    const ds = await listDecisions();
    return ds.map((d) => `${d.id} [${d.status}] ${d.question} → ${d.recommendation}`).join("\n\n") || "none";
  },
});

server.addTool({
  name: "resolve_decision",
  description:
    "Record the human's approve/reject verdict on a logged decision, and fold the outcome back into memory. The human decides; this only records the verdict it is given — it never approves on its own.",
  parameters: z.object({ id: z.string(), verdict: z.enum(["approved", "rejected"]), note: z.string().optional() }),
  execute: async ({ id, verdict, note }) => {
    if (!(await getDecision(id))) return `No decision ${id}`;
    await resolveAndFold(id, verdict, note ?? null);
    return `Decision ${id} → ${verdict} · folded back into memory`;
  },
});

await server.start({ transportType: "stdio" });
