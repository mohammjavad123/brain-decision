import { createServer } from "node:http";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { seed } from "../seed.js";
import { streamAgent } from "../answer/graph.js";
import { resolveDecision, getDecision, counts, clearCompiled, allMentions, allRelationships } from "../db/queries.js";
import { embedOne } from "../llm/embed.js";
import { researchAvailable } from "../research/tavily.js";
import { config, EMBEDDING_DIM } from "../config.js";
import { nowIso } from "../util.js";
import { parseSources } from "../ingest/parseSource.js";
import { ingestSources } from "../ingest/pipeline.js";
import { migrate } from "../db/migrate.js";
import { connect } from "../connect/index.js";
import { buildAndStoreSignals } from "../signals/index.js";
import { composeAndStorePositions } from "../positions/index.js";

/**
 * The API behind the React test UI (in ../../web). No framework — just the two endpoints the agent needs:
 *   GET  /ask?q=…   → Server-Sent Events: one event per graph node as it fires, then the decision
 *   POST /resolve   → record the human's approve/reject (the human-decides moment)
 * The React dev server (Vite, port 5173) proxies these; CORS is also set so it works either way.
 * The agent itself is unchanged — this just streams `streamAgent()` to the browser.
 */
const PORT = Number(process.env.WEB_PORT ?? 8787);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const UI_DIR = join(process.cwd(), "web", "dist"); // the built React app — served from this same server
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/ask") {
    const q = url.searchParams.get("q") ?? "";
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", ...CORS });
    try {
      for await (const step of streamAgent(q)) {
        res.write(`data: ${JSON.stringify(step)}\n\n`);
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ node: "error", label: (e as Error).message, decision: null })}\n\n`);
    }
    res.write("event: done\ndata: {}\n\n");
    res.end();
    return;
  }

  // Build memory LIVE from a pasted item — runs the whole Phase-1 spine and streams every stage so the
  // user watches a raw item become typed facts, a resolved entity graph, signals, and positions.
  if (req.method === "GET" && url.pathname === "/ingest") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", ...CORS });
    const send = (ev: Record<string, unknown>) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const trace = (stage: string) => (m: string) => send({ stage, phase: "active", label: stage, detail: [m] });
    try {
      // 1. PARSE — pasted text → one or MORE typed Sources (a paste can carry a whole batch)
      send({ stage: "parse", phase: "active", label: "parsing pasted items", detail: [] });
      const sources = parseSources(url.searchParams.get("src") ?? "");
      send({
        stage: "parse", phase: "done", label: `parsed ${sources.length} item${sources.length > 1 ? "s" : ""}`,
        detail: sources.map((s) => `${s.id} · ${s.type} · ${s.date}`),
        data: { sources: sources.map((s) => ({ id: s.id, type: s.type, date: s.date, participants: s.participants })) },
      });

      // 2. EXTRACT (the only LLM call in ingest) → verify quotes → embed → store. Additive: new items
      // join whatever is already in memory; identical bodies are skipped by content hash.
      send({ stage: "extract", phase: "active", label: `extracting typed facts from ${sources.length} item(s)`, detail: [] });
      const ing = await ingestSources(sources, { log: trace("extract") });
      const dup = ing.facts.length === 0;
      send({
        stage: "extract", phase: "done",
        label: dup ? "already in memory (hash match)" : `${ing.facts.length} facts extracted`,
        detail: [`${ing.mentions.length} entities · ${ing.relationships.length} relationships`, ...(ing.rejectedQuotes ? [`${ing.rejectedQuotes} rejected (unverifiable quote)`] : [])],
        data: {
          facts: ing.facts.map((f) => ({ id: f.id, type: f.type, value: f.value, quote: f.quote, dimension: f.dimension, evidence_tier: f.evidence_tier, speaker: f.speaker, source_id: f.source_id })),
          entities: ing.mentions.map((m) => ({ name: m.name, type: m.type })),
          relationships: ing.relationships.map((r) => ({ subject: r.subject, predicate: r.predicate, object: r.object })),
          rejected: ing.rejectedQuotes,
        },
      });

      // 3. CONNECT — resolve entities · wire edges · detect contradictions (deterministic, global recompute).
      // The compiled layer is a pure function of facts + mentions, so wipe it and rebuild from ALL persisted
      // mentions/relationships (not just this source's) — else entities/edges named in prior sources vanish.
      await clearCompiled();
      const full = { ...ing, mentions: await allMentions(), relationships: await allRelationships() };
      send({ stage: "connect", phase: "active", label: "resolving entities · wiring edges · detecting contradictions", detail: [] });
      const con = await connect(full, { log: trace("connect") });
      send({
        stage: "connect", phase: "done", label: `${con.entities.length} entities · ${con.edges.length} edges · ${con.contradictions.length} contradictions`,
        detail: [],
        data: {
          entities: con.entities.map((e) => ({ id: e.id, name: e.name, type: e.type, aliases: e.aliases ?? [] })),
          edges: con.edges.map((e) => ({ from_id: e.from_id, predicate: e.predicate, to_id: e.to_id })),
          contradictions: con.contradictions.map((c) => ({ kind: c.kind, note: c.note })),
        },
      });

      // 4. SIGNALS — cluster facts by meaning · promote
      send({ stage: "signals", phase: "active", label: "clustering signals by meaning", detail: [] });
      const sigs = await buildAndStoreSignals(full.mentions, { log: trace("signals") });
      send({
        stage: "signals", phase: "done", label: `${sigs.length} signals`, detail: [],
        data: { signals: sigs.map((s) => ({ type: s.type, label: s.label, promotion: s.promotion, count: s.count, companies: s.companies })) },
      });

      // 5. POSITIONS — compose drift-aware stances
      send({ stage: "positions", phase: "active", label: "composing drift-aware positions", detail: [] });
      const pos = await composeAndStorePositions({ log: trace("positions") });
      send({
        stage: "positions", phase: "done", label: `${pos.length} positions`, detail: [],
        data: { positions: pos.map((p) => ({ name: p.name, confidence: p.confidence, summary: p.summary, gaps: p.gaps })) },
      });

      const c = await counts();
      send({ stage: "done", phase: "done", label: dup ? "no change (already ingested)" : "memory updated", detail: [], data: { counts: c } });
    } catch (e) {
      send({ stage: "error", phase: "done", label: (e as Error).message, detail: [] });
    }
    res.write("event: done\ndata: {}\n\n");
    res.end();
    return;
  }

  // Serve the raw corpus as one pasteable batch (every .md item, frontmatter intact) so the UI can
  // load it into the ingest box and the user can watch the whole week become memory, live.
  if (req.method === "GET" && url.pathname === "/corpus") {
    try {
      const dir = config.corpusDir;
      const text = readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => readFileSync(join(dir, f), "utf8").trim())
        .join("\n\n");
      res.writeHead(200, { "Content-Type": "text/plain", ...CORS });
      res.end(text);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
    return;
  }

  // Wipe the WHOLE memory — fresh empty brain — so a user can start a new subject and rebuild by pasting.
  // Drops everything (facts, signals, positions, decision log included); same in-process DB, no restart.
  if (req.method === "POST" && url.pathname === "/reset") {
    try {
      await migrate({ reset: true });
      const c = await counts();
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ ok: true, counts: c }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/resolve") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { id, verdict, note } = JSON.parse(body || "{}");
        if (!(await getDecision(id))) {
          res.writeHead(404, { "Content-Type": "application/json", ...CORS });
          res.end(JSON.stringify({ error: "no such decision" }));
          return;
        }
        await resolveDecision(id, verdict, note ?? null, nowIso());
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ ok: true, status: verdict }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    });
    return;
  }

  // STATIC: serve the built React UI (one entry point — UI + API on the same port). SPA fallback to index.html.
  if (req.method === "GET") {
    if (!existsSync(join(UI_DIR, "index.html"))) {
      res.writeHead(200, { "Content-Type": "text/plain", ...CORS });
      res.end("UI not built yet. Run `npm start` (it builds the UI), or for dev: cd web && npm run dev → http://localhost:5173");
      return;
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    let file = join(UI_DIR, rel);
    if (!file.startsWith(UI_DIR) || !existsSync(file)) file = join(UI_DIR, "index.html"); // path-safety + SPA fallback
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", ...CORS });
    res.end(readFileSync(file));
    return;
  }

  res.writeHead(404, CORS);
  res.end("not found");
});

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n  ✗ Port ${PORT} is already in use — another Decision Brain is already running.`);
    console.error(`    Stop it:  lsof -ti:${PORT} | xargs kill   ·   or run on another port: WEB_PORT=8788 npm start\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, async () => {
  console.log(`\n● Decision Brain API → http://localhost:${PORT}`);
  console.log("  warming up — loading everything once, up front (so the first query is fast)…\n");

  // 1. local embedding model (the only heavy local load — ~MiniLM via transformers.js)
  const t0 = Date.now();
  try {
    await embedOne("warmup");
    console.log(`  ✓ embedding model loaded            (${Date.now() - t0}ms)  ${config.embeddingProvider} · ${EMBEDDING_DIM}-dim`);
  } catch (e) {
    console.log(`  ✗ embedding model FAILED: ${(e as Error).message}`);
  }

  // 2. database — open the PGlite store; if the brain is EMPTY, build it once (same process, no conflict)
  try {
    let c = await counts();
    if (c.facts === 0) {
      console.log("  ◷ empty brain — seeding from the corpus (first run; ~1-2 min)…");
      await seed({ log: (m) => console.log("      " + m) });
      c = await counts();
    }
    console.log(`  ✓ database ready                    ${c.facts} facts · ${c.signals} signals · ${c.positions} positions · ${c.decisions} decisions`);
  } catch (e) {
    console.log(`  ✗ database FAILED: ${(e as Error).message}`);
  }

  // 3. LLM seams (remote — nothing to preload, just report config + key/tool presence)
  const keyOk = config.llmProvider === "gemini" ? !!config.geminiKey : !!config.openaiKey;
  console.log(`  ${keyOk ? "✓" : "✗"} LLM seams (${config.llmProvider})            extract=${config.extractModel} · compose=${config.composeModel} · synthesize=${config.synthesizeModel}`);
  console.log(`  ${researchAvailable() ? "✓" : "○"} web research                      ${researchAvailable() ? "TAVILY_API_KEY set" : "no TAVILY_API_KEY (research degrades honestly)"}`);

  const uiReady = existsSync(join(UI_DIR, "index.html"));
  console.log(`\n  → ready. ${uiReady ? `Open  http://localhost:${PORT}` : `UI not built — run \`npm start\`, or dev: cd web && npm run dev`}\n`);
});
