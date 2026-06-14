/**
 * Auth leak test — proves the JWT auth layer actually decides the tenant, and that the tenant a token
 * carries can't be forged or crossed. Runs against its OWN throwaway DATA_DIR (set in the npm script).
 *
 * It tests the real mechanism (register → hash → login → sign JWT → verify → withTenant), the same path
 * the HTTP server uses — without booting the server.
 *
 *   npm run test:auth
 */
import { migrate } from "../src/db/migrate.js";
import { getDb, withTenant } from "../src/db/client.js";
import { register, login, signToken, verifyToken } from "../src/auth.js";

let pass = 0, fail = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗ FAIL"}  ${label}`);
  ok ? pass++ : fail++;
}

async function insertSourceAs(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, async () => {
    const db = await getDb();
    await db.query(`INSERT INTO sources (id, type, date, body, hash) VALUES ($1, 'note', '2026-06-13', $2, $3)`,
      [id, `body ${id}`, `hash-${id}`]);
  });
}
async function countSourcesAs(tenantId: string): Promise<number> {
  return withTenant(tenantId, async () => {
    const db = await getDb();
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sources`);
    return r.rows[0]!.n;
  });
}

async function main(): Promise<void> {
  console.log("→ migrate (fresh schema + identity tables + RLS)");
  await migrate({ reset: true });

  console.log("→ register two companies");
  const acme = await register("Acme Inc", "ceo@acme.com", "acme-pw-123");
  const globex = await register("Globex", "ceo@globex.com", "globex-pw-456");
  check("acme got a UUID tenant_id (not 'demo', not guessable)", acme.tenant_id.length >= 32 && acme.tenant_id !== "demo");
  check("the two companies got different tenant_ids", acme.tenant_id !== globex.tenant_id);

  // each writes a row under its own tenant
  await insertSourceAs(acme.tenant_id, "src_acme");
  await insertSourceAs(globex.tenant_id, "src_globex");

  console.log("\nLOGIN → TOKEN:");
  // 1. login with the right password returns the user's own tenant
  const acmeLogin = await login("ceo@acme.com", "acme-pw-123");
  check("login(correct password) → returns acme's tenant_id", acmeLogin?.tenant_id === acme.tenant_id);

  // 2. wrong password is rejected
  const badLogin = await login("ceo@acme.com", "wrong-password");
  check("login(wrong password) → rejected (null)", badLogin === null);

  // 3. unknown email is rejected (and indistinguishable from wrong password — no user-enumeration)
  const unknownLogin = await login("nobody@nowhere.com", "whatever");
  check("login(unknown email) → rejected (null)", unknownLogin === null);

  console.log("\nTOKEN INTEGRITY:");
  // 4. a freshly signed token verifies back to the same tenant
  const token = await signToken(acmeLogin!);
  const decoded = await verifyToken(token);
  check("signed token verifies → same tenant_id back", decoded.tenant_id === acme.tenant_id);

  // 5. a forged/tampered token is rejected (flip one character of the signature)
  const tampered = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
  let forgedRejected = false;
  try { await verifyToken(tampered); } catch { forgedRejected = true; }
  check("tampered token → rejected by signature check", forgedRejected);

  // 6. garbage / no token is rejected (this is what the server's 401 gate relies on)
  let garbageRejected = false;
  try { await verifyToken("not-a-token"); } catch { garbageRejected = true; }
  check("garbage token → rejected (server would 401)", garbageRejected);

  console.log("\nTOKEN → TENANT IS ISOLATED:");
  // 7. acting as the tenant inside acme's token sees ONLY acme's row
  check("acme's token tenant sees exactly 1 source (its own)", (await countSourcesAs(decoded.tenant_id)) === 1);
  // 8. and that row is acme's, not globex's
  const acmeSeesOwn = await withTenant(decoded.tenant_id, async () => {
    const db = await getDb();
    const r = await db.query(`SELECT id FROM sources`);
    return r.rows.length === 1 && (r.rows[0] as any).id === "src_acme";
  });
  check("the row acme sees is src_acme, never src_globex", acmeSeesOwn);

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
