/**
 * Tenant-boundary leak test — proves the Row-Level Security boundary actually isolates tenants.
 *
 * Runs against its OWN throwaway DATA_DIR (set in the npm script), so it never touches the live brain.
 * Two tenants each write a row, then we try every way to cross the boundary and assert each one fails:
 *   read · update · delete another tenant's row, and forge a row INTO another tenant.
 * Finally we show the superuser path bypasses RLS — which is exactly why the app connects as app_user.
 *
 *   npm run test:tenant
 */
import { migrate } from "../src/db/migrate.js";
import { getDb, withTenant } from "../src/db/client.js";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗ FAIL"}  ${label}`);
  ok ? pass++ : fail++;
}

async function insertSourceRaw(tenant: string, id: string): Promise<void> {
  await withTenant(tenant, async () => {
    const db = await getDb();
    await db.query(
      `INSERT INTO sources (id, type, date, body, hash) VALUES ($1, 'note', '2026-06-13', $2, $3)`,
      [id, `body for ${id}`, `hash-${id}`],
    );
  });
}

async function countSources(tenant: string): Promise<number> {
  return withTenant(tenant, async () => {
    const db = await getDb();
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sources`);
    return r.rows[0]!.n;
  });
}

async function main(): Promise<void> {
  console.log("→ migrate (fresh schema + RLS boundary)");
  await migrate({ reset: true });

  console.log("→ seed two tenants");
  await insertSourceRaw("acme", "src_acme_1");
  await insertSourceRaw("globex", "src_globex_1");

  console.log("\nISOLATION:");
  // 1. each tenant sees ONLY its own row
  check("acme sees exactly 1 source (its own)", (await countSources("acme")) === 1);
  check("globex sees exactly 1 source (its own)", (await countSources("globex")) === 1);

  // 2. cross-tenant READ — acme cannot see globex's row by id
  const crossRead = await withTenant("acme", async () => {
    const db = await getDb();
    const r = await db.query(`SELECT id FROM sources WHERE id = 'src_globex_1'`);
    return r.rows.length;
  });
  check("acme reading globex's row by id → 0 rows", crossRead === 0);

  // 3. cross-tenant UPDATE — acme cannot modify globex's row
  const crossUpdate = await withTenant("acme", async () => {
    const db = await getDb();
    const r = await db.query(`UPDATE sources SET body = 'hacked' WHERE id = 'src_globex_1'`);
    return r.affectedRows ?? 0;
  });
  check("acme updating globex's row → 0 rows affected", crossUpdate === 0);

  // 4. cross-tenant DELETE — acme cannot delete globex's row
  const crossDelete = await withTenant("acme", async () => {
    const db = await getDb();
    const r = await db.query(`DELETE FROM sources WHERE id = 'src_globex_1'`);
    return r.affectedRows ?? 0;
  });
  check("acme deleting globex's row → 0 rows affected", crossDelete === 0);

  // 5. WITH CHECK — acme cannot forge a row INTO globex's tenant
  let forgeBlocked = false;
  try {
    await withTenant("acme", async () => {
      const db = await getDb();
      await db.query(
        `INSERT INTO sources (id, tenant_id, type, date, body, hash) VALUES ('forged', 'globex', 'note', '2026-06-13', 'x', 'x')`,
      );
    });
  } catch {
    forgeBlocked = true; // WITH CHECK rejected the cross-tenant write
  }
  check("acme forging a row with tenant_id='globex' → rejected by WITH CHECK", forgeBlocked);

  // 6. globex's row survived every attack, untouched
  const globexIntact = await withTenant("globex", async () => {
    const db = await getDb();
    const r = await db.query<{ body: string }>(`SELECT body FROM sources WHERE id = 'src_globex_1'`);
    return r.rows.length === 1 && r.rows[0]!.body === "body for src_globex_1";
  });
  check("globex's row is intact (1 row, original body)", globexIntact);

  console.log("\nWHY app_user MATTERS:");
  // 7. superuser (no withTenant) bypasses RLS — sees BOTH tenants. This is the trap we avoid by
  //    connecting as the non-superuser app_user for every real request.
  const db = await getDb();
  await db.query(`SELECT set_config('app.tenant_id', '', false)`); // unset, superuser role
  const superuserSees = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sources`)).rows[0]!.n;
  check("superuser bypasses RLS and sees BOTH rows (=2) — why the app uses app_user", superuserSees === 2);

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
