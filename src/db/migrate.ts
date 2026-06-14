import type { PGlite } from "@electric-sql/pglite";
import { getDb } from "./client.js";
import { EMBEDDING_DIM } from "../config.js";

/**
 * Schema = the 8 data types as tables, in one Postgres+pgvector store.
 *  - foreign keys wire provenance (fact→source; positions/signals reference fact ids in JSONB)
 *  - `embedding vector(N)` gives similarity in the same store (no separate vector DB)
 *  - bi-temporal + append-only: `valid_time` + `learned_time` + `superseded_at` (never DELETE)
 *
 * MULTI-TENANCY: every table carries `tenant_id`, defaulted from the per-request session var
 * `app.tenant_id` so writes never have to name it. Row-Level Security (below) then makes that column
 * an invisible, unforgeable filter on EVERY query — the boundary lives in the DB, not the app code.
 */
const TENANT_TABLES = [
  "sources", "facts", "entities", "mentions", "relationships",
  "edges", "signals", "contradictions", "positions", "decisions",
] as const;

// `tenant_id` column shared by every table: NOT NULL (no tenant-less rows) and defaulted from the
// session var, so existing INSERTs need zero changes — the active tenant is stamped automatically.
const TENANT_COL = `tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)`;

const TABLES_SQL = (dim: number) => `
CREATE EXTENSION IF NOT EXISTS vector;

-- IDENTITY layer (NOT tenant-scoped — this is what DECIDES the tenant). A user belongs to one tenant;
-- login reads these before any tenant is known, so they sit outside RLS. tenant_id on every other table
-- points back at tenants.id.
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,   -- UUID (the value that becomes app.tenant_id); 'demo' is the seeded one
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,            -- UUID
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,               -- scrypt salt:hash, never plaintext
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  ${TENANT_COL},
  type          TEXT NOT NULL,
  date          TEXT NOT NULL,
  author        TEXT,
  participants  JSONB NOT NULL DEFAULT '[]',
  body          TEXT NOT NULL,
  hash          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id             TEXT PRIMARY KEY,
  ${TENANT_COL},
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
  ${TENANT_COL},
  name     TEXT NOT NULL,
  type     TEXT NOT NULL,
  aliases  JSONB NOT NULL DEFAULT '[]'
);

-- raw extraction outputs (like facts: persisted, append-only) so the COMPILED layer (entities, edges,
-- signal company-attribution) can be recomputed from ALL sources on an incremental ingest, not just the new one.
CREATE TABLE IF NOT EXISTS mentions (
  id         TEXT PRIMARY KEY,
  ${TENANT_COL},
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  source_id  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relationships (
  id         TEXT PRIMARY KEY,
  ${TENANT_COL},
  subject    TEXT NOT NULL,
  predicate  TEXT NOT NULL,
  object     TEXT NOT NULL,
  source_id  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,
  ${TENANT_COL},
  from_id     TEXT NOT NULL,
  predicate   TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  source_id   TEXT,
  similarity  REAL
);

CREATE TABLE IF NOT EXISTS signals (
  id             TEXT PRIMARY KEY,
  ${TENANT_COL},
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
  ${TENANT_COL},
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
  ${TENANT_COL},
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
  ${TENANT_COL},
  question          TEXT NOT NULL,
  answer            TEXT NOT NULL,
  confidence        TEXT NOT NULL,
  evidence          JSONB NOT NULL DEFAULT '[]',
  reasoning         JSONB NOT NULL DEFAULT '[]',
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

/**
 * The tenant boundary. RLS appends `tenant_id = current_setting('app.tenant_id')` to EVERY statement at
 * the DB layer, so no app query has to remember it. Two facts make it real:
 *  1. superusers BYPASS RLS even with FORCE — so the app must connect as the non-superuser `app_user`
 *     (see withTenant in client.ts). Migrate/seed stay superuser to do setup.
 *  2. `WITH CHECK` blocks writing a row into another tenant; `USING` hides other tenants on read/update/delete.
 * Unset tenant → current_setting returns NULL → `= NULL` is never true → fail-closed (the app sees nothing).
 */
async function applyTenantBoundary(db: PGlite): Promise<void> {
  // The role the app connects as. NOSUPERUSER is the whole point — it does NOT bypass RLS.
  try {
    await db.exec(`CREATE ROLE app_user NOSUPERUSER`);
  } catch {
    // already exists — fine, this is idempotent across restarts
  }
  await db.exec(`GRANT USAGE ON SCHEMA public TO app_user;
                 GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;`);
  // The identity tables decide the tenant — the per-request role must never read or write them.
  // Login/register touch these only via the owner connection (outside withTenant).
  await db.exec(`REVOKE ALL ON tenants, users FROM app_user;`);

  for (const t of TENANT_TABLES) {
    // Existing DBs created before this column: add it, backfill to the demo tenant, then constrain.
    await db.exec(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS tenant_id TEXT;`);
    await db.exec(`UPDATE ${t} SET tenant_id = 'demo' WHERE tenant_id IS NULL;`);
    await db.exec(`ALTER TABLE ${t} ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true);`);
    await db.exec(`ALTER TABLE ${t} ALTER COLUMN tenant_id SET NOT NULL;`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_tenant ON ${t}(tenant_id);`);

    // Enforce + FORCE (so the table owner is policed too), then the one isolation policy.
    await db.exec(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
    await db.exec(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
    await db.exec(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`);
    await db.exec(
      `CREATE POLICY tenant_isolation ON ${t}
         USING (tenant_id = current_setting('app.tenant_id', true))
         WITH CHECK (tenant_id = current_setting('app.tenant_id', true));`,
    );
  }
}

const DROP_SQL = `
DROP TABLE IF EXISTS decisions, positions, contradictions, signals, edges, facts, entities, mentions, relationships, sources, users, tenants CASCADE;
`;

export async function migrate(opts: { reset?: boolean } = {}): Promise<void> {
  const db = await getDb();
  // Migrate/seed run as the DB owner (superuser). Drop any lingering app_user role so DDL is unblocked,
  // then re-establish the boundary at the end. (RESET ROLE is a no-op if we're already the owner.)
  await db.exec(`RESET ROLE;`);
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

  await applyTenantBoundary(db); // the tenant boundary — must come after tables exist (grants need targets)

  // The seeded demo tenant — the friendly id 'demo' matches DEFAULT_TENANT, so all existing demo-built
  // memory belongs to a real tenant row. Real tenants (created at /register) get a UUID instead.
  await db.query(
    `INSERT INTO tenants (id, name, created_at) VALUES ('demo', 'Demo', '2026-01-01') ON CONFLICT (id) DO NOTHING`,
  );
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
