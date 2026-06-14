import { useRef, useState } from "react";
import { askStream, ingestStream, resetMemory, resolveDecision, getToken, logout } from "./api";
import type { Decision, IngestStep, Status, Step } from "./types";
import { Login } from "./components/Login";
import { QueryBox } from "./components/QueryBox";
import { AgentFlow } from "./components/AgentFlow";
import { Trace } from "./components/Trace";
import { AnswerCard } from "./components/AnswerCard";
import { MemoryLab } from "./components/MemoryLab";
import { DatabaseView } from "./components/DatabaseView";
import { DataModel } from "./components/DataModel";

type Mode = "ask" | "memory" | "database" | "schema";
type Auth = { token: string; email: string };

export function App() {
  // The auth gate. This is the ONLY state that survives login/logout. The actual app below is a separate
  // component mounted with key={token}, so switching company fully REMOUNTS it — every brain's UI state
  // (the build-memory graph, ask results, fetched tables) is wiped, never carried across tenants.
  const [auth, setAuth] = useState<Auth | null>(() => {
    const t = getToken();
    return t ? { token: t, email: "you" } : null;
  });

  if (!auth) return <Login onAuthed={(a) => setAuth({ token: a.token, email: a.email })} />;

  return (
    <MainApp
      key={auth.token}
      auth={auth}
      onLogout={() => { logout(); setAuth(null); }}
    />
  );
}

function MainApp({ auth, onLogout }: { auth: Auth; onLogout: () => void }) {
  const [mode, setMode] = useState<Mode>("ask");

  // ── ask mode ──
  const [steps, setSteps] = useState<Step[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"flow" | "trace">("flow");
  const esRef = useRef<EventSource | null>(null);

  // ── memory mode ──
  const [ingestSteps, setIngestSteps] = useState<IngestStep[]>([]);
  const [ingestBusy, setIngestBusy] = useState(false);
  const ingRef = useRef<EventSource | null>(null);

  function ask(q: string) {
    if (!q.trim() || busy) return;
    esRef.current?.close();
    setSteps([]);
    setDecision(null);
    setBusy(true);
    esRef.current = askStream(
      q,
      (s) => {
        setSteps((prev) => [...prev, s]);
        if (s.decision) setDecision(s.decision);
      },
      () => setBusy(false),
    );
  }

  function ingest(srcText: string) {
    if (!srcText.trim() || ingestBusy) return;
    ingRef.current?.close();
    setIngestSteps([]);
    setIngestBusy(true);
    ingRef.current = ingestStream(
      srcText,
      (s) => setIngestSteps((prev) => [...prev, s]),
      () => setIngestBusy(false),
    );
  }

  async function resetMem() {
    if (ingestBusy) return;
    ingRef.current?.close();
    setIngestBusy(true);
    const r = await resetMemory();
    setIngestSteps(
      r.ok
        ? [{ stage: "done", phase: "done", label: "memory cleared — paste items to rebuild", detail: [], data: { counts: r.counts } }]
        : [{ stage: "error", phase: "done", label: r.error ?? "reset failed", detail: [] }],
    );
    setIngestBusy(false);
  }

  async function decide(verdict: Status) {
    if (!decision) return;
    await resolveDecision(decision.id, verdict);
    setDecision((d) => (d ? { ...d, status: verdict } : d));
  }

  return (
    <div className="wrap">
      <header>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: ".6rem", alignItems: "center", fontSize: ".82rem" }}>
          <span className="sub">signed in · {auth.email}</span>
          <button className="tab" onClick={onLogout}>Log out</button>
        </div>
        <h1>Decision Brain</h1>
        <div className="sub">
          {mode === "ask"
            ? "ask a CEO question · watch the agent think · approve the recommendation"
            : mode === "memory"
            ? "paste a raw item · watch it become typed memory · facts → graph → signals → positions"
            : mode === "database"
            ? "the persisted tables · click a fact to trace it back to its exact source quote"
            : "the exact tables · the connections between them · and why each one exists"}
        </div>
      </header>

      <div className="modes">
        <button className={mode === "ask" ? "mode on" : "mode"} onClick={() => setMode("ask")}>
          Ask the brain
        </button>
        <button className={mode === "memory" ? "mode on" : "mode"} onClick={() => setMode("memory")}>
          Build memory
        </button>
        <button className={mode === "database" ? "mode on" : "mode"} onClick={() => setMode("database")}>
          Database
        </button>
        <button className={mode === "schema" ? "mode on" : "mode"} onClick={() => setMode("schema")}>
          Data model
        </button>
      </div>

      {mode === "ask" ? (
        <>
          <QueryBox busy={busy} onAsk={ask} />
          {(() => {
            const e = steps.find((s) => s.node === "error");
            return e ? <div className="card errcard">⚠ {e.label}</div> : null;
          })()}
          <div className="tabs">
            <button className={view === "flow" ? "tab on" : "tab"} onClick={() => setView("flow")}>
              Flow
            </button>
            <button className={view === "trace" ? "tab on" : "tab"} onClick={() => setView("trace")}>
              Trace
            </button>
          </div>
          {view === "flow" ? <AgentFlow steps={steps} busy={busy} /> : <Trace steps={steps} />}
          {decision && <AnswerCard decision={decision} onDecide={decide} />}
        </>
      ) : mode === "memory" ? (
        <MemoryLab steps={ingestSteps} busy={ingestBusy} onIngest={ingest} onReset={resetMem} />
      ) : mode === "database" ? (
        <DatabaseView />
      ) : (
        <DataModel />
      )}
    </div>
  );
}
