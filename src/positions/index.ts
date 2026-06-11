import { composePosition } from "./compose.js";
import {
  currentFacts,
  currentContradictions,
  currentSignals,
  insertPosition,
  insertEdge,
} from "../db/queries.js";
import { embed, embedOne, cosine } from "../llm/embed.js";
import { newId, nowIso } from "../util.js";
import type { Position } from "../schema/index.js";

/**
 * Positions answer Q1 (ICP) and Q3 (runway). They're compiled ONCE at write-time from validated
 * structure, then served deterministically. Q2 (objection) + competitor are answered straight from
 * Signals — no Position needed (we don't over-build).
 */
const TARGETS = [
  { name: "ICP", dimension: "icp" },
  { name: "runway", dimension: "runway" },
];

export async function composeAndStorePositions(opts: { log?: (m: string) => void } = {}): Promise<Position[]> {
  const log = opts.log ?? (() => {});
  const now = nowIso();
  const facts = await currentFacts();
  const contradictions = await currentContradictions();
  const signals = await currentSignals();

  const positions: Position[] = [];
  for (const t of TARGETS) {
    // ISOLATION: web-researched facts (source `web/…`, lower-tier) are scoped to the decision they
    // were fetched for — they must NEVER flow into a compiled position, or external research could
    // quietly degrade a first-party stance on re-derive.
    const dimFacts = facts.filter((f) => f.dimension === t.dimension && !f.source_id.startsWith("web/"));
    if (dimFacts.length === 0) {
      log(`• ${t.name} — no facts on dimension '${t.dimension}', skipping`);
      continue;
    }
    const dimContras = contradictions.filter((c) => c.dimension === t.dimension);
    const factIds = new Set(dimFacts.map((f) => f.id));
    const relSignals = signals.filter((s) => s.fact_ids.some((id) => factIds.has(id)));

    const composed = await composePosition(t.name, dimFacts, dimContras); // ← seam #2 (LLM)

    const pos: Position = {
      id: newId("pos"),
      name: t.name,
      summary: composed.summary,
      fields: composed.fields,
      signal_ids: relSignals.map((s) => s.id),
      contradiction_ids: dimContras.map((c) => c.id),
      confidence: composed.confidence,
      gaps: composed.gaps,
      valid_time: dimFacts.map((f) => f.valid_time).sort().at(-1)!,
      learned_time: now,
      compiled_at: now,
      superseded_at: null,
    };
    const posEmb = await embedOne(`${pos.name}: ${pos.summary}`);
    await insertPosition(pos, posEmb);

    // P1: every artifact→signal link is a STORED EDGE with a similarity score (not just an array ref).
    if (relSignals.length) {
      const sigEmbs = await embed(relSignals.map((s) => s.label));
      for (let i = 0; i < relSignals.length; i++) {
        await insertEdge({
          id: newId("edge"),
          from_id: pos.id,
          predicate: "composed_from",
          to_id: relSignals[i]!.id,
          source_id: null,
          similarity: cosine(posEmb, sigEmbs[i]!),
        });
      }
    }
    // position→contradiction links, also stored as edges
    for (const cid of pos.contradiction_ids) {
      await insertEdge({
        id: newId("edge"),
        from_id: pos.id,
        predicate: "addresses",
        to_id: cid,
        source_id: null,
        similarity: null,
      });
    }

    positions.push(pos);
    log(`• position '${pos.name}' — confidence ${pos.confidence}, ${relSignals.length} signal edge(s), ${pos.contradiction_ids.length} contradiction(s), gaps: [${pos.gaps.join("; ") || "none"}]`);
  }
  return positions;
}
