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
    // fallback: WHOLE-TOKEN containment only (one name's tokens ⊆ the other's), and skip very short names —
    // so a partial like "ai" can't substring-match an unrelated entity ("N-ai-r"). "Acme" → "Acme Freight" still resolves.
    if (n.length < 3) return null;
    const nTok = n.split(" ");
    const subset = (a: string[], b: string[]) => a.every((t) => b.includes(t));
    for (const [k, id] of lookup) {
      const kTok = k.split(" ");
      if (subset(nTok, kTok) || subset(kTok, nTok)) return id;
    }
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
