import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(/invalid/i.test(error.message) ? "E-Mail oder Passwort stimmt nicht." : error.message);
  }

  return (
    <div className="center-shell">
      <form className="center-card" onSubmit={submit}>
        <h1 className="wordmark"><span>Skript-Frage</span></h1>
        <p className="muted">Klausurantworten ausschließlich aus deinen Skripten, mit Belegstellen.</p>
        <label className="field">
          <span className="label">E-Mail</span>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="label">Passwort</span>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Anmelden …" : "Anmelden"}</button>
        <p className="note">Melde dich mit deinem bestehenden Konto an (dasselbe wie in deiner Firmen-App).</p>
      </form>
    </div>
  );
}
