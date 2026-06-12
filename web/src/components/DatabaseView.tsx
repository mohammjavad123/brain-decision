import { useEffect, useMemo, useState } from "react";
import { fetchDb } from "../api";
import type { DbData, DbFact } from "../types";

type Tab = "facts" | "sources" | "entities" | "edges" | "mentions" | "relationships" | "signals" | "positions" | "contradictions" | "decisions";
const TABS: { key: Tab; label: string }[] = [
  { key: "facts", label: "Facts" },
  { key: "sources", label: "Sources" },
  { key: "entities", label: "Entities" },
  { key: "edges", label: "Edges" },
  { key: "mentions", label: "Mentions" },
  { key: "relationships", label: "Relationships" },
  { key: "signals", label: "Signals" },
  { key: "positions", label: "Positions" },
  { key: "contradictions", label: "Contradictions" },
  { key: "decisions", label: "Decisions" },
];

// one short claim of WHY each table exists
const WHY: Record<Tab, string> = {
  facts: "the checkable unit the brain reasons over — a typed atom with a verbatim quote.",
  sources: "the verbatim ground truth every fact, edge and decision traces back to.",
  entities: "one node per real person/company — name variants merged, so the graph and counts are right.",
  edges: "the typed relationships between entities — the graph the agent can traverse.",
  mentions: "the raw names seen per source (pre-merge), kept so entities can be re-resolved over all sources.",
  relationships: "the raw subject→predicate→object links (pre-wire), kept so edges can be re-wired over all sources.",
  signals: "recurring customer patterns — evidence a thing is real, not a one-off.",
  positions: "the company's drift-aware stance per dimension, with confidence and explicit gaps.",
  contradictions: "conflicts surfaced (not averaged away) so the brain can reason about drift.",
  decisions: "the append-only, recommend-only log; resolved outcomes fold back into memory.",
};

// how each table is actually stored (shown so the DB format is explicit, not guessed)
const SCHEMA: Record<Tab, string> = {
  facts: "table facts — id · type · value · quote · source_id · speaker · dimension · evidence_tier · confidence · valid_time · learned_time · superseded_at · embedding(vector 768)",
  sources: "table sources — id · type · date · author · participants · body · hash (content-addressed)",
  entities: "table entities — id (PK) · name · type · aliases[]",
  edges: "table edges — id (PK) · from_id → entities · predicate · to_id → entities · source_id → sources · similarity",
  mentions: "table mentions — id (PK) · name · type · source_id → sources",
  relationships: "table relationships — id (PK) · subject · predicate · object · source_id → sources",
  signals: "table signals — id · type · label · fact_ids[] · count · companies[] · promotion · last_confirmed · embedding",
  positions: "table positions — id · name · summary · fields[]{claim, fact_ids} · confidence · gaps[] · valid_time · compiled_at · embedding",
  contradictions: "table contradictions — id · dimension · fact_a · fact_b · kind · note · status",
  decisions: "append-only table decisions — id · question · answer · confidence · evidence[]{fact_id, quote, source_id, speaker} · gaps[] · recommendation · status · human_note · created_at · resolved_at",
};

// highlight the verbatim quote inside its source body — the provenance, made visible
function Highlight({ body, quote }: { body: string; quote: string }) {
  const i = quote ? body.indexOf(quote) : -1;
  if (i < 0) return <>{body}</>;
  return (
    <>
      {body.slice(0, i)}
      <mark className="qmark">{body.slice(i, i + quote.length)}</mark>
      {body.slice(i + quote.length)}
    </>
  );
}

export function DatabaseView() {
  const [db, setDb] = useState<DbData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("facts");
  const [sel, setSel] = useState<DbFact | null>(null);

  const load = () => {
    setErr(null);
    fetchDb().then(setDb).catch((e) => setErr((e as Error).message));
  };
  useEffect(load, []);

  const sourceById = useMemo(() => new Map((db?.sources ?? []).map((s) => [s.id, s])), [db]);
  const entById = useMemo(() => new Map((db?.entities ?? []).map((e) => [e.id, e])), [db]);
  const entName = (id: string) => entById.get(id)?.name ?? id;

  if (err) return <div className="card errcard">⚠ {err} — is the server running on :8787?</div>;
  if (!db) return <div className="card"><span className="muted">loading the database…</span></div>;

  const selSource = sel ? sourceById.get(sel.source_id) : null;

  return (
    <div className="dbview">
      <div className="card dbhead">
        <div className="dbcounts">
          {Object.entries(db.counts).map(([k, v]) => (
            <span key={k} className="dbcount"><b>{v}</b> {k}</span>
          ))}
        </div>
        <button className="link" onClick={load}>↻ refresh</button>
      </div>

      <div className="dbtabs">
        {TABS.map((t) => (
          <button key={t.key} className={"dbtab" + (tab === t.key ? " on" : "")} onClick={() => setTab(t.key)}>
            {t.label} <span className="muted small">{(db[t.key] as unknown[])?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="dbwhy1"><span className="dbschemak">why</span> {WHY[tab]}</div>
      <div className="dbschema"><span className="dbschemak">stored as</span> {SCHEMA[tab]}</div>

      {tab === "facts" && (
        <>
          <div className="dbhint">Click a fact → trace it back to the exact verbatim quote in its source. <span className="muted">Rows marked <span className="chip ty">decision</span> are decisions folded back into memory (the closed loop).</span></div>
          <div className="dbsplit">
            <div className="card dbtablewrap">
              <table className="dbtable">
                <thead><tr><th>type</th><th>dim</th><th>tier</th><th>value</th></tr></thead>
                <tbody>
                  {db.facts.map((f) => (
                    <tr key={f.id} className={(sel?.id === f.id ? "sel " : "") + (f.type === "decision" ? "decisionrow" : "")} onClick={() => setSel(f)}>
                      <td><span className="chip ty">{f.type}</span></td>
                      <td className="muted small">{f.dimension ?? "—"}</td>
                      <td><span className="chip tier">{f.evidence_tier}</span></td>
                      <td className="vcell">{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card dbtrace">
              {!sel && <div className="muted">← Click a fact to trace its provenance.</div>}
              {sel && (
                <>
                  <div className="lbl">Fact</div>
                  <div className="fval">{sel.value}</div>
                  <div className="fmeta">
                    <span className="chip ty">{sel.type}</span>
                    {sel.dimension && <span className="chip dim">{sel.dimension}</span>}
                    <span className="chip tier">{sel.evidence_tier}</span>
                    {sel.speaker && <span className="muted small">{sel.speaker}</span>}
                  </div>
                  <div className="fmeta"><span className="muted small">id {sel.id} · valid {sel.valid_time?.slice(0, 10)}</span></div>
                  <div className="traceback">↩ traces back to source</div>
                  {selSource ? (
                    <div className="srccard">
                      <div className="srchead">
                        <span className="chip src">{selSource.type}</span> <strong>{selSource.id}</strong>
                        <span className="muted small">{selSource.date}{selSource.author ? ` · ${selSource.author}` : ""}</span>
                      </div>
                      <div className="srcbody"><Highlight body={selSource.body} quote={sel.quote} /></div>
                    </div>
                  ) : (
                    <div className="muted small">source “{sel.source_id}” not in store — verbatim quote: “{sel.quote}”</div>
                  )}
                  <details className="rawrow">
                    <summary>⟨/⟩ raw stored fact (the DB row)</summary>
                    <pre className="rawjson">{JSON.stringify(sel, null, 2)}</pre>
                  </details>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "sources" && (
        <div className="card">
          {db.sources.map((s) => (
            <details key={s.id} className="srcdetail">
              <summary>
                <span className="chip src">{s.type}</span> <strong>{s.id}</strong>
                <span className="muted small">{s.date}{s.author ? ` · ${s.author}` : ""}{s.participants.length ? ` · ${s.participants.join(", ")}` : ""}</span>
              </summary>
              <div className="srcbody">{s.body}</div>
            </details>
          ))}
        </div>
      )}

      {tab === "entities" && (
        <div className="card dbtablewrap">
          <table className="dbtable">
            <thead><tr><th>name</th><th>type</th><th>aliases (merged surfaces)</th></tr></thead>
            <tbody>
              {db.entities.map((e) => (
                <tr key={e.id}>
                  <td className="vcell">{e.name}</td>
                  <td><span className="chip ty">{e.type}</span></td>
                  <td className="muted small">{e.aliases.length ? e.aliases.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "edges" && (
        <div className="card dbtablewrap">
          <table className="dbtable">
            <thead><tr><th>from</th><th>predicate</th><th>to</th><th>source</th></tr></thead>
            <tbody>
              {db.edges.map((e, i) => (
                <tr key={i}>
                  <td className="vcell">{entName(e.from_id)}</td>
                  <td><span className="chip">{e.predicate}</span></td>
                  <td className="vcell">{entName(e.to_id)}</td>
                  <td className="muted small">{e.source_id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "mentions" && (
        <div className="card dbtablewrap">
          <table className="dbtable">
            <thead><tr><th>name (raw surface)</th><th>type</th><th>source</th></tr></thead>
            <tbody>
              {db.mentions.map((m, i) => (
                <tr key={i}>
                  <td className="vcell">{m.name}</td>
                  <td><span className="chip ty">{m.type}</span></td>
                  <td className="muted small">{m.source_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "relationships" && (
        <div className="card dbtablewrap">
          <table className="dbtable">
            <thead><tr><th>subject</th><th>predicate</th><th>object</th><th>source</th></tr></thead>
            <tbody>
              {db.relationships.map((r, i) => (
                <tr key={i}>
                  <td className="vcell">{r.subject}</td>
                  <td><span className="chip">{r.predicate}</span></td>
                  <td className="vcell">{r.object}</td>
                  <td className="muted small">{r.source_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "signals" && (
        <div className="card dbtablewrap">
          <table className="dbtable">
            <thead><tr><th>promotion</th><th>type</th><th>label</th><th>×</th><th>companies</th></tr></thead>
            <tbody>
              {db.signals.map((s) => (
                <tr key={s.id}>
                  <td><span className="chip">{s.promotion}</span></td>
                  <td className="muted small">{s.type}</td>
                  <td className="vcell">{s.label}</td>
                  <td>{s.count}</td>
                  <td className="muted small">{s.companies.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "positions" && (
        <div className="card">
          {db.positions.map((p) => (
            <div key={p.id} className="posrow">
              <div className="phead"><strong>{p.name}</strong> <span className={`chip conf ${p.confidence}`}>{p.confidence}</span> <span className="muted small">{p.gaps.length} gaps · {p.fields.length} cited fields</span></div>
              <div className="psum">{p.summary}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "contradictions" && (
        <div className="card">
          {db.contradictions.length === 0 && <div className="muted">none detected</div>}
          {db.contradictions.map((c) => (
            <div key={c.id} className="contra">
              <span className="chip warn">{c.dimension} · {c.kind}</span> {c.note}
              <div className="muted small">{c.fact_a} ⟂ {c.fact_b}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "decisions" && (
        <div className="card">
          {db.decisions.length === 0 && <div className="muted">no decisions logged yet</div>}
          {db.decisions.map((d) => (
            <details key={d.id} className="decrow">
              <summary>
                <span className={`chip st-${d.status}`}>{d.status}</span>
                <span className="muted small">{d.id}</span> {d.question}
              </summary>
              <div className="decbody">
                <div className="rec"><b>→ {d.recommendation}</b></div>
                <div className="muted small">confidence {d.confidence} · {d.reasoning?.length ?? 0} reasons · {d.gaps.length} gaps · {d.evidence.length} citations{d.resolved_at ? ` · resolved ${d.resolved_at.slice(0, 10)}` : ""}</div>
                {d.reasoning?.length > 0 && (
                  <ol className="why">{d.reasoning.map((r, i) => <li key={i}>{r.point}</li>)}</ol>
                )}
                {d.evidence.map((c, i) => (
                  <div key={i} className="cite">
                    <span className="q">“{c.quote}”</span>
                    <span className="s">{c.source_id}{c.speaker ? ` · ${c.speaker}` : ""}</span>
                  </div>
                ))}
                <details className="rawrow">
                  <summary>⟨/⟩ raw stored row (exactly how it's saved)</summary>
                  <pre className="rawjson">{JSON.stringify(d, null, 2)}</pre>
                </details>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
