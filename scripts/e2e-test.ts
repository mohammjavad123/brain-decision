/**
 * End-to-end HTTP test — boots the REAL web server and exercises auth + tenant isolation through actual
 * requests (not just the underlying functions). This is the deep test: it proves the 401 gate, that tokens
 * flow through real requests, and that the token's tenant drives isolation end-to-end.
 *
 * Runs against a throwaway DATA_DIR on a test port, with SKIP_SEED=1 so no corpus/LLM is needed — only the
 * local embedding warmup. Data is seeded in-process (same PGlite instance) so no LLM is required at all.
 *
 *   npm run test:e2e
 */
import { getDb, withTenant } from "../src/db/client.js";
import "../src/web/server.js"; // side effect: starts the HTTP server on WEB_PORT

const BASE = `http://localhost:${process.env.WEB_PORT ?? 8799}`;

let pass = 0, fail = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗ FAIL"}  ${label}`);
  ok ? pass++ : fail++;
}

type Res = { status: number; body: any };
async function api(path: string, opts: { method?: string; token?: string; json?: any } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.json) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
  const r = await fetch(BASE + path, { method: opts.method ?? "GET", headers, body: opts.json ? JSON.stringify(opts.json) : undefined });
  let body: any = null;
  try { body = await r.json(); } catch { /* non-JSON (e.g. UI) */ }
  return { status: r.status, body };
}

// Register with retry — waits out the server's startup (embedding warmup + migrate) until tables exist.
async function registerWithRetry(name: string, email: string, password: string): Promise<Res> {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await api("/register", { method: "POST", json: { name, email, password } });
      if (r.status === 200) return r;
    } catch { /* server not accepting yet */ }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("server never became ready for /register");
}

async function seedSource(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, async () => {
    const db = await getDb();
    await db.query(`INSERT INTO sources (id, type, date, body, hash) VALUES ($1, 'note', '2026-06-14', $2, $3)`,
      [id, `body ${id}`, `hash ${id}`]);
  });
}

async function main(): Promise<void> {
  console.log("→ booting real server + registering two companies (waits out warmup)…");
  const acme = await registerWithRetry("Acme Inc", "ceo@acme.com", "acme-pw-123");
  const bistro = await registerWithRetry("Bistro", "owner@bistro.com", "bistro-pw-456");
  const tokenA = acme.body.token, tenantA = acme.body.tenant_id;
  const tokenB = bistro.body.token, tenantB = bistro.body.tenant_id;

  console.log("\nAUTH GATE (no token → 401 on every data surface):");
  check("GET  /db      no token → 401", (await api("/db")).status === 401);
  check("POST /reset   no token → 401  (Michael's point 2)", (await api("/reset", { method: "POST" })).status === 401);
  check("GET  /corpus  no token → 401", (await api("/corpus")).status === 401);
  check("GET  /db      garbage token → 401", (await api("/db", { token: "not-a-real-token" })).status === 401);

  console.log("\nLOGIN:");
  check("two companies got different tenant_ids", !!tenantA && !!tenantB && tenantA !== tenantB);
  check("POST /login  demo seed account → 200 (ensureDemoUser works)",
    (await api("/login", { method: "POST", json: { email: "demo@demo.test", password: "demo1234" } })).status === 200);
  check("POST /login  wrong password → 401",
    (await api("/login", { method: "POST", json: { email: "ceo@acme.com", password: "nope" } })).status === 401);

  console.log("\nTOKEN → TENANT ISOLATION (through real HTTP requests):");
  await seedSource(tenantA, "src_acme");
  await seedSource(tenantB, "src_bistro");
  const dbA = (await api("/db", { token: tokenA })).body;
  const dbB = (await api("/db", { token: tokenB })).body;
  const idsA = (dbA.sources ?? []).map((s: any) => s.id);
  const idsB = (dbB.sources ?? []).map((s: any) => s.id);
  check("Acme's token sees src_acme",            idsA.includes("src_acme"));
  check("Acme's token does NOT see src_bistro",  !idsA.includes("src_bistro"));
  check("Bistro's token sees src_bistro",        idsB.includes("src_bistro"));
  check("Bistro's token does NOT see src_acme",  !idsB.includes("src_acme"));

  console.log("\nPER-TENANT RESET (scoped + auth-gated):");
  check("POST /reset with Acme's token → 200", (await api("/reset", { method: "POST", token: tokenA })).status === 200);
  const dbA2 = (await api("/db", { token: tokenA })).body;
  const dbB2 = (await api("/db", { token: tokenB })).body;
  check("after reset, Acme's brain is empty",        (dbA2.sources ?? []).length === 0);
  check("Bistro's brain is UNTOUCHED by Acme's reset", (dbB2.sources ?? []).map((s: any) => s.id).includes("src_bistro"));

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
