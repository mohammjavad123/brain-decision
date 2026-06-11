import type { Step } from "../types";

type Kind = "llm" | "algo" | "tool" | "store" | "io";
type GNode = { id: string; x: number; y: number; title: string; kind: Kind; hub?: boolean };

const HW = 48;
const HH = 20;

// hand-laid agent graph: the spine + the assess-hub loops + the tools (Memory / Web / Human)
const NODES: GNode[] = [
  { id: "caller", x: 50, y: 210, title: "UI · MCP", kind: "io" },
  { id: "refine", x: 162, y: 210, title: "Refine", kind: "llm" },
  { id: "retrieve", x: 300, y: 210, title: "Retrieve", kind: "algo" },
  { id: "assess", x: 458, y: 210, title: "Assess", kind: "llm", hub: true },
  { id: "deepen", x: 392, y: 108, title: "Deepen", kind: "algo" },
  { id: "research", x: 392, y: 312, title: "Research", kind: "tool" },
  { id: "synthesize", x: 602, y: 210, title: "Synthesize", kind: "llm" },
  { id: "verify", x: 730, y: 210, title: "Verify", kind: "algo" },
  { id: "log", x: 852, y: 210, title: "Log", kind: "algo" },
  { id: "memory", x: 196, y: 56, title: "Memory", kind: "store" },
  { id: "web", x: 392, y: 382, title: "Web", kind: "store" },
  { id: "human", x: 852, y: 56, title: "Human", kind: "io" },
];
const byId: Record<string, GNode> = Object.fromEntries(NODES.map((n) => [n.id, n]));

type Edge = { a: string; b: string; curve?: number; dash?: boolean; label?: string };
const EDGES: Edge[] = [
  { a: "caller", b: "refine" },
  { a: "refine", b: "retrieve" },
  { a: "retrieve", b: "assess" },
  { a: "assess", b: "synthesize" },
  { a: "synthesize", b: "verify" },
  { a: "verify", b: "log" },
  { a: "assess", b: "deepen", curve: 22 },
  { a: "deepen", b: "assess", curve: -22 },
  { a: "assess", b: "research", curve: 22 },
  { a: "research", b: "assess", curve: -22 },
  { a: "verify", b: "assess", curve: -94, label: "ungrounded → re-assess" },
  { a: "log", b: "human" },
  { a: "memory", b: "retrieve", dash: true },
  { a: "memory", b: "deepen", dash: true },
  { a: "web", b: "research", dash: true },
];

function exit(n: GNode, dx: number, dy: number): [number, number] {
  const t = Math.min(HW / (Math.abs(dx) || 1e-6), HH / (Math.abs(dy) || 1e-6));
  return [n.x + dx * t, n.y + dy * t];
}
function edgePath(a: GNode, b: GNode, curve = 0): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const [sx, sy] = exit(a, dx, dy);
  const [ex, ey] = exit(b, -dx, -dy);
  const len = Math.hypot(ex - sx, ey - sy) || 1;
  const cx = (sx + ex) / 2 + (-(ey - sy) / len) * curve;
  const cy = (sy + ey) / 2 + ((ex - sx) / len) * curve;
  return `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}
function edgeCtrl(a: GNode, b: GNode, curve = 0): [number, number] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const [sx, sy] = exit(a, dx, dy);
  const [ex, ey] = exit(b, -dx, -dy);
  const len = Math.hypot(ex - sx, ey - sy) || 1;
  return [(sx + ex) / 2 + (-(ey - sy) / len) * curve, (sy + ey) / 2 + ((ex - sx) / len) * curve];
}

type NState = "pending" | "active" | "done" | "skipped" | "static";
const STATIC = new Set(["caller", "memory", "web", "human"]);

/**
 * The agent's architecture as a live graph (the spine, the `assess` hub + its deepen/research loops,
 * and the tools it touches), shown up-front and lit as the StateGraph runs. A streaming log beneath
 * shows each step's result as it arrives.
 */
export function AgentFlow({ steps, busy }: { steps: Step[]; busy: boolean }) {
  const phase = new Map<string, "active" | "done">();
  for (const s of steps) phase.set(s.node, s.phase);
  const anyDone = (...ids: string[]) => ids.some((i) => phase.get(i) === "done");

  function state(id: string): NState {
    if (STATIC.has(id)) return "static";
    const p = phase.get(id);
    if (p === "done") return "done";
    if (p === "active" && busy) return "active";
    if ((id === "research" || id === "deepen") && anyDone("synthesize", "verify", "log")) return "skipped";
    return "pending";
  }

  // streaming log: every completed step, plus the one currently running
  const shown = steps.filter((s) => s.node !== "error");
  const doneLines = shown.filter((s) => s.phase === "done");
  const tail = shown[shown.length - 1];
  const activeLine = tail && tail.phase === "active" ? tail : null;

  return (
    <div className="card flow">
      <h3>
        Agent
        <span className="flowkey">
          <i className="k-llm" />LLM <i className="k-algo" />deterministic <i className="k-tool" />web <i className="k-store" />store/io
        </span>
      </h3>
      <div className="flowsub">
The <b>root agent</b> is a LangGraph <b>StateGraph</b> — <b>Assess</b> is the decision hub every loop returns to (incl. a failed <b>Verify</b>). Driven by the <b>UI or any MCP agent</b> (left); reads the <b>Memory</b> (the compiled brain, top-left); <b>human</b> approves (right).
      </div>

      <svg className="agentgraph" viewBox="0 0 920 414" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="ah" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
            <path d="M0 0 L6.5 3 L0 6 Z" fill="rgba(233,240,234,.5)" />
          </marker>
        </defs>
        {/* the orchestrator: a container around the loop nodes (interfaces sit outside) */}
        <rect className="gframe" x="110" y="82" width="794" height="258" rx="16" />
        <text className="gframelabel" x="124" y="100">ROOT AGENT · StateGraph</text>
        {EDGES.map((e, i) => (
          <path key={i} className={"gedge" + (e.dash ? " dash" : "")} d={edgePath(byId[e.a]!, byId[e.b]!, e.curve)} markerEnd="url(#ah)" />
        ))}
        {EDGES.filter((e) => e.label).map((e, i) => {
          const [cx, cy] = edgeCtrl(byId[e.a]!, byId[e.b]!, e.curve);
          return (
            <text key={`l${i}`} className="gelabel" x={cx} y={cy - 4}>
              {e.label}
            </text>
          );
        })}
        {NODES.map((n) => {
          const st = state(n.id);
          return (
            <g key={n.id} className={`gnode k-${n.kind} s-${st}${n.hub ? " hub" : ""}`}>
              {n.hub && <rect className="ghub" x={n.x - HW - 6} y={n.y - HH - 6} width={(HW + 6) * 2} height={(HH + 6) * 2} rx="14" />}
              <rect x={n.x - HW} y={n.y - HH} width={HW * 2} height={HH * 2} rx="10" />
              <text className="gt" x={n.x} y={n.y - 1}>
                {n.title}
                {st === "done" ? " ✓" : ""}
              </text>
              <text className="gk" x={n.x} y={n.y + 12}>
                {n.kind === "store" ? "store" : n.kind === "io" ? "i/o" : n.kind === "tool" ? "web" : n.kind === "llm" ? "LLM" : "algo"}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flowlog">
        {shown.length === 0 && <div className="flowline idle">ask a question to watch the agent run →</div>}
        {doneLines.map((s, i) => (
          <div className="flowline" key={i}>
            <span className="fln">{s.node}</span>
            <span className="fll">{s.label}</span>
          </div>
        ))}
        {activeLine && (
          <div className="flowline act">
            <span className="fln">{activeLine.node}</span>
            <span className="fll">{activeLine.label}</span>
            <span className="pulse" />
          </div>
        )}
      </div>
    </div>
  );
}
