/**
 * Thin auth — the layer that DECIDES which tenant a request belongs to, so the tenant boundary
 * (RLS, see db/migrate.ts) has an unforgeable tenant_id to enforce. Two real mechanisms, small scope:
 *
 *   passwords — hashed with scrypt (node:crypto), never stored in plaintext.
 *   sessions  — a signed JWT (HS256, via jose) carrying { user_id, tenant_id }. The signature is made
 *               with config.jwtSecret, so the token can't be forged or its tenant_id swapped.
 *
 * register/login run on the OWNER connection (NOT withTenant): at login time no tenant is known yet, and
 * the identity tables sit outside RLS by design. The token they return is what every later request shows;
 * the server reads tenant_id from it and calls withTenant(tenant_id) — see web/server.ts.
 *
 * Deliberately deferred (the written plan, not built): refresh tokens / revocation, RBAC roles, OAuth,
 * httpOnly-cookie storage. In VSI's stack this whole layer is Supabase auth (which also issues JWTs).
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getDb } from "./db/client.js";
import { config } from "./config.js";
import { nowIso } from "./util.js";

export type Claims = { user_id: string; tenant_id: string; email: string };

// ─── passwords (scrypt: salt per user, constant-time compare) ────────────────────
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`; // store salt alongside the hash
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, "hex");
  return test.length === known.length && timingSafeEqual(test, known);
}

// ─── JWT (HS256, signed with the server secret) ──────────────────────────────────
const secret = (): Uint8Array => new TextEncoder().encode(config.jwtSecret);

export async function signToken(c: Claims): Promise<string> {
  return new SignJWT({ user_id: c.user_id, tenant_id: c.tenant_id, email: c.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h") // short-ish; refresh/revocation is the planned extension
    .sign(secret());
}

/** Verify signature + expiry and pull the claims back out. Throws if the token is forged/expired. */
export async function verifyToken(token: string): Promise<Claims> {
  const { payload } = await jwtVerify(token, secret());
  return { user_id: payload.user_id as string, tenant_id: payload.tenant_id as string, email: payload.email as string };
}

// ─── register / login (OWNER connection — no withTenant; identity tables are outside RLS) ─────────
export async function register(name: string, email: string, password: string): Promise<Claims> {
  const db = await getDb();
  const tenantId = randomUUID(); // real tenants get a UUID (unguessable); 'demo' is the seeded exception
  const userId = randomUUID();
  const now = nowIso();
  await db.query(`INSERT INTO tenants (id, name, created_at) VALUES ($1, $2, $3)`, [tenantId, name, now]);
  await db.query(
    `INSERT INTO users (id, email, password_hash, tenant_id, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, email.toLowerCase(), hashPassword(password), tenantId, now],
  );
  return { user_id: userId, tenant_id: tenantId, email: email.toLowerCase() };
}

export async function login(email: string, password: string): Promise<Claims | null> {
  const db = await getDb();
  const r = await db.query<{ id: string; password_hash: string; tenant_id: string; email: string }>(
    `SELECT id, password_hash, tenant_id, email FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  const u = r.rows[0];
  if (!u || !verifyPassword(password, u.password_hash)) return null; // same response either way (no user-enumeration)
  return { user_id: u.id, tenant_id: u.tenant_id, email: u.email };
}

/** Seed a demo login (demo@demo.test / demo1234) for the seeded 'demo' tenant, so the UI works out of the box. */
export async function ensureDemoUser(): Promise<void> {
  const db = await getDb();
  const exists = await db.query(`SELECT 1 FROM users WHERE email = 'demo@demo.test'`);
  if (exists.rows.length) return;
  await db.query(
    `INSERT INTO users (id, email, password_hash, tenant_id, created_at) VALUES ($1, 'demo@demo.test', $2, 'demo', $3)`,
    [randomUUID(), hashPassword("demo1234"), nowIso()],
  );
}
