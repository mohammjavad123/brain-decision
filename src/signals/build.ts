import type { Fact, FactType, Signal } from "../schema/index.js";
import type { EntityMention } from "../ingest/pipeline.js";
import { embed, cosine } from "../llm/embed.js";
import { newId, nowIso } from "../util.js";

/**
 * Signals — DETERMINISTIC, no LLM. "Learnings that mean the same thing — by embedding proximity,
 * not keywords — cluster into a signal." Promotion is pure thresholds; promotion never demotes.
 */
const CLUSTER_THRESHOLD = 0.55; // cosine; primary clustering signal (embedding proximity). Tunable.
const CLUSTER_THRESHOLD_DIM = 0.4; // relaxed bar when two facts share a dimension (recall aid)
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
const STOP_COMPANIES = new Set(["loomwork", "freightpilot"]); // us + the competitor aren't "the customer"

function promotionFor(count: number, companies: number): Signal["promotion"] {
  if (count >= 3 && companies >= 3) return "decision_grade";
  if (count >= 3 && companies >= 2) return "validated";
  if (count >= 2) return "emerging";
  return "candidate";
}

function rep(group: Fact[]): Fact {
  return [...group].sort(
    (a, b) => b.evidence_tier.localeCompare(a.evidence_tier) || b.confidence - a.confidence,
  )[0]!;
}
function average(vecs: number[][]): number[] {
  const d = vecs[0]!.length;
  const out = new Array<number>(d).fill(0);
  for (const v of vecs) for (let i = 0; i < d; i++) out[i]! += v[i]!;
  return out.map((x) => x / vecs.length);
}

export type SignalBuild = {
  signals: Signal[];
  embeddingById: Map<string, number[]>; // signal id → centroid (for storage + routing)
  factVecById: Map<string, number[]>; // fact id → vector (for scored membership edges)
};

export async function buildSignals(facts: Fact[], mentions: EntityMention[]): Promise<SignalBuild> {
  const now = nowIso();

  // best-effort company per source (for the evidence bar); fall back to the source slug
  const companyBySource = new Map<string, string>();
  for (const m of mentions) {
    if (m.type !== "company" || STOP_COMPANIES.has(norm(m.name))) continue;
    if (!companyBySource.has(m.source_id)) companyBySource.set(m.source_id, m.name);
  }
  const companyOf = (sid: string) => companyBySource.get(sid) ?? sid.split("/").pop() ?? sid;

  // embed every fact's claim
  const vecs = await embed(facts.map((f) => `${f.dimension ?? ""} ${f.value}`.trim()));
  const factVecById = new Map(facts.map((f, i) => [f.id, vecs[i]!] as const));

  // Signals are CUSTOMER evidence. Internal assertions (type 'claim' — runway, ICP) are NOT signals;
  // they compile into Positions instead. Excluding them keeps the promotion ladder meaningful.
  const signalFacts = facts.filter((f) => f.type !== "claim");

  const byType = new Map<FactType, Fact[]>();
  for (const f of signalFacts) (byType.get(f.type) ?? byType.set(f.type, []).get(f.type)!).push(f);

  const signals: Signal[] = [];
  const embeddingById = new Map<string, number[]>();

  for (const [type, fs] of byType) {
    // Embedding-PRIMARY clustering ("by embedding proximity, not keywords"): a fact joins a cluster
    // when it's close enough to the seed. Sharing a dimension only RELAXES the threshold (recall aid),
    // so e.g. budget_authority objections phrased differently still land together.
    const clusters: Fact[][] = [];
    for (const f of fs) {
      const v = factVecById.get(f.id)!;
      const hit = clusters.find((cl) => {
        const seed = cl[0]!;
        const sameDim = !!f.dimension && f.dimension === seed.dimension;
        return cosine(v, factVecById.get(seed.id)!) >= (sameDim ? CLUSTER_THRESHOLD_DIM : CLUSTER_THRESHOLD);
      });
      if (hit) hit.push(f);
      else clusters.push([f]);
    }
    for (const cl of clusters) {
      const companies = [...new Set(cl.map((f) => companyOf(f.source_id)))];
      const id = newId("sig");
      signals.push({
        id,
        type,
        label: rep(cl).value,
        fact_ids: cl.map((f) => f.id),
        count: cl.length,
        companies,
        last_confirmed: cl.map((f) => f.valid_time).sort().at(-1)!,
        promotion: promotionFor(cl.length, companies.length),
        learned_time: now,
        superseded_at: null,
      });
      embeddingById.set(id, average(cl.map((f) => factVecById.get(f.id)!)));
    }
  }
  return { signals, embeddingById, factVecById };
}
