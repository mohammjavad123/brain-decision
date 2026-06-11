import { useMemo, useState } from "react";
import type { IngestData, IngestStep } from "../types";
import { loadCorpusText } from "../api";

const STAGES = [
  { key: "parse", label: "Parse", sub: "text → source" },
  { key: "extract", label: "Extract", sub: "LLM · typed facts" },
  { key: "connect", label: "Connect", sub: "entities · edges · contradictions" },
  { key: "signals", label: "Signals", sub: "cluster · promote" },
  { key: "positions", label: "Positions", sub: "drift-aware stance" },
] as const;

const EXAMPLE = `---
id: note/weekly-exec-sync
type: note
date: 2026-06-09
author: Maya Chen
participants: [Maya Chen, Priya Nair, Devin Park]
---
Weekly exec sync — Loomwork. Present: Maya Chen (CEO), Priya Nair (Head of Sales), Devin Park (CTO).

ICP / market
Maya: On paper our ICP is still mid-market logistics operators running 50 to 500 trucks, sold self-serve.
Priya: Reality is drifting. Three of my last five qualified deals were enterprise carriers with more than 2,000 trucks, and they came inbound.
Maya: But we have not formally redefined the ICP — leadership hasn't signed off on moving upmarket, so officially we are still a mid-market company.
Priya: The enterprise deals are bigger but procurement is brutal — they want SSO, a signed DPA, and data residency before they will even pilot.
Devin: If we chase enterprise we have to staff it. That is a real go-to-market change, not a tweak.

Deals / the objection
Priya: The thing killing mid-market deals is almost never the product. It is budget authority — the champion loves us, then it stalls at the VP or finance sign-off.
Priya: At Ringer Logistics, Dana Okonkwo told me point blank she cannot approve anything over ten thousand dollars without her VP and procurement.
Priya: Same shape at Meridian Logistics and at Crossdock Group — the person who loves the product is one level below the person who controls the spend.
Maya: So it is a recurring, cross-account pattern, not a one-off. Budget authority sitting a level above our champion.

Competition
Priya: We lost Halberd Freight to FreightPilot this quarter. That is the third deal we have lost to FreightPilot.
Maya: FreightPilot keeps coming up, and prospects say we look similar to them from the outside.
Devin: We should be honest that FreightPilot is our most common competitive loss right now.

Renewals
Priya: Heads up — two mid-market renewals are looking shaky and could slip if we do not get ahead of them.

Runway / finance
Devin: At the May board meeting we reported eighteen months of runway at our then-current burn.
Devin: Since then we closed two senior engineering hires, which pushed monthly burn up materially, so that eighteen-month figure is already stale.
Devin: If we proceed with the two account-executive hires Priya wants, runway tightens to roughly nine months.
Maya: So the runway number I can defend to the board depends entirely on whether we greenlight the AE hires.

Follow-ups
Maya: I will prep the board update with both runway scenarios. Priya owns a plan to get mid-market deals under the sign-off threshold. Devin recalculates burn after the engineering hires before Friday.`;

const COLORS: Record<string, string> = { person: "#60a5fa", company: "#34d399", competitor: "#f87171", investor: "#fbbf24" };
const PROMO: Record<string, string> = { decision_grade: "#34d399", validated: "#60a5fa", emerging: "#fbbf24", candidate: "#64748b" };

function stageStatus(steps: IngestStep[], key: string): "done" | "active" | "pending" {
  if (steps.some((s) => s.stage === key && s.phase === "done")) return "done";
  const last = steps[steps.length - 1];
  if (last && last.stage === key) return "active";
  return "pending";
}

/** Circular entity graph — nodes laid around a ring, typed edges as lines. The memory, drawn. */
function EntityGraph({ data }: { data: IngestData }) {
  const ents = data.entities?.filter((e) => "id" in e && e.id) as { id: string; name: string; type: string }[] | undefined;
  const edges = data.edges ?? [];
  if (!ents || !ents.length) return null;
  const W = 540, H = 420, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 70;
  const pos = new Map<string, { x: number; y: number }>();
  ents.forEach((e, i) => {
    const a = (2 * Math.PI * i) / ents.length - Math.PI / 2;
    pos.set(e.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  });
  return (
    <svg className="egraph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="entity graph">
      {edges.map((e, i) => {
        const a = pos.get(e.from_id), b = pos.get(e.to_id);
        if (!a || !b) return null;
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#33415588" strokeWidth={1} />
            <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} className="eedge">{e.predicate}</text>
          </g>
        );
      })}
      {ents.map((e) => {
        const p = pos.get(e.id)!;
        return (
          <g key={e.id}>
            <circle cx={p.x} cy={p.y} r={7} fill={COLORS[e.type] ?? "#94a3b8"} />
            <text x={p.x} y={p.y - 12} className="enode" textAnchor="middle">{e.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function MemoryLab({
  steps, busy, onIngest, onReset,
}: { steps: IngestStep[]; busy: boolean; onIngest: (src: string) => void; onReset: () => void }) {
  const [src, setSrc] = useState("");
  // each stage's done event carries its own data slice; merge them into one accumulated view
  const acc = useMemo(() => steps.reduce<IngestData>((a, s) => (s.data ? { ...a, ...s.data } : a), {}), [steps]);
  const traceLines = useMemo(
    () => steps.filter((s) => s.phase === "active" && s.detail.length).flatMap((s) => s.detail.map((d) => ({ stage: s.stage, d }))),
    [steps],
  );
  const err = steps.find((s) => s.stage === "error");
  const done = steps.some((s) => s.stage === "done");

  return (
    <div className="memlab">
      <div className="card">
        <div className="mlhead">
          <strong>Paste raw items</strong>
          <span className="muted">one or many — each with its own <code>--- id/type ---</code> header; they add to memory</span>
          <button className="link" disabled={busy} onClick={() => setSrc(EXAMPLE)}>load example</button>
          <button className="link" disabled={busy} onClick={async () => setSrc(await loadCorpusText())}>load corpus</button>
          <button
            className="link danger"
            disabled={busy}
            onClick={() => { if (confirm("Wipe the ENTIRE memory (facts, signals, positions, decisions) and start fresh?")) onReset(); }}
          >
            clean memory
          </button>
        </div>
        <textarea
          className="mlbox"
          placeholder={"--- frontmatter ---\nid: call/acme-eval\ntype: call\ndate: 2026-06-10\nparticipants: [Priya Nair, Dana Okonkwo]\n---\n…paste the transcript / email / note here…"}
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          rows={10}
        />
        <div className="mlactions">
          <button className="primary" disabled={busy || !src.trim()} onClick={() => onIngest(src)}>
            {busy ? "Ingesting…" : "Ingest → build memory"}
          </button>
          <span className="muted small">runs the full Phase-1 spine: extract → connect → signals → positions</span>
        </div>
      </div>

      {/* pipeline stepper */}
      {steps.length > 0 && (
        <div className="stepper">
          {STAGES.map((st, i) => {
            const status = stageStatus(steps, st.key);
            return (
              <div key={st.key} className={`pstep ${status}`}>
                <div className="dot">{status === "done" ? "✓" : i + 1}</div>
                <div className="slabel">{st.label}</div>
                <div className="ssub">{st.sub}</div>
              </div>
            );
          })}
        </div>
      )}

      {err && <div className="card errcard">⚠ {err.label}</div>}

      {acc.sources && acc.sources.length > 0 && (
        <div className="card">
          <h3>Ingested items <span className="muted small">({acc.sources.length})</span></h3>
          {acc.sources.map((s) => (
            <div key={s.id} className="srcrow">
              <span className="chip src">{s.type}</span>
              <strong>{s.id}</strong>
              <span className="muted small">{s.date}</span>
              {s.participants.length > 0 && <span className="muted small">· {s.participants.join(", ")}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="mlgrid">
        <div className="mlcol">
          {/* extracted facts */}
          {acc.facts && (
            <section className="card">
              <h3>Typed facts <span className="muted small">({acc.facts.length}{acc.rejected ? ` · ${acc.rejected} rejected` : ""})</span></h3>
              {acc.facts.length === 0 && <div className="muted small">no new facts (already in memory, or none verifiable).</div>}
              {acc.facts.map((f) => (
                <div key={f.id} className="fact">
                  <div className="fmeta">
                    <span className="chip ty">{f.type}</span>
                    {f.dimension && <span className="chip dim">{f.dimension}</span>}
                    <span className="chip tier">{f.evidence_tier}</span>
                    {f.speaker && <span className="muted small">{f.speaker}</span>}
                  </div>
                  <div className="fval">{f.value}</div>
                  <div className="fquote">“{f.quote}”</div>
                </div>
              ))}
            </section>
          )}

          {/* live trace */}
          {traceLines.length > 0 && (
            <section className="card">
              <h3>Trace</h3>
              <div className="tracebox">
                {traceLines.map((t, i) => (
                  <div key={i} className="tline"><span className="tstage">{t.stage}</span> {t.d}</div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="mlcol">
          {/* entity graph */}
          {acc.entities && (acc.entities as { id?: string }[]).some((e) => e.id) && (
            <section className="card">
              <h3>Entity graph <span className="muted small">({(acc.entities as unknown[]).length} entities · {acc.edges?.length ?? 0} edges)</span></h3>
              <EntityGraph data={acc} />
            </section>
          )}

          {/* contradictions */}
          {acc.contradictions && acc.contradictions.length > 0 && (
            <section className="card">
              <h3>Contradictions <span className="muted small">({acc.contradictions.length})</span></h3>
              {acc.contradictions.map((c, i) => (
                <div key={i} className="contra"><span className="chip warn">{c.kind}</span> {c.note}</div>
              ))}
            </section>
          )}

          {/* signals */}
          {acc.signals && (
            <section className="card">
              <h3>Signals <span className="muted small">({acc.signals.length})</span></h3>
              <div className="sigwrap">
                {acc.signals.slice(0, 12).map((s, i) => (
                  <div key={i} className="sig" style={{ borderColor: PROMO[s.promotion] ?? "#334155" }}>
                    <span className="chip" style={{ background: (PROMO[s.promotion] ?? "#334155") + "22", color: PROMO[s.promotion] }}>{s.promotion}</span>
                    <span className="stype">{s.type}</span>
                    <span className="slbl">{s.label}</span>
                    <span className="muted small">×{s.count} · {s.companies.length} co.</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* positions */}
          {acc.positions && (
            <section className="card">
              <h3>Positions <span className="muted small">({acc.positions.length})</span></h3>
              {acc.positions.map((p, i) => (
                <div key={i} className="posrow">
                  <div className="phead"><strong>{p.name}</strong> <span className={`chip conf ${p.confidence}`}>{p.confidence}</span> <span className="muted small">{p.gaps.length} open gaps</span></div>
                  <div className="psum">{p.summary}</div>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>

      {done && acc.counts && (
        <div className="card donebar">
          ✓ memory updated — <strong>{acc.counts.facts}</strong> facts · <strong>{acc.counts.signals}</strong> signals · <strong>{acc.counts.positions}</strong> positions in the brain
        </div>
      )}
    </div>
  );
}
