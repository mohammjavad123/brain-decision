import type { Step } from "../types";

export function Thinking({ steps, busy }: { steps: Step[]; busy: boolean }) {
  return (
    <div className="card">
      <h3>
        Thinking {busy && <span className="pulse" />}
      </h3>
      {steps.map((s, i) => (
        <div className={"step" + (s.node === "error" ? " err" : "")} key={i}>
          <div className="n">{s.node}</div>
          <div className="l">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
