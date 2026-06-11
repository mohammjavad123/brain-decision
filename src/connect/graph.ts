import type { Edge, Entity } from "../schema/index.js";
import type { Relationship } from "../ingest/pipeline.js";
import { newId } from "../util.js";

/**
 * Wire the relationship edges the LLM surfaced at extraction onto canonical entity ids.
 * Deterministic ("Deterministically wire people · companies · deals into a typed graph").
 */
const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export function wireEdges(relationships: Relationship[], entities: Entity[]): Edge[] {
  const lookup = new Map<string, string>();
  for (const e of entities) {
    lookup.set(norm(e.name), e.id);
    for (const a of e.aliases) lookup.set(norm(a), e.id);
  }
  const resolve = (name: string): string | null => {
    const n = norm(name);
    if (lookup.has(n)) return lookup.get(n)!;
    for (const [k, id] of lookup) if (k.includes(n) || n.includes(k)) return id; // containment fallback
    return null;
  };

  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const r of relationships) {
    const from = resolve(r.subject);
    const to = resolve(r.object);
    if (!from || !to || from === to) continue;
    const key = `${from}|${r.predicate}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: newId("edge"),
      from_id: from,
      predicate: r.predicate,
      to_id: to,
      source_id: r.source_id,
      similarity: null,
    });
  }
  return edges;
}
