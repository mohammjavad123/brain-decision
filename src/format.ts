import type { Decision } from "./schema/index.js";

/** Human-readable decision brief — used by the CLI and the MCP `query_brain` tool. */
export function formatDecision(d: Decision): string {
  const L: string[] = [];
  L.push(`Q: ${d.question}`);
  L.push("");
  L.push(d.answer);
  L.push("");
  L.push(`Confidence: ${d.confidence}`);
  if (d.gaps.length) L.push(`Gaps / unknowns:\n` + d.gaps.map((g) => `  - ${g}`).join("\n"));
  L.push("");
  L.push(`Recommended next action (you decide):`);
  L.push(`  → ${d.recommendation}`);
  if (d.evidence.length) {
    L.push("");
    L.push(`Evidence — ${d.evidence.length} cited source${d.evidence.length === 1 ? "" : "s"}:`);
    for (const c of d.evidence) {
      L.push(`  • "${c.quote}"`);
      L.push(`      ↳ ${c.source_id}${c.speaker ? ` · ${c.speaker}` : ""}  [${c.fact_id}]`);
    }
  }
  L.push("");
  L.push(`Decision logged: ${d.id} · status: ${d.status}`);
  L.push(`(approve/reject:  npm run resolve ${d.id} approve|reject "note")`);
  return L.join("\n");
}
