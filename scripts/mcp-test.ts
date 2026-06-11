import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Proves the MCP surface is callable by a REAL external client — exactly how Claude Desktop/Code spawns it.
 * Boots `tsx src/mcp/server.ts` over stdio, then drives the three tools end-to-end with NO direct DB access:
 *   1. list_tools           → exactly the 3 tools, and NONE of the dropped read tools.
 *   2. query_brain          → a cited recommendation; we scrape a fact id + the logged decision id from its text.
 *   3. get_provenance(fact) → the fact's verbatim quote + source (the receipts).
 *   4. resolve_decision(id) → records the verdict and folds it back into memory.
 * That the fact id + decision id are recoverable from query_brain ALONE is the point: the 3-tool surface is
 * self-sufficient — no list tools needed.
 *
 * PREREQ: the DB is seeded and NO other process holds .data/ (PGlite is single-process — stop the web UI first).
 *   rm -rf .data/brain && npm run seed && npm run test:mcp
 */
const EXPECTED = ["query_brain", "get_provenance", "resolve_decision"].sort();
const DROPPED = ["get_position", "list_signals", "list_contradictions", "list_decisions"];
const Q = "What runway can I defend in this week's investor update?";

let pass = 0,
  fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
};

async function main() {
  const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/mcp/server.ts"] });
  const client = new Client({ name: "mcp-test", version: "0.1.0" });
  await client.connect(transport);
  console.log("connected to decision-brain over stdio\n");

  // 1 — exactly the three tools.
  console.log("1. list_tools");
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check(`exactly 3 tools [${EXPECTED.join(", ")}]`, JSON.stringify(tools) === JSON.stringify(EXPECTED), tools.join(", "));
  for (const d of DROPPED) check(`dropped tool '${d}' is gone`, !tools.includes(d));

  // 2 — the whole agent behind one call.
  console.log("\n2. query_brain");
  const r1 = await client.callTool({ name: "query_brain", arguments: { question: Q } });
  const text = (r1.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
  check("returned a recommendation", /Recommended next action/i.test(text));
  check("returned a confidence band", /Confidence:\s*(low|medium|high)/i.test(text));
  const factId = text.match(/\[(fact[^\]]+)\]/)?.[1] ?? null;
  const decId = text.match(/Decision logged:\s*(\S+)/)?.[1] ?? null;
  check("a fact id is recoverable from the output", !!factId, factId ?? "none");
  check("a decision id is recoverable from the output", !!decId, decId ?? "none");

  // 3 — the receipts.
  if (factId) {
    console.log("\n3. get_provenance");
    const r2 = await client.callTool({ name: "get_provenance", arguments: { fact_id: factId } });
    const ptext = (r2.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
    let prov: any = null;
    try {
      prov = JSON.parse(ptext);
    } catch {
      /* leave null */
    }
    check("provenance parsed", !!prov);
    check("has a verbatim quote", !!prov?.fact?.quote, prov?.fact?.quote ? `"${String(prov.fact.quote).slice(0, 60)}…"` : "");
    check("has a source id", !!prov?.source?.id, prov?.source?.id ?? "");
  }

  // 4 — close the loop.
  if (decId) {
    console.log("\n4. resolve_decision");
    const r3 = await client.callTool({
      name: "resolve_decision",
      arguments: { id: decId, verdict: "approved", note: "mcp-test: defensible with receipts" },
    });
    const rtext = (r3.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
    check("recorded + folded back into memory", /folded back into memory/i.test(rtext), rtext.trim());
  }

  await client.close();
  console.log(`\n${fail === 0 ? "✓ ALL PASS" : `✗ ${fail} FAILED`} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("mcp-test error:", e);
  process.exit(1);
});
