/**
 * The data-access layer = "algorithms in the path." Every read here is pure SQL (no LLM).
 * Writes are append-only: nothing is ever DELETEd or destructively UPDATEd; superseding sets a
 * `superseded_at` tombstone so "what did we believe, and when?" stays a query (bi-temporal).
 */
import { getDb, toVec } from "./client.js";
import { newId } from "../util.js";
import type {
  Source,
  Fact,
  Entity,
  Edge,
  Signal,
  Contradiction,
  Position,
  Decision,
  Citation,
} from "../schema/index.js";
import type { EntityMention, Relationship } from "../ingest/pipeline.js";

type Row = Record<string, any>;
async function q(sql: string, params: any[] = []): Promise<Row[]> {
  const db = await getDb();
  const res = await db.query(sql, params);
  return res.rows as Row[];
}

// ─── Row mappers ──────────────────────────────────────────────────────────────
const asArr = (v: any): any[] => (Array.isArray(v) ? v : v ? JSON.parse(v) : []);

const toSource = (r: Row): Source => ({
  id: r.id, type: r.type, date: r.date, author: r.author ?? null,
  participants: asArr(r.participants), body: r.body, hash: r.hash,
});
const toFact = (r: Row): Fact => ({
  id: r.id, type: r.type, value: r.value, quote: r.quote, source_id: r.source_id,
  speaker: r.speaker ?? null, location_start: r.location_start ?? null, location_end: r.location_end ?? null,
  confidence: r.confidence, evidence_tier: r.evidence_tier, dimension: r.dimension ?? null,
  qualifier: r.qualifier ?? null, comparable: r.comparable ?? null,
  valid_time: r.valid_time, learned_time: r.learned_time, superseded_at: r.superseded_at ?? null,
});
const toEntity = (r: Row): Entity => ({ id: r.id, name: r.name, type: r.type, aliases: asArr(r.aliases) });
const toEdge = (r: Row): Edge => ({
  id: r.id, from_id: r.from_id, predicate: r.predicate, to_id: r.to_id,
  source_id: r.source_id ?? null, similarity: r.similarity ?? null,
});
const toSignal = (r: Row): Signal => ({
  id: r.id, type: r.type, label: r.label, fact_ids: asArr(r.fact_ids), count: r.count,
  companies: asArr(r.companies), last_confirmed: r.last_confirmed, promotion: r.promotion,
  learned_time: r.learned_time, superseded_at: r.superseded_at ?? null,
});
const toContradiction = (r: Row): Contradiction => ({
  id: r.id, dimension: r.dimension, fact_a: r.fact_a, fact_b: r.fact_b, kind: r.kind,
  note: r.note, status: r.status, learned_time: r.learned_time,
});
const toPosition = (r: Row): Position => ({
  id: r.id, name: r.name, summary: r.summary, fields: asArr(r.fields), signal_ids: asArr(r.signal_ids),
  contradiction_ids: asArr(r.contradiction_ids), confidence: r.confidence, gaps: asArr(r.gaps),
  valid_time: r.valid_time, learned_time: r.learned_time, compiled_at: r.compiled_at,
  superseded_at: r.superseded_at ?? null,
});
const toDecision = (r: Row): Decision => ({
  id: r.id, question: r.question, answer: r.answer, confidence: r.confidence,
  evidence: asArr(r.evidence) as Citation[], contradiction_ids: asArr(r.contradiction_ids),
  research_fact_ids: asArr(r.research_fact_ids), gaps: asArr(r.gaps), recommendation: r.recommendation,
  status: r.status, human_note: r.human_note ?? null, created_at: r.created_at, resolved_at: r.resolved_at ?? null,
});

// ─── Writes (append-only) ───────────────────────────────────────────────────────
export async function insertSource(s: Source): Promise<void> {
  await q(
    `INSERT INTO sources (id,type,date,author,participants,body,hash)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT (id) DO NOTHING`,
    [s.id, s.type, s.date, s.author, JSON.stringify(s.participants), s.body, s.hash],
  );
}
export async function sourceExistsByHash(hash: string): Promise<boolean> {
  return (await q(`SELECT 1 FROM sources WHERE hash=$1 LIMIT 1`, [hash])).length > 0;
}

export async function insertFact(f: Fact, embedding: number[]): Promise<void> {
  await q(
    `INSERT INTO facts (id,type,value,quote,source_id,speaker,location_start,location_end,
       confidence,evidence_tier,dimension,qualifier,comparable,valid_time,learned_time,superseded_at,embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::vector)`,
    [f.id, f.type, f.value, f.quote, f.source_id, f.speaker, f.location_start, f.location_end,
     f.confidence, f.evidence_tier, f.dimension, f.qualifier, f.comparable, f.valid_time, f.learned_time,
     f.superseded_at, toVec(embedding)],
  );
}

export async function insertEntity(e: Entity): Promise<void> {
  await q(`INSERT INTO entities (id,name,type,aliases) VALUES ($1,$2,$3,$4::jsonb)
           ON CONFLICT (id) DO UPDATE SET aliases=$4::jsonb, name=$2`,
    [e.id, e.name, e.type, JSON.stringify(e.aliases)]);
}

// raw extraction outputs — persisted so the compiled layer can be recomputed from ALL sources
export async function insertMention(m: EntityMention): Promise<void> {
  await q(`INSERT INTO mentions (id,name,type,source_id) VALUES ($1,$2,$3,$4)`, [newId("mention"), m.name, m.type, m.source_id]);
}
export async function insertRelationship(r: Relationship): Promise<void> {
  await q(`INSERT INTO relationships (id,subject,predicate,object,source_id) VALUES ($1,$2,$3,$4,$5)`,
    [newId("rel"), r.subject, r.predicate, r.object, r.source_id]);
}
export const allMentions = async (): Promise<EntityMention[]> =>
  (await q(`SELECT name,type,source_id FROM mentions`)).map((r) => ({ name: r.name, type: r.type, source_id: r.source_id }));
export const allRelationships = async (): Promise<Relationship[]> =>
  (await q(`SELECT subject,predicate,object,source_id FROM relationships`)).map((r) => ({ subject: r.subject, predicate: r.predicate, object: r.object, source_id: r.source_id }));

export async function insertEdge(e: Edge): Promise<void> {
  await q(`INSERT INTO edges (id,from_id,predicate,to_id,source_id,similarity)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
    [e.id, e.from_id, e.predicate, e.to_id, e.source_id, e.similarity]);
}

export async function insertSignal(s: Signal, embedding: number[]): Promise<void> {
  await q(
    `INSERT INTO signals (id,type,label,fact_ids,count,companies,last_confirmed,promotion,learned_time,superseded_at,embedding)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10,$11::vector)`,
    [s.id, s.type, s.label, JSON.stringify(s.fact_ids), s.count, JSON.stringify(s.companies),
     s.last_confirmed, s.promotion, s.learned_time, s.superseded_at, toVec(embedding)],
  );
}

export async function insertContradiction(c: Contradiction): Promise<void> {
  await q(`INSERT INTO contradictions (id,dimension,fact_a,fact_b,kind,note,status,learned_time)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [c.id, c.dimension, c.fact_a, c.fact_b, c.kind, c.note, c.status, c.learned_time]);
}

export async function insertPosition(p: Position, embedding: number[]): Promise<void> {
  await q(
    `INSERT INTO positions (id,name,summary,fields,signal_ids,contradiction_ids,confidence,gaps,
       valid_time,learned_time,compiled_at,superseded_at,embedding)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$13::vector)`,
    [p.id, p.name, p.summary, JSON.stringify(p.fields), JSON.stringify(p.signal_ids),
     JSON.stringify(p.contradiction_ids), p.confidence, JSON.stringify(p.gaps),
     p.valid_time, p.learned_time, p.compiled_at, p.superseded_at, toVec(embedding)],
  );
}

/**
 * Wipe the COMPILED layer — entities, edges, signals, contradictions, positions — so an INCREMENTAL
 * ingest can recompute it deterministically from all current facts. Sources, facts, and decisions
 * (the append-only memory + the human verdicts) are preserved. The seed path doesn't need this (it
 * does a full `migrate --reset`); the live Memory-tab ingest does, or the derived rows would double.
 */
export async function clearCompiled(): Promise<void> {
  await q(`DELETE FROM positions`);
  await q(`DELETE FROM contradictions`);
  await q(`DELETE FROM signals`);
  await q(`DELETE FROM edges`);
  await q(`DELETE FROM entities`);
}

export async function insertDecision(d: Decision): Promise<void> {
  await q(
    `INSERT INTO decisions (id,question,answer,confidence,evidence,contradiction_ids,research_fact_ids,
       gaps,recommendation,status,human_note,created_at,resolved_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13)`,
    [d.id, d.question, d.answer, d.confidence, JSON.stringify(d.evidence),
     JSON.stringify(d.contradiction_ids), JSON.stringify(d.research_fact_ids), JSON.stringify(d.gaps),
     d.recommendation, d.status, d.human_note, d.created_at, d.resolved_at],
  );
}

// ─── Supersede (append-only invalidation, never destroy) ─────────────────────────
export async function supersede(table: "facts" | "signals" | "positions", id: string, at: string): Promise<void> {
  await q(`UPDATE ${table} SET superseded_at=$2 WHERE id=$1 AND superseded_at IS NULL`, [id, at]);
}

// ─── Reads (the 5 patterns — all SQL, no LLM) ────────────────────────────────────

// lookup
export async function getSource(id: string): Promise<Source | null> {
  const r = await q(`SELECT * FROM sources WHERE id=$1`, [id]);
  return r[0] ? toSource(r[0]) : null;
}
export const allSources = async (): Promise<Source[]> =>
  (await q(`SELECT * FROM sources ORDER BY date`)).map(toSource);
export async function getFact(id: string): Promise<Fact | null> {
  const r = await q(`SELECT * FROM facts WHERE id=$1`, [id]);
  return r[0] ? toFact(r[0]) : null;
}
export async function getFacts(ids: string[]): Promise<Fact[]> {
  if (ids.length === 0) return [];
  const r = await q(`SELECT * FROM facts WHERE id = ANY($1)`, [ids]);
  return r.map(toFact);
}

// current views (bi-temporal: only what we believe now)
export const currentFacts = async (): Promise<Fact[]> =>
  (await q(`SELECT * FROM facts WHERE superseded_at IS NULL ORDER BY valid_time`)).map(toFact);
export const factsByDimension = async (dim: string): Promise<Fact[]> =>
  (await q(`SELECT * FROM facts WHERE dimension=$1 AND superseded_at IS NULL ORDER BY valid_time`, [dim])).map(toFact);
export const factsByType = async (t: string): Promise<Fact[]> =>
  (await q(`SELECT * FROM facts WHERE type=$1 AND superseded_at IS NULL`, [t])).map(toFact);

// time-travel: what did we believe at instant T?
export const factsAsOf = async (t: string): Promise<Fact[]> =>
  (await q(
    `SELECT * FROM facts WHERE learned_time <= $1 AND (superseded_at IS NULL OR superseded_at > $1)`,
    [t],
  )).map(toFact);

// similarity (pgvector ANN — cosine). The query that scales; not a JS recompute.
export async function similarFacts(embedding: number[], k = 8): Promise<{ fact: Fact; distance: number }[]> {
  const r = await q(
    `SELECT *, embedding <=> $1::vector AS distance FROM facts
     WHERE superseded_at IS NULL ORDER BY distance ASC LIMIT $2`,
    [toVec(embedding), k],
  );
  return r.map((row) => ({ fact: toFact(row), distance: row.distance }));
}
export async function similarPositions(embedding: number[], k = 3): Promise<{ position: Position; distance: number }[]> {
  const r = await q(
    `SELECT *, embedding <=> $1::vector AS distance FROM positions
     WHERE superseded_at IS NULL ORDER BY distance ASC LIMIT $2`,
    [toVec(embedding), k],
  );
  return r.map((row) => ({ position: toPosition(row), distance: row.distance }));
}
export async function similarSignals(embedding: number[], k = 5): Promise<{ signal: Signal; distance: number }[]> {
  const r = await q(
    `SELECT *, embedding <=> $1::vector AS distance FROM signals
     WHERE superseded_at IS NULL ORDER BY distance ASC LIMIT $2`,
    [toVec(embedding), k],
  );
  return r.map((row) => ({ signal: toSignal(row), distance: row.distance }));
}

// raw fact embeddings (for the dashboard's semantic-search demo — cast to text so we can parse the
// pgvector literal "[a,b,...]" as JSON). Not used in the hot path; the path uses similarFacts (ANN).
export async function factEmbeddings(): Promise<{ id: string; embedding: number[] }[]> {
  const r = await q(`SELECT id, embedding::text AS embedding FROM facts WHERE superseded_at IS NULL`);
  return r.map((row) => ({ id: row.id, embedding: JSON.parse(row.embedding) as number[] }));
}

// entities + edges (graph traversal)
export const allEntities = async (): Promise<Entity[]> => (await q(`SELECT * FROM entities`)).map(toEntity);
export const allEdges = async (): Promise<Edge[]> => (await q(`SELECT * FROM edges`)).map(toEdge);
export const edgesFrom = async (id: string): Promise<Edge[]> =>
  (await q(`SELECT * FROM edges WHERE from_id=$1`, [id])).map(toEdge);
export const edgesTo = async (id: string): Promise<Edge[]> =>
  (await q(`SELECT * FROM edges WHERE to_id=$1`, [id])).map(toEdge);

// signals / contradictions / positions
export const currentSignals = async (): Promise<Signal[]> =>
  (await q(`SELECT * FROM signals WHERE superseded_at IS NULL ORDER BY count DESC`)).map(toSignal);
export const currentContradictions = async (): Promise<Contradiction[]> =>
  (await q(`SELECT * FROM contradictions ORDER BY learned_time`)).map(toContradiction);
export const currentPositions = async (): Promise<Position[]> =>
  (await q(`SELECT * FROM positions WHERE superseded_at IS NULL`)).map(toPosition);
export async function getPositionByName(name: string): Promise<Position | null> {
  const r = await q(`SELECT * FROM positions WHERE name=$1 AND superseded_at IS NULL LIMIT 1`, [name]);
  return r[0] ? toPosition(r[0]) : null;
}

// provenance walk: fact → its source quote
export async function provenanceForFact(id: string): Promise<{ fact: Fact; source: Source } | null> {
  const fact = await getFact(id);
  if (!fact) return null;
  const source = await getSource(fact.source_id);
  if (!source) return null;
  return { fact, source };
}

// decisions
export const listDecisions = async (): Promise<Decision[]> =>
  (await q(`SELECT * FROM decisions ORDER BY created_at DESC`)).map(toDecision);
export async function getDecision(id: string): Promise<Decision | null> {
  const r = await q(`SELECT * FROM decisions WHERE id=$1`, [id]);
  return r[0] ? toDecision(r[0]) : null;
}
export async function resolveDecision(id: string, verdict: "approved" | "rejected", note: string | null, at: string): Promise<void> {
  await q(`UPDATE decisions SET status=$2, human_note=$3, resolved_at=$4 WHERE id=$1`, [id, verdict, note, at]);
}

// counts for the inspect command
export async function counts(): Promise<Record<string, number>> {
  const tables = ["sources", "facts", "entities", "edges", "signals", "contradictions", "positions", "decisions"];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await q(`SELECT count(*)::int AS n FROM ${t}`);
    out[t] = r[0]?.n ?? 0;
  }
  return out;
}
