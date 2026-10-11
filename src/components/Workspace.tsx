import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Doc, QSet, Question } from "../lib/types";
import {
  addQuestions, answerQuestion, createSet, deleteQuestion, deleteSet, listDocs, listQuestions, listSets,
  renameSet, updateQuestionText,
} from "../lib/api";
import Library from "./Library";
import QuestionCard from "./QuestionCard";
import ImportDialog from "./ImportDialog";
import StudySheet from "./StudySheet";

const PARALLEL = 2;
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

export default function Workspace({ email }: { email: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [sets, setSets] = useState<QSet[]>([]);
  const [setId, setSetId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"fragen" | "lernzettel">("fragen");
  const [ask, setAsk] = useState("");
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [setArmed, setSetArmed] = useState(false);
  const stopRef = useRef(false);
  const toastTimer = useRef<number>(0);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(""), 4200);
  }, []);

  // Laden
  useEffect(() => {
    (async () => {
      try {
        const [d, s] = await Promise.all([listDocs(), listSets()]);
        setDocs(d);
        setSets(s);
        const remembered = lsGet("sf-set");
        setSetId(s.find((x) => x.id === remembered)?.id ?? s[s.length - 1]?.id ?? null);
      } catch (e) {
        toast("Daten konnten nicht geladen werden: " + (e instanceof Error ? e.message : ""));
      }
      setLoading(false);
    })();
  }, [toast]);

  useEffect(() => {
    if (!setId) { setQuestions([]); return; }
    lsSet("sf-set", setId);
    let alive = true;
    listQuestions(setId).then((q) => alive && setQuestions(q)).catch(() => toast("Fragen konnten nicht geladen werden."));
    return () => { alive = false; };
  }, [setId, toast]);

  const docMap = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const currentSet = sets.find((s) => s.id === setId) ?? null;
  const openCount = questions.filter((q) => q.status === "offen" || q.status === "fehler").length;
  const answeredCount = questions.filter((q) => ["beantwortet", "teilweise", "nicht_im_skript"].includes(q.status)).length;

  const patch = (q: Question) => setQuestions((list) => list.map((x) => (x.id === q.id ? q : x)));

  async function runOne(id: string) {
    setRunning((r) => new Set(r).add(id));
    try {
      patch(await answerQuestion(id));
    } catch (e) {
      setQuestions((list) => list.map((x) => (x.id === id ? { ...x, status: "fehler", error: e instanceof Error ? e.message : "Fehler" } : x)));
    } finally {
      setRunning((r) => { const n = new Set(r); n.delete(id); return n; });
    }
  }

  async function runMany(ids: string[]) {
    if (!ids.length) return;
    if (!docs.some((d) => d.active)) { toast("Lade zuerst ein Skript hoch oder aktiviere eines."); return; }
    stopRef.current = false;
    setBatch({ done: 0, total: ids.length });
    const queue = [...ids];
    const worker = async () => {
      while (queue.length && !stopRef.current) {
        const id = queue.shift()!;
        await runOne(id);
        setBatch((b) => (b ? { ...b, done: b.done + 1 } : b));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, ids.length) }, worker));
    setBatch(null);
    if (stopRef.current) toast("Angehalten. Die übrigen Fragen bleiben offen.");
  }

  async function ensureSet(): Promise<string> {
    if (setId) return setId;
    const s = await createSet("Meine Fragen");
    setSets((x) => [...x, s]);
    setSetId(s.id);
    return s.id;
  }

  async function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    const text = ask.trim();
    if (!text) return;
    if (!docs.some((d) => d.active)) { toast("Lade zuerst ein Skript hoch oder aktiviere eines."); return; }
    try {
      const sid = await ensureSet();
      const maxPos = questions.reduce((m, q) => Math.max(m, q.position), -1);
      const [q] = await addQuestions(sid, [text], maxPos + 1);
      setQuestions((list) => [...list, q]);
      setAsk("");
      setView("fragen");
      requestAnimationFrame(() => document.getElementById("q-" + q.id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
      runMany([q.id]);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Frage konnte nicht gespeichert werden.");
    }
  }

  async function doImport(target: { setId: string } | { title: string }, texts: string[], answerNow: boolean) {
    let sid: string;
    if ("setId" in target) sid = target.setId;
    else {
      const s = await createSet(target.title);
      setSets((x) => [...x, s]);
      sid = s.id;
    }
    const existing = sid === setId ? questions : await listQuestions(sid);
    const maxPos = existing.reduce((m, q) => Math.max(m, q.position), -1);
    const added = await addQuestions(sid, texts, maxPos + 1);
    if (sid === setId) setQuestions((list) => [...list, ...added]);
    else { setSetId(sid); setQuestions([...existing, ...added]); }
    setView("fragen");
    toast(`${added.length} ${added.length === 1 ? "Frage" : "Fragen"} übernommen`);
    if (answerNow) runMany(added.map((q) => q.id));
  }

  async function newSet() {
    try {
      const s = await createSet("Fragenkatalog " + (sets.length + 1));
      setSets((x) => [...x, s]);
      setSetId(s.id);
      setRenaming(true);
    } catch { toast("Katalog konnte nicht angelegt werden."); }
  }

  async function removeSet() {
    if (!currentSet) return;
    if (!setArmed) { setSetArmed(true); setTimeout(() => setSetArmed(false), 4000); return; }
    setSetArmed(false);
    try {
      await deleteSet(currentSet.id);
      const rest = sets.filter((s) => s.id !== currentSet.id);
      setSets(rest);
      setSetId(rest[rest.length - 1]?.id ?? null);
      toast(`„${currentSet.title}“ gelöscht`);
    } catch { toast("Löschen hat nicht geklappt."); }
  }

  async function changePassword() {
    setMenu(false);
    const pw = window.prompt?.("Neues Passwort (mindestens 8 Zeichen):");
    if (!pw) return;
    if (pw.length < 8) { toast("Das Passwort muss mindestens 8 Zeichen haben."); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    toast(error ? "Passwort konnte nicht geändert werden: " + error.message : "Passwort geändert");
  }

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand">
          <span className="wordmark small"><span>Skript-Frage</span></span>
          <span className="tagline">Klausurantworten nur aus deinen Skripten</span>
        </div>
        <div className="account">
          <button type="button" className="link" aria-expanded={menu} onClick={() => setMenu(!menu)}>{email}</button>
          {menu && (
            <div className="menu" role="menu">
              <button type="button" role="menuitem" onClick={changePassword}>Passwort ändern</button>
              <button type="button" role="menuitem" onClick={() => supabase.auth.signOut()}>Abmelden</button>
            </div>
          )}
        </div>
      </header>

      <div className="layout">
        <div className="no-print">
          <Library docs={docs} setDocs={setDocs} toast={toast} />
        </div>

        <main className="main">
          <form className="panel askbox no-print" onSubmit={submitAsk}>
            <label className="label" htmlFor="ask">Einzelne Frage stellen</label>
            <textarea id="ask" rows={2} value={ask} onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }}
              placeholder="z. B. Was versteht man unter einer Wärmebrücke?" />
            <div className="askbar">
              <button type="button" className="btn ghost" onClick={() => setImporting(true)}>Fragenkatalog importieren</button>
              <button type="submit" className="btn" disabled={!ask.trim()}>Im Skript nachschlagen</button>
            </div>
          </form>

          {loading ? (
            <p className="muted">Lädt …</p>
          ) : sets.length === 0 ? (
            <div className="empty-state">
              <h2>So geht's</h2>
              <ol>
                <li>Links deine Skripte hochladen (PDF, Word oder Text).</li>
                <li>Oben eine Frage eintippen oder einen ganzen Fragenkatalog importieren.</li>
                <li>Du bekommst zu jeder Frage eine zusammengefasste Klausurantwort. Jede Aussage ist mit der Stelle im Skript belegt.</li>
              </ol>
            </div>
          ) : (
            <>
              <div className="setbar no-print">
                <div className="set-pick">
                  {renaming && currentSet ? (
                    <input id="set-title" className="set-title-input" autoFocus defaultValue={currentSet.title}
                      onBlur={async (e) => {
                        const t = e.target.value.trim(); setRenaming(false);
                        if (t && t !== currentSet.title) { setSets((x) => x.map((s) => (s.id === currentSet.id ? { ...s, title: t } : s))); await renameSet(currentSet.id, t).catch(() => toast("Umbenennen hat nicht geklappt.")); }
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                  ) : (
                    <select id="set-select" value={setId ?? ""} onChange={(e) => { setSetId(e.target.value); setView("fragen"); }} aria-label="Fragenkatalog">
                      {sets.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                  )}
                  <span className="muted small">{questions.length} Fragen · {answeredCount} beantwortet</span>
                </div>
                <div className="set-actions">
                  <button type="button" className="link" onClick={() => setRenaming(true)}>Umbenennen</button>
                  <button type="button" className="link" onClick={newSet}>Neuer Katalog</button>
                  <button type="button" className={"link danger" + (setArmed ? " armed" : "")} onClick={removeSet}>{setArmed ? "Katalog wirklich löschen?" : "Löschen"}</button>
                </div>
              </div>

              <div className="tabs no-print" role="tablist">
                <button role="tab" type="button" aria-selected={view === "fragen"} onClick={() => setView("fragen")}>Fragen & Antworten</button>
                <button role="tab" type="button" aria-selected={view === "lernzettel"} onClick={() => setView("lernzettel")}>Lernzettel</button>
                <span className="tabs-spacer" />
                {view === "fragen" && (batch ? (
                  <span className="batch">
                    <span className="progress" aria-hidden="true"><span style={{ width: `${(batch.done / batch.total) * 100}%` }} /></span>
                    <span className="small">{batch.done} / {batch.total}</span>
                    <button type="button" className="btn ghost sm" onClick={() => { stopRef.current = true; }}>Anhalten</button>
                  </span>
                ) : openCount > 0 ? (
                  <button type="button" className="btn sm" onClick={() => runMany(questions.filter((q) => q.status === "offen" || q.status === "fehler").map((q) => q.id))}>
                    {openCount} offene {openCount === 1 ? "Frage" : "Fragen"} beantworten
                  </button>
                ) : null)}
              </div>

              {view === "fragen" ? (
                <div className="feed">
                  {questions.length === 0 && <p className="muted">Dieser Katalog ist noch leer. Stell oben eine Frage oder importiere einen Fragenkatalog.</p>}
                  {questions.map((q, i) => (
                    <QuestionCard key={q.id} q={q} n={i + 1} docs={docMap} busy={running.has(q.id)} toast={toast}
                      onAnswer={() => runMany([q.id])}
                      onEdit={async (t) => { try { patch(await updateQuestionText(q.id, t)); runMany([q.id]); } catch { toast("Speichern hat nicht geklappt."); } }}
                      onDelete={async () => { try { await deleteQuestion(q.id); setQuestions((l) => l.filter((x) => x.id !== q.id)); } catch { toast("Löschen hat nicht geklappt."); } }}
                    />
                  ))}
                </div>
              ) : currentSet && (
                <StudySheet set={currentSet} questions={questions} />
              )}
            </>
          )}
        </main>
      </div>

      {importing && <ImportDialog sets={sets} currentSetId={setId} onClose={() => setImporting(false)} onImport={doImport} />}
      {toastMsg && <div className="toast no-print" role="status">{toastMsg}</div>}
    </div>
  );
}
