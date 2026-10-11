import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./lib/supabase";
import Login from "./components/Login";
import Workspace from "./components/Workspace";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [member, setMember] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setMember(undefined);
    if (!session) return;
    supabase.from("lern_members").select("user_id").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => setMember(Boolean(data)));
  }, [session?.user.id]);

  if (!configured) return <Shell><p>Die App ist noch nicht mit Supabase verbunden.</p></Shell>;
  if (session === undefined) return <Shell><p className="muted">Lädt …</p></Shell>;
  if (!session) return <Login />;
  if (member === undefined) return <Shell><p className="muted">Lädt …</p></Shell>;
  if (!member)
    return (
      <Shell>
        <h2>Kein Zugang</h2>
        <p>Das Konto <strong>{session.user.email}</strong> ist für Skript-Frage nicht freigeschaltet.</p>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Abmelden</button>
      </Shell>
    );
  return <Workspace email={session.user.email ?? ""} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="center-shell">
      <div className="center-card">
        <h1 className="wordmark"><span>Skript-Frage</span></h1>
        {children}
      </div>
    </div>
  );
}
