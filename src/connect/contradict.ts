import type { Contradiction, ContradictionKind, Fact } from "../schema/index.js";
import { newId, nowIso } from "../util.js";

/**
 * Contradiction DETECTION — DETERMINISTIC, no regex, no keyword lists. The parsing/normalizing
 * happened at the seam: the LLM emitted a canonical `comparable` token per fact ("18 months",
 * "mid_market", …). Here we only COMPARE: facts on the same `dimension` whose `comparable` values
 * differ are a contradiction. `kind` is set from the qualifier (conditional) or the valid_time gap
 * (drift). The LLM never JUDGES a contradiction — it only normalizes; we compare.
 *
 * Production path (named in the design note): swap this for an NLI model or LLM-judge to catch
 * free-text/semantic contradictions that don't reduce to a comparable token.
 */
function classify(a: Fact, b: Fact): ContradictionKind {
  if (a.qualifier || b.qualifier) return "conditional";
  const days = Math.abs(new Date(a.valid_time).getTime() - new Date(b.valid_time).getTime()) / 86_400_000;
  if (days > 14) return "drift";
  return "direct";
}

// representative fact of a value-group: strongest evidence tier, then confidence
function rep(group: Fact[]): Fact {
  return [...group].sort(
    (a, b) => b.evidence_tier.localeCompare(a.evidence_tier) || b.confidence - a.confidence,
  )[0]!;
}

// Contradictions are meaningful only on POSITION dimensions — the axes the brain tracks as one stance
// over time (runway, ICP, pricing). SIGNAL dimensions (objection/competitor/pain) accumulate corroborating
// evidence; differing values there are not conflicts. Restricting here keeps detection robust to an
// over-eager extractor that tags many facts with a `comparable`.
const POSITION_DIMENSIONS = new Set(["runway", "icp", "pricing"]);

export function detectContradictions(facts: Fact[]): Contradiction[] {
  const now = nowIso();
  const out: Contradiction[] = [];

  // group facts by dimension (only position dims, and only those the LLM gave a comparable value)
  const byDim = new Map<string, Fact[]>();
  for (const f of facts) {
    if (!f.dimension || !f.comparable || !POSITION_DIMENSIONS.has(f.dimension)) continue;
    (byDim.get(f.dimension) ?? byDim.set(f.dimension, []).get(f.dimension)!).push(f);
  }

  for (const [dim, fs] of byDim) {
    // group by the canonical comparable token
    const groups = new Map<string, Fact[]>();
    for (const f of fs) {
      const k = f.comparable!; // already normalized (lowercased) at ingest
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
    }
    if (groups.size < 2) continue; // one value on this dimension = no conflict

    // Contrast only the TWO best-supported comparable groups — the HEADLINE conflict on this dimension
    // (e.g. runway 18mo vs 9mo) — instead of every pair, which explodes when a model over-tags comparables.
    const ranked = [...groups.values()].sort(
      (x, y) => y.length - x.length || rep(y).evidence_tier.localeCompare(rep(x).evidence_tier) || rep(y).confidence - rep(x).confidence,
    );
    const a = rep(ranked[0]!);
    const b = rep(ranked[1]!);
    const kind = classify(a, b);
    const cond = a.qualifier ?? b.qualifier;
    const note =
      `${dim}: "${a.value}" (${a.source_id}) vs "${b.value}" (${b.source_id})` +
      (kind === "conditional" && cond ? ` — conditional on: ${cond}` : "");
    out.push({ id: newId("contra"), dimension: dim, fact_a: a.id, fact_b: b.id, kind, note, status: "open", learned_time: now });
  }
  return out;
}
