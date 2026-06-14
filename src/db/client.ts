import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { config } from "../config.js";

/**
 * One store. Postgres semantics + pgvector, running in-process via PGlite (zero setup).
 * Swap `dataDir` for a Supabase Postgres connection string in production — same SQL, same
 * pgvector queries. This is the single index every layer reads from ("one spine").
 */
let _db: PGlite | null = null;

export async function getDb(): Promise<PGlite> {
  if (_db) return _db;
  mkdirSync(dirname(config.dataDir), { recursive: true }); // PGlite's leaf mkdir is non-recursive
  _db = new PGlite({ dataDir: config.dataDir, extensions: { vector } });
  await _db.waitReady;
  return _db;
}

/** pgvector wants a literal like '[0.1,0.2,...]'. */
export function toVec(arr: number[]): string {
  return `[${arr.join(",")}]`;
}

/** The tenant every demo/CLI/MCP path uses unless told otherwise. */
export const DEFAULT_TENANT = "demo";

/**
 * The tenant choke-point. Runs `fn` with the connection scoped to ONE tenant under the non-superuser
 * `app_user` role, so Row-Level Security enforces isolation on every query inside — no `WHERE tenant_id`
 * anywhere in the data layer. `set_config(...,false)` = session-level (not transaction-local).
 *
 * LOCAL (PGlite): one in-process connection, requests serialized → a session SET + RESET in `finally` is
 * safe and exact. PRODUCTION (pooled Postgres): swap the body for `BEGIN; SET LOCAL ROLE app_user;
 * SET LOCAL app.tenant_id = $1; … COMMIT` so a borrowed connection can never leak the tenant to the next
 * request. Same policies, same SQL — only the scope of the SET changes.
 */
export async function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  await db.exec(`SET ROLE app_user`); // drop superuser so RLS actually applies
  try {
    return await fn();
  } finally {
    // back to the owner so the next setup/migrate isn't blocked, and the tenant doesn't bleed onward
    await db.exec(`RESET ROLE`);
    await db.query(`SELECT set_config('app.tenant_id', '', false)`);
  }
}

/**
 * Seed/migrate run as the superuser owner (RLS bypassed for setup) but still need `app.tenant_id` set so
 * the `tenant_id` column DEFAULT stamps the rows they write. Sets the GUC only — never switches role.
 */
export async function setSeedTenant(tenantId: string = DEFAULT_TENANT): Promise<void> {
  const db = await getDb();
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
}
