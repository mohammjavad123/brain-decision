/**
 * Deterministic smoke test — NO API KEY NEEDED.
 * Bypasses the two LLM seams by hand-feeding facts (as if extraction had run), then exercises the
 * whole algorithmic spine for real: DB round-trip (pgvector), entity resolution, contradiction
 * detection, clustering + promotion. Proves "algorithms in the path" works end-to-end on its own.
 *
 *   npm run smoke
 */
import { migrate } from "../src/db/migrate.js";
import { insertSource, insertFact, currentFacts } from "../src/db/queries.js";
import { embed } from "../src/llm/embed.js";
import { resolveEntities } from "../src/connect/resolve.js";
import { wireEdges } from "../src/connect/graph.js";
import { detectContradictions } from "../src/connect/contradict.js";
import { buildSignals } from "../src/signals/build.js";
import { newId, nowIso, sha256 } from "../src/util.js";
import type { Fact, EntityType } from "../src/schema/index.js";

const now = nowIso();
let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  cond ? pass++ : fail++;
};

type FactSeed = Partial<Fact> & Pick<Fact, "type" | "value" | "quote" | "source_id" | "evidence_tier">;
const mkFact = (s: FactSeed): Fact => ({
  id: newId("fact"), speaker: null, location_start: null, location_end: null,
  confidence: 0.9, dimension: null, qualifier: null, comparable: null, valid_time: now, learned_time: now,
  superseded_at: null,
  ...s,
});

async function run() {
  await migrate({ reset: true });

  const sources = [
    { id: "email/northpeak-update-may", type: "email" as const, date: "2026-05-28" },
    { id: "note/board-q2", type: "note" as const, date: "2026-06-05" },
    { id: "tweet/maya-0612", type: "tweet" as const, date: "2026-06-12" },
    { id: "doc/icp-onepager", type: "doc" as const, date: "2026-04-15" },
    { id: "call/acme-eval", type: "call" as const, date: "2026-06-03" },
    { id: "call/brightway", type: "call" as const, date: "2026-06-04" },
    { id: "call/delta-logix", type: "call" as const, date: "2026-06-02" },
  ];
  for (const s of sources) await insertSource({ ...s, author: null, participants: [], body: s.id, hash: sha256(s.id) });

  const facts: Fact[] = [
    mkFact({ type: "claim", dimension: "runway", comparable: "18 months", value: "runway = 18 months at current burn", quote: "x", source_id: "email/northpeak-update-may", evidence_tier: "E4", valid_time: "2026-05-28" }),
    mkFact({ type: "claim", dimension: "runway", comparable: "9 months", value: "runway = 9 months", qualifier: "after hiring 2 AEs", quote: "x", source_id: "note/board-q2", evidence_tier: "E4", valid_time: "2026-06-05" }),
    mkFact({ type: "claim", dimension: "icp", comparable: "mid_market", value: "ICP = mid-market self-serve", quote: "x", source_id: "tweet/maya-0612", evidence_tier: "E3", valid_time: "2026-06-12" }),
    mkFact({ type: "claim", dimension: "icp", comparable: "enterprise", value: "moving upmarket to enterprise", quote: "x", source_id: "email/northpeak-update-may", evidence_tier: "E3", valid_time: "2026-05-28" }),
    mkFact({ type: "claim", dimension: "icp", comparable: "mid_market", value: "ICP = mid-market self-serve operators", quote: "x", source_id: "doc/icp-onepager", evidence_tier: "E4", valid_time: "2026-04-15" }),
    mkFact({ type: "objection", dimension: "budget_authority", value: "cannot get budget approved mid-cycle", quote: "x", source_id: "call/acme-eval", evidence_tier: "E4" }),
    mkFact({ type: "objection", dimension: "budget_authority", value: "budget authority sits with the VP, locked until next cycle", quote: "x", source_id: "call/brightway", evidence_tier: "E4" }),
    mkFact({ type: "objection", dimension: "budget_authority", value: "budget is fine for a pilot, sign-off needed above that", quote: "x", source_id: "call/delta-logix", evidence_tier: "E3" }),
    mkFact({ type: "competitor", dimension: "competitor", value: "FreightPilot is the one we keep losing to", quote: "x", source_id: "call/acme-eval", evidence_tier: "E3" }),
    mkFact({ type: "competitor", dimension: "competitor", value: "losing to FreightPilot on procurement speed", quote: "x", source_id: "call/brightway", evidence_tier: "E3" }),
    mkFact({ type: "competitor", dimension: "competitor", value: "demoed FreightPilot too, close on ops automation", quote: "x", source_id: "call/delta-logix", evidence_tier: "E2" }),
  ];
  const vecs = await embed(facts.map((f) => `${f.dimension} ${f.value}`));
  for (let i = 0; i < facts.length; i++) await insertFact(facts[i]!, vecs[i]!);

  const stored = await currentFacts();
  check("DB round-trip: all facts stored & read back", stored.length === facts.length);

  const mentions = [
    { name: "Maya Chen", type: "person" as EntityType, source_id: "email/northpeak-update-may" },
    { name: "Jordan Rivera", type: "person" as EntityType, source_id: "call/acme-eval" },
    { name: "Acme Freight", type: "company" as EntityType, source_id: "call/acme-eval" },
    { name: "Acme", type: "company" as EntityType, source_id: "call/acme-eval" },
    { name: "FreightPilot", type: "competitor" as EntityType, source_id: "call/acme-eval" },
    { name: "Loomwork", type: "company" as EntityType, source_id: "doc/icp-onepager" },
  ];
  const entities = await resolveEntities(mentions, stored);
  const acme = entities.find((e) => e.name.toLowerCase().includes("acme"));
  check("entity resolution: 'Acme' folds into 'Acme Freight' (one node)", entities.filter((e) => e.name.toLowerCase().includes("acme")).length === 1 && !!acme?.aliases.includes("Acme"));

  const edges = wireEdges([{ subject: "FreightPilot", predicate: "competes_with", object: "Loomwork", source_id: "call/acme-eval" }], entities);
  check("edge wiring: FreightPilot →competes_with→ Loomwork", edges.length === 1);

  const contradictions = detectContradictions(stored);
  const runwayC = contradictions.find((c) => c.dimension === "runway");
  const icpC = contradictions.find((c) => c.dimension === "icp");
  check("contradiction: runway 18 vs 9 detected", !!runwayC);
  check("contradiction: runway classified 'conditional' (qualifier-aware)", runwayC?.kind === "conditional");
  check("contradiction: ICP drift detected (mid-market vs enterprise)", !!icpC);
  check("contradiction: ICP classified 'drift' (time-aware)", icpC?.kind === "drift");

  const { signals } = await buildSignals(stored, mentions);
  const budget = signals.find((s) => s.type === "objection");
  const comp = signals.find((s) => s.type === "competitor");
  check("signal: budget objection clusters 3 facts", (budget?.count ?? 0) === 3);
  check("signal: budget objection promoted to validated+ (≥3 companies)", budget?.promotion === "validated" || budget?.promotion === "decision_grade");
  check("signal: FreightPilot competitor clusters 3 facts", (comp?.count ?? 0) === 3);

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
