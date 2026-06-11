import { resolveEntities } from "./resolve.js";
import { wireEdges } from "./graph.js";
import { detectContradictions } from "./contradict.js";
import { insertEntity, insertEdge, insertContradiction, currentFacts } from "../db/queries.js";
import type { IngestResult } from "../ingest/pipeline.js";

/** Connect the dots — all deterministic. Resolve entities, wire edges, detect contradictions. */
export async function connect(ing: IngestResult, opts: { log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const facts = await currentFacts();

  const entities = await resolveEntities(ing.mentions, facts);
  for (const e of entities) await insertEntity(e);

  const edges = wireEdges(ing.relationships, entities);
  for (const e of edges) await insertEdge(e);

  const contradictions = detectContradictions(facts);
  for (const c of contradictions) await insertContradiction(c);

  log(`• entities: ${entities.length} · edges: ${edges.length} · contradictions: ${contradictions.length}`);
  for (const c of contradictions) log(`    ⚠ ${c.kind}: ${c.note}`);
  return { entities, edges, contradictions };
}
