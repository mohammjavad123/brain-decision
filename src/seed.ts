import { migrate } from "./db/migrate.js";
import { ingest } from "./ingest/pipeline.js";
import { connect } from "./connect/index.js";
import { buildAndStoreSignals } from "./signals/index.js";
import { composeAndStorePositions } from "./positions/index.js";

/**
 * The whole write-time spine, in order. One command builds the memory from the corpus:
 *   migrate → ingest (extract·verify·embed) → connect (resolve·wire·contradict) → signals → positions
 */
export async function seed(opts: { reset?: boolean; log?: (m: string) => void } = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));

  log("→ migrate");
  await migrate({ reset: opts.reset });

  log("→ ingest  (extract → verify quote → embed → store)");
  const ing = await ingest({ log });
  log(`  ${ing.facts.length} facts from ${ing.sourceCount} sources` + (ing.rejectedQuotes ? ` · ${ing.rejectedQuotes} rejected for unverifiable quotes` : ""));

  log("→ connect (resolve entities · wire edges · detect contradictions)");
  await connect(ing, { log });

  log("→ signals (cluster by meaning · promote)");
  await buildAndStoreSignals(ing.mentions, { log });

  log("→ positions (compose drift-aware stances)");
  await composeAndStorePositions({ log });

  log("✓ seed complete — memory built.");
}
