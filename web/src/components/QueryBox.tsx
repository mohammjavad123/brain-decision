import { useState } from "react";

const EXAMPLES = [
  "What runway can I defend in this week's investor update?",
  "Is our ICP actually mid-market, or are we drifting up?",
  "Which objection is killing deals — and is it real?",
];

export function QueryBox({ busy, onAsk }: { busy: boolean; onAsk: (q: string) => void }) {
  const [q, setQ] = useState(EXAMPLES[0]!);
  return (
    <section>
      <textarea
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask a CEO question…"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onAsk(q);
        }}
      />
      <div className="row">
        <button className="primary" onClick={() => onAsk(q)} disabled={busy}>
          {busy ? "Thinking…" : "Ask"}
        </button>
        {busy && <span className="pulse" />}
        <span className="hint">⌘/Ctrl + Enter</span>
      </div>
      <div className="chips">
        {EXAMPLES.map((ex) => (
          <span key={ex} className="chip" onClick={() => !busy && setQ(ex)}>
            {ex}
          </span>
        ))}
      </div>
    </section>
  );
}
