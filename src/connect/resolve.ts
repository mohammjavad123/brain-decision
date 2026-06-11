import type { Entity, EntityType, Fact } from "../schema/index.js";
import type { EntityMention } from "../ingest/pipeline.js";
import { newId } from "../util.js";
import { embed, cosine } from "../llm/embed.js";

/**
 * Entity resolution — DETERMINISTIC, two passes, no LLM:
 *   Pass 1 (exact/structural): normalize + token-containment ("Acme" folds into "Acme Freight").
 *   Pass 2 (semantic): embed each candidate name and merge same-type entities whose embeddings are
 *   very close — so we resolve by MEANING, not just string overlap (answers "not three string-matches").
 * Conservative threshold avoids false merges. The LLM would only be needed to adjudicate genuinely
 * ambiguous pairs (named as the next step in the design note).
 */
const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const SIM_THRESHOLD = 0.9; // cosine on "type: name"; high so only near-identical names merge
                           // (the token pass already catches "Acme"→"Acme Freight"; this is the safety net)

type Node = { canonical: string; type: EntityType; surfaces: Set<string>; tokens: Set<string> };

export async function resolveEntities(mentions: EntityMention[], facts: Fact[]): Promise<Entity[]> {
  const raw: { name: string; type: EntityType }[] = mentions.map((m) => ({ name: m.name, type: m.type }));
  for (const f of facts) if (f.speaker) raw.push({ name: f.speaker, type: "person" });

  // ── Pass 1: group by (type, normName) + token-containment merge ──
  const groups = new Map<string, Node>();
  for (const { name, type } of raw) {
    const n = norm(name);
    if (!n) continue;
    const key = `${type}:${n}`;
    let g = groups.get(key);
    if (!g) {
      g = { canonical: name, type, surfaces: new Set(), tokens: new Set(n.split(" ")) };
      groups.set(key, g);
    }
    g.surfaces.add(name);
    if (name.length > g.canonical.length) g.canonical = name;
  }
  const sorted = [...groups.values()].sort((a, b) => b.tokens.size - a.tokens.size);
  const nodes: Node[] = [];
  for (const n of sorted) {
    const host = nodes.find((m) => m.type === n.type && [...n.tokens].every((t) => m.tokens.has(t)));
    if (host) n.surfaces.forEach((s) => host.surfaces.add(s));
    else nodes.push(n);
  }

  // ── Pass 2: semantic merge by embedding (catches paraphrases string-match misses) ──
  const vecs = await embed(nodes.map((n) => `${n.type}: ${n.canonical}`));
  const parent = nodes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i]!.type === nodes[j]!.type && cosine(vecs[i]!, vecs[j]!) >= SIM_THRESHOLD) {
        parent[find(i)] = find(j);
      }
    }
  }

  const merged = new Map<number, Node[]>();
  for (let i = 0; i < nodes.length; i++) {
    const r = find(i);
    (merged.get(r) ?? merged.set(r, []).get(r)!).push(nodes[i]!);
  }

  return [...merged.values()].map((group) => {
    const surfaces = [...new Set(group.flatMap((n) => [...n.surfaces]))];
    const canonical = surfaces.sort((a, b) => b.length - a.length)[0]!;
    return {
      id: newId("ent"),
      name: canonical,
      type: group[0]!.type,
      aliases: surfaces.filter((s) => s !== canonical),
    };
  });
}
