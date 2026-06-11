import { EntityType, FactType, EvidenceTier } from "../schema/index.js";
import type { ExtractionResult, Fact, Source } from "../schema/index.js";
import { loadCorpus } from "./loadCorpus.js";
import { extractFromSource } from "./extract.js";
import { embed } from "../llm/embed.js";
import { insertSource, insertFact, sourceExistsByHash, insertMention, insertRelationship } from "../db/queries.js";
import { newId, nowIso, normalizeWs } from "../util.js";
import { canonicalDimension } from "../dimension.js";

export type EntityMention = { name: string; type: EntityType; source_id: string };
export type Relationship = { subject: string; predicate: string; object: string; source_id: string };
export type IngestResult = {
  sourceCount: number;
  facts: Fact[];
  mentions: EntityMention[];
  relationships: Relationship[];
  rejectedQuotes: number;
};

/** The anti-hallucination guardrail: a fact's quote MUST exist in the source body. */
function locateQuote(body: string, quote: string): { start: number; end: number } | null {
  let idx = body.indexOf(quote);
  if (idx >= 0) return { start: idx, end: idx + quote.length };
  const nb = normalizeWs(body);
  const nq = normalizeWs(quote);
  idx = nb.indexOf(nq);
  if (idx >= 0) return { start: idx, end: idx + nq.length };
  return null;
}

/**
 * Deterministic dimension backstop. The LLM proposes a dimension; we canonicalize the recurring
 * themes so contradiction detection + signal grouping never depend on LLM tagging consistency.
 * (LLM at the seam proposes; an algorithm in the path canonicalizes.)
 */
// coerce free-string LLM enum outputs to the canonical vocabulary (a near-miss never drops a source)
const coerceType = (s: string): FactType => {
  const r = FactType.safeParse(s.trim().toLowerCase());
  return r.success ? r.data : "claim";
};
const coerceTier = (s: string): EvidenceTier => {
  const r = EvidenceTier.safeParse(s.trim().toUpperCase());
  return r.success ? r.data : "E2";
};
const coerceEntityType = (s: string): EntityType => {
  const r = EntityType.safeParse(s.trim().toLowerCase());
  return r.success ? r.data : "company";
};

/** Run async fn over items with bounded concurrency (so 12 extractions run in parallel, not serially). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

type Extracted = { s: Source; ex: ExtractionResult | null; err?: unknown };

/** Ingest the whole corpus from disk (the seed path). */
export async function ingest(opts: { log?: (m: string) => void } = {}): Promise<IngestResult> {
  return ingestSources(loadCorpus(), opts);
}

/**
 * Ingest a GIVEN set of sources — the same extract·verify·embed·store path as the corpus seed, but
 * driven by sources handed in (used by the Memory tab to ingest one pasted source live).
 */
export async function ingestSources(sources: Source[], opts: { log?: (m: string) => void } = {}): Promise<IngestResult> {
  const log = opts.log ?? (() => {});
  const now = nowIso();

  // skip already-ingested items by content hash (fast, sequential)
  const fresh: Source[] = [];
  for (const s of sources) {
    if (await sourceExistsByHash(s.hash)) log(`• ${s.id} — already ingested (hash match), skip`);
    else fresh.push(s);
  }

  // extract in PARALLEL (capped) — the slow LLM seam; concurrency turns minutes into seconds
  const extracted: Extracted[] = await mapLimit(fresh, 6, async (s) => {
    try {
      return { s, ex: await extractFromSource(s) };
    } catch (e) {
      return { s, ex: null, err: e };
    }
  });

  const facts: Fact[] = [];
  const mentions: EntityMention[] = [];
  const relationships: Relationship[] = [];
  let rejectedQuotes = 0;

  // store sequentially (DB writes are cheap and keep ordering clean)
  for (const { s, ex, err } of extracted) {
    if (!ex) {
      log(`  ✗ ${s.id} — extraction failed: ${String(err)}`);
      continue;
    }
    await insertSource(s);

    const built: Fact[] = [];
    for (const ef of ex.facts) {
      // reject junk quotes: too short to be a real citation (e.g. "x"), even if technically present.
      if (!ef.quote || ef.quote.trim().length < 12) {
        rejectedQuotes++;
        log(`  ✗ rejected (quote too short to cite): "${ef.quote}"`);
        continue;
      }
      const loc = locateQuote(s.body, ef.quote);
      if (!loc) {
        rejectedQuotes++;
        log(`  ✗ rejected (quote not in source): "${ef.quote.slice(0, 48)}…"`);
        continue;
      }
      built.push({
        id: newId("fact"),
        type: coerceType(ef.type),
        value: ef.value,
        quote: ef.quote,
        source_id: s.id,
        speaker: ef.speaker,
        location_start: loc.start,
        location_end: loc.end,
        confidence: ef.confidence,
        evidence_tier: coerceTier(ef.evidence_tier),
        dimension: canonicalDimension(`${ef.value} ${ef.quote}`, ef.dimension),
        qualifier: ef.qualifier,
        comparable: ef.comparable ? ef.comparable.trim().toLowerCase() : null,
        valid_time: s.date,
        learned_time: now,
        superseded_at: null,
      });
    }

    const vecs = await embed(built.map((f) => `${f.dimension ?? ""} ${f.value}`.trim()));
    for (let i = 0; i < built.length; i++) await insertFact(built[i]!, vecs[i]!);
    facts.push(...built);

    for (const e of ex.entities) {
      const m = { name: e.name, type: coerceEntityType(e.type), source_id: s.id };
      mentions.push(m);
      await insertMention(m); // persist so an incremental recompute sees every source's mentions
    }
    for (const r of ex.relationships) {
      const rel = { ...r, source_id: s.id };
      relationships.push(rel);
      await insertRelationship(rel);
    }
    log(`• ${s.id} — ${built.length} facts · ${ex.entities.length} entities · ${ex.relationships.length} relationships`);
  }

  return { sourceCount: sources.length, facts, mentions, relationships, rejectedQuotes };
}
