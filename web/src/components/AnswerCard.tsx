import type { Citation, Decision, Status } from "../types";

const isWeb = (s: string) => s.startsWith("web/");

/**
 * The decision brief. Recommendation-first, then the cited "why" (each reason carries its receipts as
 * numbered source chips), then the blind spots (never invented), then the numbered source key. The
 * citations are structured (per reasoning point), so provenance is explicit without cluttering prose.
 */
export function AnswerCard({ decision, onDecide }: { decision: Decision; onDecide: (v: Status) => void }) {
  // number every cited fact — by first appearance across the reasoning points, then any remaining evidence
  const byFact = new Map(decision.evidence.map((c) => [c.fact_id, c]));
  const refs = new Map<string, { n: number; c: Citation }>();
  let n = 0;
  for (const r of decision.reasoning) for (const id of r.fact_ids) if (byFact.has(id) && !refs.has(id)) refs.set(id, { n: ++n, c: byFact.get(id)! });
  for (const c of decision.evidence) if (!refs.has(c.fact_id)) refs.set(c.fact_id, { n: ++n, c });
  const sources = [...refs.values()].sort((a, b) => a.n - b.n);

  // the bottom-line framing = the headline composed before the "Why:" block
  const bottomLine = decision.answer.split(/\n\nWhy:/)[0].trim();

  const Chips = ({ ids }: { ids: string[] }) => (
    <>
      {ids.map((id) => {
        const r = refs.get(id);
        return r ? (
          <sup key={id} className={"cit" + (isWeb(r.c.source_id) ? " web" : "")} title={`“${r.c.quote}” — ${r.c.source_id}${r.c.speaker ? " · " + r.c.speaker : ""}`}>
            {r.n}
          </sup>
        ) : null;
      })}
    </>
  );

  return (
    <div className="card brief">
      <h3>
        Recommendation
        <span className={"badge b-" + decision.confidence}>confidence: {decision.confidence}</span>
        <span className={"badge b-" + decision.status}>{decision.status}</span>
      </h3>

      {bottomLine && <div className="bottomline">{bottomLine}</div>}

      <div className="recbox">
        <div className="reclbl">→ Recommended next action</div>
        <div className="rectext">{decision.recommendation}</div>
      </div>

      {decision.reasoning.length > 0 && (
        <>
          <div className="lbl">Why — the receipts</div>
          <ol className="why">
            {decision.reasoning.map((r, i) => (
              <li key={i}>
                {r.point}
                <Chips ids={r.fact_ids} />
              </li>
            ))}
          </ol>
        </>
      )}

      {decision.gaps.length > 0 && (
        <>
          <div className="lbl warn">⚠ What it can't confirm — not invented</div>
          <ul className="gaps">
            {decision.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </>
      )}

      {sources.length > 0 && (
        <>
          <div className="lbl">Sources ({sources.length}) — every point traces to a verbatim quote</div>
          {sources.map(({ n, c }) => (
            <div className={"cite" + (isWeb(c.source_id) ? " web" : "")} key={n}>
              <span className="cn">{n}</span>
              <div className="cbody">
                <span className="q">“{c.quote}”</span>
                <span className="s">
                  {c.source_id}
                  {c.speaker ? " · " + c.speaker : ""}
                  {isWeb(c.source_id) ? " · external research" : ""}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

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
