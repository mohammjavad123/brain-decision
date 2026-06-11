import type { Step } from "../types";

const KIND: Record<string, "algo" | "llm" | "tool"> = {
  refine: "llm",
  retrieve: "algo",
  deepen: "algo",
  assess: "llm",
  research: "tool",
  synthesize: "llm",
  verify: "algo",
  log: "algo",
};

/**
 * The Trace tab — every phase the agent went through, in order, with what each LLM seam reasoned and
 * produced. Shows the full step log (active → done), so you can see exactly what happened and why.
 */
export function Trace({ steps }: { steps: Step[] }) {
  const rows = steps.filter((s) => s.node !== "error");
  return (
    <div className="card">
      <h3>LLM trace — phase by phase</h3>
      {rows.map((s, i) => (
        <div className={`trow ph-${s.phase} k-${KIND[s.node] ?? "algo"}`} key={i}>
          <div className="tmeta">
            <span className="tnode">{s.node}</span>
            <span className={`tphase ${s.phase}`}>{s.phase}</span>
            <span className="tkind">{KIND[s.node] === "llm" ? "LLM" : KIND[s.node] === "tool" ? "web" : "algo"}</span>
          </div>
          <div className="tbody">
            <div className="tlabel">{s.label}</div>
            {s.detail.length > 0 && (
              <ul className="tdetail">
                {s.detail.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
