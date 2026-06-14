import type { DbData, IngestStep, Status, Step } from "./types";

// Talk DIRECTLY to the agent API (the server sends CORS headers) — more reliable than streaming
// Server-Sent Events through Vite's dev proxy, which can buffer/drop them.
const API = "http://localhost:8787";

// ── AUTH ─────────────────────────────────────────────────────────────────────────────────────────
// The JWT lives in localStorage; it's attached to every request so the server knows the tenant. (For a
// demo this is fine; production would use an httpOnly cookie — see the production plan.)
export const getToken = (): string | null => localStorage.getItem("token");
const setToken = (t: string | null): void => { t ? localStorage.setItem("token", t) : localStorage.removeItem("token"); };
export const logout = (): void => setToken(null);

const authHeaders = (): Record<string, string> => {
  const t = getToken();
  return t ? { Authorization: "Bearer " + t } : {};
};
// EventSource can't set headers, so the SSE endpoints carry the token as a query param instead.
const tokenQS = (): string => {
  const t = getToken();
  return t ? "&token=" + encodeURIComponent(t) : "";
};

export type Auth = { token: string; tenant_id: string; email: string };

export async function login(email: string, password: string): Promise<Auth> {
  const r = await fetch(API + "/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "login failed");
  setToken(d.token);
  return d as Auth;
}

export async function registerCompany(name: string, email: string, password: string): Promise<Auth> {
  const r = await fetch(API + "/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "registration failed");
  setToken(d.token);
  return d as Auth;
}

/** Open the agent's SSE stream; onStep per graph node, onDone when finished. Surfaces errors as a step. */
export function askStream(q: string, onStep: (s: Step) => void, onDone: () => void): EventSource {
  const es = new EventSource(API + "/ask?q=" + encodeURIComponent(q) + tokenQS());
  let got = false;
  es.onmessage = (e) => {
    got = true;
    // normalize defensively so an unexpected payload can never crash the UI
    const r = JSON.parse(e.data) as Partial<Step>;
    onStep({
      node: r.node ?? "?",
      phase: r.phase === "active" ? "active" : "done",
      label: r.label ?? "",
      detail: Array.isArray(r.detail) ? r.detail : [],
      decision: r.decision ?? null,
    });
  };
  es.addEventListener("done", () => {
    es.close();
    onDone();
  });
  es.onerror = () => {
    es.close();
    if (!got) {
      onStep({
        node: "error",
        phase: "done",
        label: `Could not reach the API at ${API}. Is "npm run web" running in another terminal?`,
        detail: [],
        decision: null,
      });
    }
    onDone();
  };
  return es;
}

/** Stream the ingest pipeline (Memory tab): one event per stage as a pasted item becomes memory. */
export function ingestStream(src: string, onStep: (s: IngestStep) => void, onDone: () => void): EventSource {
  const es = new EventSource(API + "/ingest?src=" + encodeURIComponent(src) + tokenQS());
  let got = false;
  es.onmessage = (e) => {
    got = true;
    const r = JSON.parse(e.data) as Partial<IngestStep>;
    onStep({
      stage: (r.stage ?? "error") as IngestStep["stage"],
      phase: r.phase === "active" ? "active" : "done",
      label: r.label ?? "",
      detail: Array.isArray(r.detail) ? r.detail : [],
      data: r.data,
    });
  };
  es.addEventListener("done", () => {
    es.close();
    onDone();
  });
  es.onerror = () => {
    es.close();
    if (!got) onStep({ stage: "error", phase: "done", label: `Could not reach the API at ${API}. Is "npm run web" running?`, detail: [] });
    onDone();
  };
  return es;
}

/** Fetch the raw corpus as one pasteable batch (all items) to ingest live. */
export async function loadCorpusText(): Promise<string> {
  const r = await fetch(API + "/corpus", { headers: authHeaders() });
  return r.text();
}

/** Fetch the persisted tables for the Database tab (facts, sources, decisions… with provenance). */
export async function fetchDb(): Promise<DbData> {
  const r = await fetch(API + "/db", { headers: authHeaders() });
  if (!r.ok) throw new Error(`db fetch failed (${r.status})`);
  return r.json();
}

/** Wipe THIS tenant's memory — fresh empty brain — so a new subject can be built from scratch. */
export async function resetMemory(): Promise<{ ok: boolean; counts?: Record<string, number>; error?: string }> {
  const r = await fetch(API + "/reset", { method: "POST", headers: authHeaders() });
  return r.json();
}

/** Record the human's verdict on a logged decision (the human-decides moment). */
export async function resolveDecision(id: string, verdict: Status): Promise<void> {
  await fetch(API + "/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ id, verdict }),
  });
}
