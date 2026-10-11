import { useEffect, useRef, useState } from "react";
import { parseQuestions, readPlain } from "../lib/extract";
import type { QSet } from "../lib/types";

type Props = {
  sets: QSet[];
  currentSetId: string | null;
  onClose: () => void;
  onImport: (target: { setId: string } | { title: string }, questions: string[], answerNow: boolean) => Promise<void>;
};

export default function ImportDialog({ sets, currentSetId, onClose, onImport }: Props) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<string>(currentSetId ?? "__new");
  const [title, setTitle] = useState("Fragenkatalog " + new Date().toLocaleDateString("de-DE"));
  const [answerNow, setAnswerNow] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => { ref.current?.showModal(); }, []);
  const questions = parseQuestions(text);

  async function loadFile(f?: File) {
    if (!f) return;
    setError("");
    setBusy(`${f.name} wird gelesen …`);
    try {
      const t = await readPlain(f);
      const qs = parseQuestions(t);
      if (!qs.length) setError("In der Datei wurden keine Fragen erkannt. Du kannst sie unten auch direkt einfügen.");
      setText(qs.join("\n"));
      if (target === "__new") setTitle(f.name.replace(/\.[^.]+$/, ""));
    } catch {
      setError("Die Datei konnte nicht gelesen werden.");
    }
    setBusy("");
  }

  async function save() {
    if (!questions.length) { setError("Füge mindestens eine Frage ein."); return; }
    setBusy("Wird gespeichert …");
    try {
      await onImport(target === "__new" ? { title: title.trim() || "Fragenkatalog" } : { setId: target }, questions, answerNow);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern hat nicht geklappt.");
      setBusy("");
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="imp-title">
      <div className="dialog-body">
        <div className="row">
          <h2 id="imp-title">Fragen importieren</h2>
          <button type="button" className="link" onClick={() => ref.current?.close()}>Schließen</button>
        </div>

        <label className="drop compact">
          <input id="q-upload" type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ""; }} />
          <strong>Fragenkatalog als Datei</strong>
          <small>PDF, Word oder Text. Nummerierte Fragen werden erkannt.</small>
        </label>

        <label className="field">
          <span className="label">Fragen, eine pro Zeile ({questions.length} erkannt)</span>
          <textarea id="q-paste" rows={9} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={"1. Was ist der U-Wert und in welcher Einheit wird er angegeben?\n2. Nennen Sie drei typische Wärmebrücken.\n3. Wie funktioniert der Blower-Door-Test?"} />
        </label>

        <div className="grid2">
          <label className="field">
            <span className="label">Speichern in</span>
            <select id="q-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="__new">Neuer Katalog</option>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          {target === "__new" && (
            <label className="field">
              <span className="label">Name des Katalogs</span>
              <input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          )}
        </div>

        <label className="check">
          <input id="q-now" type="checkbox" checked={answerNow} onChange={(e) => setAnswerNow(e.target.checked)} />
          Alle Fragen direkt beantworten lassen
        </label>

        {error && <p className="error-text">{error}</p>}
        <div className="dialog-foot">
          {busy && <span className="note busy-line"><span className="dots"><i /><i /><i /></span>{busy}</span>}
          <button type="button" className="btn" disabled={!!busy || !questions.length} onClick={save}>
            {questions.length ? `${questions.length} ${questions.length === 1 ? "Frage" : "Fragen"} übernehmen` : "Fragen übernehmen"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
