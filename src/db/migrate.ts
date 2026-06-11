import { getDb } from "./client.js";
import { EMBEDDING_DIM } from "../config.js";

/**
 * Schema = the 8 data types as tables, in one Postgres+pgvector store.
 *  - foreign keys wire provenance (fact→source; positions/signals reference fact ids in JSONB)
 *  - `embedding vector(N)` gives similarity in the same store (no separate vector DB)
 *  - bi-temporal + append-only: `valid_time` + `learned_time` + `superseded_at` (never DELETE)
 */
const TABLES_SQL = (dim: number) => `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  date          TEXT NOT NULL,
  author        TEXT,
  participants  JSONB NOT NULL DEFAULT '[]',
  body          TEXT NOT NULL,
  hash          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  value          TEXT NOT NULL,
  quote          TEXT NOT NULL,
  source_id      TEXT NOT NULL REFERENCES sources(id),
  speaker        TEXT,
  location_start INTEGER,
  location_end   INTEGER,
  confidence     REAL NOT NULL,
  evidence_tier  TEXT NOT NULL,
  dimension      TEXT,
  qualifier      TEXT,
  comparable     TEXT,
  valid_time     TEXT NOT NULL,
  learned_time   TEXT NOT NULL,
  superseded_at  TEXT,
  embedding      vector(${dim})
);

CREATE TABLE IF NOT EXISTS entities (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL,
  aliases  JSONB NOT NULL DEFAULT '[]'
);

-- raw extraction outputs (like facts: persisted, append-only) so the COMPILED layer (entities, edges,
-- signal company-attribution) can be recomputed from ALL sources on an incremental ingest, not just the new one.
CREATE TABLE IF NOT EXISTS mentions (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  source_id  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relationships (
  id         TEXT PRIMARY KEY,
  subject    TEXT NOT NULL,
  predicate  TEXT NOT NULL,
  object     TEXT NOT NULL,
  source_id  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL,
  predicate   TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  source_id   TEXT,
  similarity  REAL
);

CREATE TABLE IF NOT EXISTS signals (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  label          TEXT NOT NULL,
  fact_ids       JSONB NOT NULL DEFAULT '[]',
  count          INTEGER NOT NULL,
  companies      JSONB NOT NULL DEFAULT '[]',
  last_confirmed TEXT NOT NULL,
  promotion      TEXT NOT NULL,
  learned_time   TEXT NOT NULL,
  superseded_at  TEXT,
  embedding      vector(${dim})
);

CREATE TABLE IF NOT EXISTS contradictions (
  id            TEXT PRIMARY KEY,
  dimension     TEXT NOT NULL,
  fact_a        TEXT NOT NULL,
  fact_b        TEXT NOT NULL,
  kind          TEXT NOT NULL,
  note          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  learned_time  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  summary           TEXT NOT NULL,
  fields            JSONB NOT NULL DEFAULT '[]',
  signal_ids        JSONB NOT NULL DEFAULT '[]',
  contradiction_ids JSONB NOT NULL DEFAULT '[]',
  confidence        TEXT NOT NULL,
  gaps              JSONB NOT NULL DEFAULT '[]',
  valid_time        TEXT NOT NULL,
  learned_time      TEXT NOT NULL,
  compiled_at       TEXT NOT NULL,
  superseded_at     TEXT,
  embedding         vector(${dim})
);

CREATE TABLE IF NOT EXISTS decisions (
  id                TEXT PRIMARY KEY,
  question          TEXT NOT NULL,
  answer            TEXT NOT NULL,
  confidence        TEXT NOT NULL,
  evidence          JSONB NOT NULL DEFAULT '[]',
  contradiction_ids JSONB NOT NULL DEFAULT '[]',
  research_fact_ids JSONB NOT NULL DEFAULT '[]',
  gaps              JSONB NOT NULL DEFAULT '[]',
  recommendation    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  human_note        TEXT,
  created_at        TEXT NOT NULL,
  resolved_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_facts_source    ON facts(source_id);
CREATE INDEX IF NOT EXISTS idx_facts_dimension ON facts(dimension);
CREATE INDEX IF NOT EXISTS idx_facts_type      ON facts(type);
CREATE INDEX IF NOT EXISTS idx_facts_current   ON facts(superseded_at);
CREATE INDEX IF NOT EXISTS idx_edges_from      ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to        ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_signals_type    ON signals(type);
`;

const DROP_SQL = `
DROP TABLE IF EXISTS decisions, positions, contradictions, signals, edges, facts, entities, mentions, relationships, sources CASCADE;
`;

export async function migrate(opts: { reset?: boolean } = {}): Promise<void> {
  const db = await getDb();
  if (opts.reset) await db.exec(DROP_SQL);
  await db.exec(TABLES_SQL(EMBEDDING_DIM));

  // Vector ANN indexes (HNSW). Optional optimization — exact search is correct without them,
  // so we never let an index error block setup. At scale these are what keep reads sub-100ms.
  for (const t of ["facts", "signals", "positions"]) {
    try {
      await db.exec(
        `CREATE INDEX IF NOT EXISTS idx_${t}_embedding ON ${t} USING hnsw (embedding vector_cosine_ops);`,
      );
    } catch {
      // HNSW unavailable in this pgvector build — fall back to exact cosine scan (fine at this scale).
    }
  }
}

// Run standalone: `tsx src/db/migrate.ts [--reset]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const reset = process.argv.includes("--reset");
  migrate({ reset })
    .then(() => {
      console.log(`✓ migrated (embedding dim ${EMBEDDING_DIM}${reset ? ", reset" : ""})`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
