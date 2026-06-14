import { seed } from "./seed.js";
import { answer } from "./answer/index.js";
import { formatDecision } from "./format.js";
import { resolveAndFold } from "./answer/closeLoop.js";
import { migrate } from "./db/migrate.js";
import { withTenant, DEFAULT_TENANT } from "./db/client.js";
import {
  listDecisions,
  getDecision,
  counts,
  currentPositions,
  currentSignals,
  currentContradictions,
} from "./db/queries.js";

const [, , cmd, ...rest] = process.argv;
const flags = rest.filter((r) => r.startsWith("--"));
const args = rest.filter((r) => !r.startsWith("--"));

function usage(): void {
  console.log(`decision-brain — a decision brain for a scaling CEO

  npm run seed [-- --reset]        build memory from data/corpus (write-time spine)
  npm run ask "<question>"         answer a CEO question (route → research gap → recommend)
  npm run decisions                show the append-only decision log
  npm run resolve <id> approve|reject ["note"]   record the human's call
  npm run inspect                  show what's in memory (counts, positions, signals, contradictions)
  npm run mcp                      start the MCP server (agent surface)`);
}

async function main(): Promise<void> {
  // `seed` does its own tenant handling (it migrates as the owner, then stamps the demo tenant).
  if (cmd === "seed") {
    await seed({ reset: flags.includes("--reset") });
    process.exit(0);
  }

  // Every other CLI command operates on the demo tenant, RLS-scoped — exactly like an authenticated demo
  // user. Without this, inserts would violate tenant_id NOT NULL, and reads (as superuser) would bypass RLS
  // and span every tenant. migrate() is idempotent and guarantees the app_user role + policies exist.
  await migrate();
  await withTenant(DEFAULT_TENANT, async () => {
  switch (cmd) {
    case "ask": {
      const q = args.join(" ").trim();
      if (!q) return usage();
      // pipeline logs go to stderr so the brief on stdout stays clean
      const { decision } = await answer(q, { log: (m) => console.error(m) });
      console.log("\n" + "─".repeat(72));
      console.log(formatDecision(decision));
      console.log("─".repeat(72));
      break;
    }

    case "decisions": {
      const ds = await listDecisions();
      if (ds.length === 0) {
        console.log("(decision log empty — run `npm run ask \"...\"` first)");
        break;
      }
      for (const d of ds) {
        console.log(`\n${d.id}  [${d.status}]  ${d.created_at}`);
        console.log(`  Q: ${d.question}`);
        console.log(`  → ${d.recommendation}`);
        console.log(`  confidence: ${d.confidence} · ${d.evidence.length} citations · ${d.gaps.length} gaps` +
          (d.human_note ? ` · note: ${d.human_note}` : ""));
      }
      break;
    }

    case "resolve": {
      const [id, verdict, ...note] = args;
      if (!id || (verdict !== "approve" && verdict !== "reject")) {
        console.log('usage: npm run resolve <decision_id> approve|reject ["note"]');
        break;
      }
      if (!(await getDecision(id))) {
        console.log(`No decision ${id}`);
        break;
      }
      await resolveAndFold(id, verdict === "approve" ? "approved" : "rejected", note.join(" ") || null);
      console.log(`Decision ${id} → ${verdict === "approve" ? "approved" : "rejected"} · folded back into memory`);
      break;
    }

    case "inspect": {
      const c = await counts();
      console.log("memory:", Object.entries(c).map(([k, v]) => `${k}=${v}`).join("  "));
      const positions = await currentPositions();
      console.log(`\npositions (${positions.length}):`);
      for (const p of positions) {
        console.log(`  • ${p.name} [confidence ${p.confidence}]  gaps: ${p.gaps.join("; ") || "none"}`);
        console.log(`    ${p.summary}`);
      }
      const signals = (await currentSignals()).filter((s) => s.promotion === "validated" || s.promotion === "decision_grade");
      console.log(`\nvalidated+ signals (${signals.length}):`);
      for (const s of signals) console.log(`  ★ [${s.promotion}] ${s.type}: "${s.label}" — count ${s.count}, ${s.companies.length} companies`);
      const contras = await currentContradictions();
      console.log(`\ncontradictions (${contras.length}):`);
      for (const x of contras) console.log(`  ⚠ [${x.kind}] ${x.note}`);
      break;
    }

    default:
      usage();
  }
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
