/**
 * List the tenants + their login emails in the live DB. Read-only. Run with the web server STOPPED
 * (PGlite is single-process). Passwords are hashed, so this shows the email (the login) but not the
 * password — you log in with the password you set when you registered the company.
 *
 *   npm run tenants
 */
import { getDb } from "../src/db/client.js";

async function main(): Promise<void> {
  const db = await getDb(); // owner connection — identity tables are readable here
  const tenants = (await db.query<{ id: string; name: string; created_at: string }>(
    `SELECT id, name, created_at FROM tenants ORDER BY created_at`,
  )).rows;
  const users = (await db.query<{ email: string; tenant_id: string; created_at: string }>(
    `SELECT email, tenant_id, created_at FROM users ORDER BY created_at`,
  )).rows;

  const nameOf = new Map(tenants.map((t) => [t.id, t.name]));

  console.log(`\nTENANTS (${tenants.length}):`);
  for (const t of tenants) console.log(`  ${t.id.padEnd(38)}  ${t.name}`);

  console.log(`\nUSERS / LOGINS (${users.length}):`);
  for (const u of users) console.log(`  ${u.email.padEnd(26)}  →  ${nameOf.get(u.tenant_id) ?? "?"}  (tenant ${u.tenant_id.slice(0, 8)})`);

  // also show how many data rows each tenant holds (read as owner = bypasses RLS, so we see all tenants)
  console.log(`\nDATA PER TENANT:`);
  for (const t of tenants) {
    const f = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM facts WHERE tenant_id = $1`, [t.id])).rows[0]!.n;
    const s = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sources WHERE tenant_id = $1`, [t.id])).rows[0]!.n;
    const d = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM decisions WHERE tenant_id = $1`, [t.id])).rows[0]!.n;
    console.log(`  ${(nameOf.get(t.id) ?? t.id).padEnd(20)}  ${f} facts · ${s} sources · ${d} decisions`);
  }
  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
