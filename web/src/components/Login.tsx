import { useState } from "react";
import { login, registerCompany, type Auth } from "../api";

/**
 * The auth gate. Until you log in, the app sends no token → the API answers 401 on every data surface
 * (including the destructive /reset). Login/register return a JWT carrying your tenant_id; the rest of
 * the app then runs scoped to that one company. Demo login is pre-filled (demo@demo.test / demo1234).
 */
const fieldStyle: React.CSSProperties = {
  padding: ".55rem .7rem", borderRadius: 8, border: "1px solid #d0d7de", fontSize: ".95rem", background: "#fff", color: "#111",
};

export function Login({ onAuthed }: { onAuthed: (a: Auth) => void }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("demo@demo.test");
  const [password, setPassword] = useState("demo1234");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const auth = tab === "login" ? await login(email, password) : await registerCompany(name, email, password);
      onAuthed(auth);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <header>
        <h1>Decision Brain</h1>
        <div className="sub">one deployment · many companies · each one's memory walled off from the rest</div>
      </header>

      <div className="card" style={{ maxWidth: 420, margin: "2rem auto" }}>
        <div className="tabs" style={{ marginBottom: "1rem" }}>
          <button className={tab === "login" ? "tab on" : "tab"} onClick={() => setTab("login")} type="button">
            Log in
          </button>
          <button className={tab === "register" ? "tab on" : "tab"} onClick={() => setTab("register")} type="button">
            New company
          </button>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
          {tab === "register" && (
            <input style={fieldStyle} placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} required />
          )}
          <input style={fieldStyle} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input style={fieldStyle} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="mode on" disabled={busy} type="submit">
            {busy ? "…" : tab === "login" ? "Log in" : "Create company & log in"}
          </button>
          {err && <div className="errcard" style={{ padding: ".5rem .7rem" }}>⚠ {err}</div>}
        </form>

        <div className="sub" style={{ marginTop: ".8rem", fontSize: ".82rem" }}>
          Demo: <code>demo@demo.test</code> / <code>demo1234</code> — or create a new company to see a fresh, isolated brain.
        </div>
      </div>
    </div>
  );
}
