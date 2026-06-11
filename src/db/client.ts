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
