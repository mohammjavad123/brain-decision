import { buildSignals } from "./build.js";
import { insertSignal, insertEdge, currentFacts } from "../db/queries.js";
import { cosine } from "../llm/embed.js";
import { newId } from "../util.js";
import type { EntityMention } from "../ingest/pipeline.js";
import type { Signal } from "../schema/index.js";

/** Build signals, store them, and store scored fact→signal membership edges (P1: "stored edge with a similarity score"). */
export async function buildAndStoreSignals(
  mentions: EntityMention[],
  opts: { log?: (m: string) => void } = {},
): Promise<Signal[]> {
  const log = opts.log ?? (() => {});
  const facts = await currentFacts();
  const { signals, embeddingById, factVecById } = await buildSignals(facts, mentions);

  for (const s of signals) {
    const centroid = embeddingById.get(s.id)!;
    await insertSignal(s, centroid);
    for (const fid of s.fact_ids) {
      await insertEdge({
        id: newId("edge"),
        from_id: fid,
        predicate: "member_of",
        to_id: s.id,
        source_id: null,
        similarity: cosine(factVecById.get(fid)!, centroid),
      });
    }
  }

  const tiers = signals.reduce<Record<string, number>>((a, s) => ((a[s.promotion] = (a[s.promotion] ?? 0) + 1), a), {});
  log(`• signals: ${signals.length} — ${Object.entries(tiers).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  for (const s of signals.filter((s) => s.promotion === "validated" || s.promotion === "decision_grade")) {
    log(`    ★ ${s.promotion} [${s.type}] "${s.label}" — count ${s.count}, ${s.companies.length} companies`);
  }
  return signals;
}
