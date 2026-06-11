import type { Step } from "../types";

/**
 * The agent, live. The hero is the AGENT CORE: a single LLM brain (Assess) wired to two tools —
 * Memory (the typed graph) and the Web — that it calls in a loop. Each pass it asks "enough to answer
 * THIS question?": if not, it DEEPENS (walks the graph one hop) or RESEARCHES the web, then RE-checks.
 * Only when it's enough does it hand off to the writer (Synthesize). LLM seams are coloured; the path
 * between them (Retrieve · Deepen-walk · Verify · Log) is deterministic. A failed Verify loops back.
 */

type Kind = "brain" | "agent" | "graph" | "tool" | "writer" | "algo" | "io" | "store" | "ghost";
type GNode = { id: string; x: number; y: number; title: string; sub?: string; kind: Kind; hub?: boolean; w?: number; h?: number };

const HW = 50, HH = 21;
const hw = (n: GNode) => n.w ?? HW;
const hh = (n: GNode) => n.h ?? HH;

const NODES: GNode[] = [
  { id: "caller", x: 64, y: 300, title: "Query", sub: "UI · MCP", kind: "io" },
  { id: "refine", x: 178, y: 300, title: "Refine", sub: "scope + rewrite", kind: "agent" },
  { id: "decline", x: 178, y: 472, title: "Decline", kind: "io" },
  { id: "memory", x: 312, y: 128, title: "Memory", sub: "graph + vectors", kind: "store" },
  { id: "retrieve", x: 312, y: 300, title: "Retrieve", sub: "vector + graph", kind: "algo" },
  { id: "deepen", x: 510, y: 128, title: "Deepen", sub: "walk the graph", kind: "graph" },
  { id: "assess", x: 510, y: 300, title: "Assess", sub: "enough to answer?", kind: "brain", hub: true, w: 61, h: 27 },
  { id: "research", x: 510, y: 472, title: "Research", sub: "the web", kind: "tool" },
  { id: "web", x: 690, y: 472, title: "Web", sub: "Tavily", kind: "store" },
  { id: "synthesize", x: 690, y: 300, title: "Synthesize", sub: "reconcile + write", kind: "writer" },
  { id: "verify", x: 812, y: 300, title: "Verify", sub: "grounded?", kind: "algo" },
  { id: "log", x: 910, y: 300, title: "Log", sub: "decision", kind: "algo" },
  { id: "human", x: 910, y: 128, title: "Human", sub: "approves", kind: "io" },
  // planned extension (not wired into the live engine) — talked about, not run
  { id: "recall", x: 322, y: 440, title: "Recall gap", sub: "search memory for the gap", kind: "ghost" },
];
const byId: Record<string, GNode> = Object.fromEntries(NODES.map((n) => [n.id, n]));

type Edge = { a: string; b: string; curve?: number; dash?: boolean; store?: boolean; ghost?: boolean; memloop?: boolean; webloop?: boolean; back?: boolean; decline?: boolean; label?: string; lx?: number; ly?: number };
const EDGES: Edge[] = [
  { a: "caller", b: "refine" },
  { a: "refine", b: "retrieve" },
  { a: "refine", b: "decline", decline: true, label: "out of scope", lx: 178, ly: 392 },
  { a: "retrieve", b: "assess" },
  // ★ the deepen loop — the agentic centerpiece (memory) — labels placed by hand so the two directions never collide
  { a: "assess", b: "deepen", curve: 26, memloop: true, label: "not enough", lx: 602, ly: 200 },
  { a: "deepen", b: "assess", curve: 26, memloop: true, label: "re-check", lx: 420, ly: 236 },
  // the research loop (web)
  { a: "assess", b: "research", curve: 26, webloop: true, label: "needs web", lx: 600, ly: 374 },
  { a: "research", b: "assess", curve: 26, webloop: true, label: "re-check", lx: 600, ly: 406 },
  // ⌁ planned extension — the agent re-queries memory for a self-identified gap (dashed/ghost)
  { a: "assess", b: "recall", ghost: true, curve: -8 },
  { a: "assess", b: "synthesize", label: "enough", lx: 614, ly: 318 },
  { a: "synthesize", b: "verify" },
  { a: "verify", b: "log" },
  { a: "log", b: "human", label: "recommend", lx: 910, ly: 216 },
  { a: "verify", b: "assess", curve: 165, back: true, label: "ungrounded → re-decide", lx: 666, ly: 130 },
  // the brain's tools: Retrieve/Deepen QUERY memory & fetch back (bidirectional); Research queries the web
  { a: "retrieve", b: "memory", dash: true, store: true },
  { a: "deepen", b: "memory", dash: true, store: true },
  { a: "research", b: "web", dash: true, store: true },
];

function exit(n: GNode, dx: number, dy: number): [number, number] {
  const t = Math.min(hw(n) / (Math.abs(dx) || 1e-6), hh(n) / (Math.abs(dy) || 1e-6));
  return [n.x + dx * t, n.y + dy * t];
}
function geom(a: GNode, b: GNode, curve = 0) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const [sx, sy] = exit(a, dx, dy);
  const [ex, ey] = exit(b, -dx, -dy);
  const len = Math.hypot(ex - sx, ey - sy) || 1;
  const cx = (sx + ex) / 2 + (-(ey - sy) / len) * curve;
  const cy = (sy + ey) / 2 + ((ex - sx) / len) * curve;
  return { sx, sy, ex, ey, cx, cy };
}
function edgePath(a: GNode, b: GNode, curve = 0): string {
  const g = geom(a, b, curve);
  return `M${g.sx.toFixed(1)} ${g.sy.toFixed(1)} Q${g.cx.toFixed(1)} ${g.cy.toFixed(1)} ${g.ex.toFixed(1)} ${g.ey.toFixed(1)}`;
}

type NState = "pending" | "active" | "done" | "skipped" | "static" | "ghost";
const STATIC = new Set(["caller", "memory", "web"]);
const num = (re: RegExp, s: string): number | null => {
  const m = s.match(re);
  return m ? parseInt(m[1], 10) : null;
};

export function AgentFlow({ steps, busy }: { steps: Step[]; busy: boolean }) {
  const phase = new Map<string, "active" | "done">();
  for (const s of steps) phase.set(s.node, s.phase);
  const seq = steps.filter((s) => s.node !== "error");
  const tail = seq[seq.length - 1];
  const A = tail && tail.phase === "active" ? tail.node : null;
  const did = (id: string) => seq.some((s) => s.node === id && s.phase === "done");
  const countDone = (id: string) => seq.filter((s) => s.node === id && s.phase === "done").length;

  const passes = countDone("assess");
  const hops = countDone("deepen");
  const webLookups = countDone("research");
  const loops = Math.max(0, passes - 1);
  const usedDeepen = hops > 0;
  const usedResearch = webLookups > 0;
  const wrote = did("synthesize");
  const delivered = did("log");
  const decision = [...seq].reverse().find((s) => s.decision)?.decision ?? null;
  const declined = did("decline");

  const verifyLoopedBack = (() => {
    const v = seq.map((s) => s.node).lastIndexOf("verify");
    return v >= 0 && seq.slice(v + 1).some((s) => s.node === "assess");
  })();

  // ── live telemetry (derived faithfully from the stream) ──
  const lastFacts = [...seq].reverse().find((s) => (s.node === "retrieve" || s.node === "deepen") && s.phase === "done");
  const facts = lastFacts ? num(/(\d+)\s*facts?/, lastFacts.label) : null;
  const conf = decision?.confidence ?? null;
  const cites = decision ? decision.evidence.length : null;

  type Tile = { k: string; label: string; v: string | number | null; cls?: string };
  const tiles: Tile[] = [
    { k: "facts", label: "facts read", v: facts },
    { k: "hops", label: "graph hops", v: hops || (usedDeepen ? hops : null) },
    { k: "passes", label: "decision passes", v: passes || null },
    { k: "web", label: "web lookups", v: webLookups || null },
    { k: "cites", label: "citations", v: cites },
    { k: "conf", label: "confidence", v: conf, cls: conf ? `conf-${conf}` : "" },
  ];

  function nstate(id: string): NState {
    if (id === "recall") return "ghost"; // planned — never part of the live run
    if (STATIC.has(id)) return "static";
    if (id === "human") return delivered ? "done" : "static";
    const p = phase.get(id);
    if (p === "active" && busy) return "active";
    if (p === "done") return "done";
    if (id === "decline" && did("retrieve")) return "skipped";
    if ((id === "deepen" || id === "research") && (wrote || declined)) return "skipped";
    if ((id === "synthesize" || id === "verify" || id === "log") && declined) return "skipped";
    return "pending";
  }

  function edgeClass(e: Edge): { cls: string; flowing: boolean } {
    if (e.ghost) return { cls: "gedge2 ghost", flowing: false }; // planned extension — always faint, never animates
    let c = "gedge2";
    if (e.dash) c += " dash";
    if (e.memloop) c += " memloop";
    if (e.webloop) c += " webloop";
    if (e.back) c += " back";
    if (e.decline) c += " decline";
    const touchesActive = !!(busy && A && (e.a === A || e.b === A));
    const traversed =
      (e.memloop && usedDeepen) || (e.webloop && usedResearch) || (e.back && verifyLoopedBack) ||
      (e.decline && declined) || (e.a === "log" && delivered) ||
      (e.store && (did(e.a) || phase.get(e.a) === "active")) ||
      (!e.memloop && !e.webloop && !e.back && !e.decline && !e.dash && did(e.a) && (did(e.b) || phase.get(e.b) === "active"));
    let flowing = touchesActive;
    if (touchesActive || (busy && (e.memloop || e.webloop || e.back) && (e.a === A || e.b === A))) { c += " flow"; flowing = true; }
    else if (traversed) c += " lit";
    return { cls: c, flowing };
  }

  const coreActive = A === "assess" || A === "deepen" || A === "research";
  const status = A === "deepen" ? "↻ not enough — walking the memory graph…"
    : A === "research" ? "↻ gap needs public info — researching the web…"
    : A === "assess" ? "🧠 deciding — is the evidence enough to answer?"
    : A === "refine" ? "intake — in scope? rewriting the query…"
    : A === "retrieve" ? "reading compiled memory (vector + graph)…"
    : A === "synthesize" ? "✍ writing — reconcile contradictions + cite every claim…"
    : A === "verify" ? "checking every claim resolves to a real fact…"
    : A === "decline" ? "out of scope — declining"
    : delivered ? "✓ recommendation delivered → awaiting human approval"
    : declined ? "declined — outside this brain's memory"
    : busy ? "…" : "ask a question to watch the agent think";

  const doneLines = seq.filter((s) => s.phase === "done");
  const activeLine = tail && tail.phase === "active" ? tail : null;

  return (
    <div className="card flow">
      <h3>
        Agent · live
        <span className="flowkey">
          <i className="k-brain" />decide <i className="k-graph" />deepen <i className="k-tool" />web <i className="k-writer" />write <i className="k-algo" />deterministic <i className="k-io" />in / out <i className="k-ghost" />planned
        </span>
      </h3>
      <div className="flowsub">
        One LLM brain — <b>Assess</b> — wired to two tools: <b>Memory</b> (the typed graph) and the <b>Web</b>.
        Each pass it asks <b>“enough to answer this?”</b> If not, it <b>Deepens</b> (walks the graph one hop:
        neighbours · contradictions · same entity) or <b>Researches</b> the web, then <b>re-checks</b> — the loop.
        Only when it's <b>enough</b> does the writer (<b>Synthesize</b>) draft a cited answer; <b>Verify</b> proves
        every claim resolves to a real fact, else it loops back to decide again.
      </div>

      <div className="tele">
        {tiles.map((t) => (
          <div key={t.k} className={`tstat${t.v == null ? " dim" : ""} ${t.cls ?? ""}`}>
            <div className="tv">{t.v == null ? "—" : t.v}</div>
            <div className="tk">{t.label}</div>
          </div>
        ))}
        <div className={`tstat loopstat${loops > 0 ? "" : " dim"}`}>
          <div className="tv">↻ {loops}</div>
          <div className="tk">agent loops</div>
        </div>
      </div>

      <svg className="agentgraph2" viewBox="0 0 1000 558" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="ah" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
            <path d="M0 0 L6.5 3 L0 6 Z" fill="rgba(233,240,234,.55)" />
          </marker>
          <marker id="ahr" markerWidth="8" markerHeight="8" refX="1.5" refY="3" orient="auto-start-reverse">
            <path d="M0 0 L6.5 3 L0 6 Z" fill="rgba(92,200,214,.7)" />
          </marker>
          <marker id="ahc" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
            <path d="M0 0 L6.5 3 L0 6 Z" fill="rgba(92,200,214,.7)" />
          </marker>
          <marker id="ahg" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
            <path d="M0 0 L6.5 3 L0 6 Z" fill="rgba(125,142,131,.55)" />
          </marker>
          <marker id="ahgr" markerWidth="8" markerHeight="8" refX="1.5" refY="3" orient="auto-start-reverse">
            <path d="M0 0 L6.5 3 L0 6 Z" fill="rgba(125,142,131,.55)" />
          </marker>
          <radialGradient id="coreglow" cx="50%" cy="50%" r="62%">
            <stop offset="0%" stopColor="rgba(52,211,153,.13)" />
            <stop offset="100%" stopColor="rgba(52,211,153,0)" />
          </radialGradient>
        </defs>

        {/* the agent-core region — the brain (Assess) + its two tool loops */}
        <rect className={`gcore${coreActive ? " live" : ""}`} x={438} y={96} width={144} height={406} rx="18" fill="url(#coreglow)" />
        <text className="gcorelabel" x={510} y={88}>AGENT CORE · decide ⇄ gather</text>

        <text className={"agentstatus" + (busy ? " live" : "")} x={990} y={22} textAnchor="end">{status}</text>

        {EDGES.map((e, i) => {
          const a = byId[e.a]!, b = byId[e.b]!;
          const d = edgePath(a, b, e.curve);
          const { cls, flowing } = edgeClass(e);
          return (
            <g key={i}>
              <path className={cls} d={d} markerEnd={e.store ? "url(#ahc)" : e.ghost ? "url(#ahg)" : "url(#ah)"} markerStart={e.store ? "url(#ahr)" : e.ghost ? "url(#ahgr)" : undefined} />
              {flowing && <circle className="dot" r="2.6"><animateMotion dur="1s" repeatCount="indefinite" path={d} /></circle>}
            </g>
          );
        })}
        {EDGES.filter((e) => e.label).map((e, i) => {
          // explicit hand-placed label coords (lx/ly) win; otherwise fall back to the edge midpoint
          let x: number, y: number;
          if (e.lx != null && e.ly != null) { x = e.lx; y = e.ly; }
          else { const g = geom(byId[e.a]!, byId[e.b]!, e.curve ?? 0); x = g.cx; y = g.cy - 3; }
          return <text key={`l${i}`} className={`gelabel${e.back ? " back" : ""}`} x={x} y={y}>{e.label}</text>;
        })}

        {NODES.map((n) => {
          const st = nstate(n.id);
          const writing = n.id === "synthesize" && st === "active";
          const thinking = n.id === "assess" && st === "active";
          return (
            <g key={n.id} className={`gnode k-${n.kind} s-${st}${n.hub ? " hub" : ""}${writing ? " writing" : ""}`}>
              {thinking && (
                <>
                  <circle className="brainring" cx={n.x} cy={n.y} r="34" fill="none">
                    <animate attributeName="r" values="32;62" dur="1.8s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values=".55;0" dur="1.8s" repeatCount="indefinite" />
                  </circle>
                  <circle className="brainring" cx={n.x} cy={n.y} r="34" fill="none">
                    <animate attributeName="r" values="32;62" dur="1.8s" begin="0.9s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values=".55;0" dur="1.8s" begin="0.9s" repeatCount="indefinite" />
                  </circle>
                </>
              )}
              {n.hub && <rect className="ghub" x={n.x - hw(n) - 6} y={n.y - hh(n) - 6} width={(hw(n) + 6) * 2} height={(hh(n) + 6) * 2} rx="15" />}
              <rect x={n.x - hw(n)} y={n.y - hh(n)} width={hw(n) * 2} height={hh(n) * 2} rx="11" />
              {n.id === "recall" && <text className="ghosttag" x={n.x} y={n.y - hh(n) - 7}>⌁ PLANNED</text>}
              <text className="gt" x={n.x} y={n.sub ? n.y - 4 : n.y - 1}>{n.id === "assess" ? "🧠 " : ""}{n.title}{st === "done" ? " ✓" : ""}</text>
              {n.sub && <text className="gsub" x={n.x} y={n.y + 10}>{n.sub}</text>}
            </g>
          );
        })}
      </svg>

      <div className="flowextra">
        <b>⌁ Planned — Recall gap (the confidence blind-spot):</b> when Assess flags a gap, the agent re-queries
        memory for <i>that exact missing thing</i> before falling back to the web — so a <b>low-confidence</b> answer
        means a <b>proven</b> gap, not a retrieval miss. Shown dashed because it's a designed extension, not yet wired
        into the live engine.
      </div>

      <div className="flowlog">
        {seq.length === 0 && <div className="flowline idle">ask a question to watch the agent run →</div>}
        {doneLines.map((s, i) => (
          <div className="flowline" key={i}>
            <span className="fln">{s.node}</span>
            <div className="flb">
              <span className="fll">{s.label}</span>
              {s.detail.length > 0 && (
                <div className="fld">
                  {s.detail.map((d, j) => <div key={j} className="fldln">{d}</div>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {activeLine && (
          <div className="flowline act">
            <span className="fln">{activeLine.node}</span>
            <div className="flb"><span className="fll">{activeLine.label}</span></div>
            <span className="pulse" />
          </div>
        )}
      </div>
    </div>
  );
}
