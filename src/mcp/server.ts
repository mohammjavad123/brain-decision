import { FastMCP } from "fastmcp";
import { z } from "zod";
import { answer } from "../answer/index.js";
import { formatDecision } from "../format.js";
import { provenanceForFact, getDecision } from "../db/queries.js";
import { resolveAndFold } from "../answer/closeLoop.js";
import { withTenant, DEFAULT_TENANT } from "../db/client.js";
import { migrate } from "../db/migrate.js";

/**
 * The agent surface (FastMCP over stdio) — three tools, one per verb of the design: DECIDE · VERIFY · CLOSE.
 *
 * It deliberately exposes the agent, NOT the agent's internals. `query_brain` IS the root agent: a single
 * call retrieves from memory and — when the graph decides it's warranted — deepens the memory graph and/or
 * researches the web ON ITS OWN, inside that one call. Those two internal steps are never separate tools:
 * the graph decides when to take them, not the caller. The other two tools let a client trust and operate
 * the result — walk any cited fact back to its verbatim source (`get_provenance`) and record the human's
 * approve/reject so the outcome folds back into memory (`resolve_decision`).
 *
 * No tool ever takes an autonomous action; `resolve_decision` only RECORDS a verdict it is given.
 * (Switching to httpStream for remote access is a one-line change to `start` below.)
 *
 * Every tool runs inside withTenant() so the same Row-Level Security boundary as the web app applies here.
 * This stdio surface is single-tenant (DEFAULT_TENANT); a remote/multi-tenant deployment would derive the
 * tenant from the authenticated MCP session instead.
 */
const server = new FastMCP({ name: "decision-brain", version: "0.1.0" });

// DECIDE — the whole agent behind one tool.
server.addTool({
  name: "query_brain",
  description:
    "Ask the decision brain a CEO question. This runs the FULL agent: it retrieves from company memory and, " +
    "when the gap warrants it, autonomously deepens the memory graph and/or researches open gaps with real " +
    "web search — all inside this one call. Returns a cited recommendation and logs a pending decision. " +
    "It recommends only; the human decides (see resolve_decision).",
  parameters: z.object({ question: z.string() }),
  execute: ({ question }) =>
    withTenant(DEFAULT_TENANT, async () => {
      const { decision } = await answer(question);
      return formatDecision(decision);
    }),
});

// VERIFY — the receipts: any cited fact → its exact source.
server.addTool({
  name: "get_provenance",
  description: "Walk a fact id back to its exact source: verbatim quote, speaker, location, and the source item.",
  parameters: z.object({ fact_id: z.string() }),
  execute: ({ fact_id }) =>
    withTenant(DEFAULT_TENANT, async () => {
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
    }),
});

// CLOSE THE LOOP — record the human verdict; fold the outcome back into memory.
server.addTool({
  name: "resolve_decision",
  description:
    "Record the human's approve/reject verdict on a logged decision, and fold the outcome back into memory so " +
    "future queries retrieve it. The human decides; this only records the verdict it is given — it never approves on its own.",
  parameters: z.object({ id: z.string(), verdict: z.enum(["approved", "rejected"]), note: z.string().optional() }),
  execute: ({ id, verdict, note }) =>
    withTenant(DEFAULT_TENANT, async () => {
      if (!(await getDecision(id))) return `No decision ${id}`;
      await resolveAndFold(id, verdict, note ?? null);
      return `Decision ${id} → ${verdict} · folded back into memory`;
    }),
});

// Ensure the tenant boundary exists before serving (idempotent): the app_user role + RLS policies + the
// demo tenant must be in place, or withTenant() below would fail on a never-seeded DB. No stdout output,
// so it's safe for the stdio transport.
await migrate();

await server.start({ transportType: "stdio" });
