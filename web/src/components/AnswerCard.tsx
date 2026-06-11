import type { Decision, Status } from "../types";

const isWeb = (s: string) => s.startsWith("web/");

export function AnswerCard({ decision, onDecide }: { decision: Decision; onDecide: (v: Status) => void }) {
  return (
    <div className="card">
      <h3>
        Answer
        <span className={"badge b-" + decision.confidence}>confidence: {decision.confidence}</span>
        <span className={"badge b-" + decision.status}>{decision.status}</span>
      </h3>

      <div className="answer">{decision.answer}</div>

      <div className="rec">
        <b>→ Recommended next action:</b> {decision.recommendation}
      </div>

      {decision.gaps.length > 0 && (
        <>
          <div className="lbl">Open gaps — what it doesn't know</div>
          <ul className="gaps">
            {decision.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </>
      )}

      <div className="lbl">Citations ({decision.evidence.length})</div>
      {decision.evidence.map((c, i) => (
        <div className={"cite" + (isWeb(c.source_id) ? " web" : "")} key={i}>
          <span className="q">“{c.quote}”</span>
          <span className="s">
            {c.source_id}
            {c.speaker ? " · " + c.speaker : ""}
            {isWeb(c.source_id) ? " · external research" : ""}
          </span>
        </div>
      ))}

      {decision.status === "pending" && (
        <div className="row decide">
          <button className="primary" onClick={() => onDecide("approved")}>
            Approve
          </button>
          <button onClick={() => onDecide("rejected")}>Reject</button>
          <span className="hint">the human decides — it only recommends</span>
        </div>
      )}
    </div>
  );
}
