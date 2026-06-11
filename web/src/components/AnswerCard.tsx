import type { Citation, Decision, Status } from "../types";

const isWeb = (s: string) => s.startsWith("web/");
const splitIds = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

type Ref = { n: number; c: Citation };

/**
 * Build the citation map: every [fact_id] marker the model placed inline gets a sequential number
 * (by first appearance), then any cited fact never referenced inline is appended. Inline superscripts
 * and the Sources key share one numbering. Handles [a][b] and [a, b]. Falls back gracefully (no markers).
 */
function buildRefs(texts: string[], evidence: Citation[]): Map<string, Ref> {
  const byFact = new Map(evidence.map((c) => [c.fact_id, c]));
  const refs = new Map<string, Ref>();
  let n = 0;
  for (const t of texts)
    for (const m of t.matchAll(/\[([^\]]+)\]/g))
      for (const id of splitIds(m[1]))
        if (byFact.has(id) && !refs.has(id)) refs.set(id, { n: ++n, c: byFact.get(id)! });
  for (const c of evidence) if (!refs.has(c.fact_id)) refs.set(c.fact_id, { n: ++n, c });
  return refs;
}

// render prose, replacing [fact_id] markers with numbered superscript chips (hover → quote)
function Cited({ text, refs }: { text: string; refs: Map<string, Ref> }) {
  const out: React.ReactNode[] = [];
  let last = 0,
    key = 0;
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    for (const id of splitIds(m[1])) {
      const ref = refs.get(id);
      if (ref)
        out.push(
          <sup className={"cit" + (isWeb(ref.c.source_id) ? " web" : "")} key={key++} title={`“${ref.c.quote}” — ${ref.c.source_id}${ref.c.speaker ? " · " + ref.c.speaker : ""}`}>
            {ref.n}
          </sup>,
        );
    }
    last = m.index + m[0].length; // unknown markers are dropped, not printed
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function AnswerCard({ decision, onDecide }: { decision: Decision; onDecide: (v: Status) => void }) {
  const refs = buildRefs([decision.recommendation, decision.answer], decision.evidence);
  const sources = [...refs.values()].sort((a, b) => a.n - b.n);

  return (
    <div className="card">
      <h3>
        Answer
        <span className={"badge b-" + decision.confidence}>confidence: {decision.confidence}</span>
        <span className={"badge b-" + decision.status}>{decision.status}</span>
      </h3>

      {/* decision-first: lead with the recommended action */}
      <div className="recbox">
        <div className="reclbl">→ Recommended next action</div>
        <div className="rectext">
          <Cited text={decision.recommendation} refs={refs} />
        </div>
      </div>

      <div className="answer">
        <Cited text={decision.answer} refs={refs} />
      </div>

      {decision.gaps.length > 0 && (
        <>
          <div className="lbl warn">⚠ Open gaps — what it does not know (not invented)</div>
          <ul className="gaps">
            {decision.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </>
      )}

      {sources.length > 0 && (
        <>
          <div className="lbl">Sources ({sources.length}) — every claim traces to a verbatim quote</div>
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
