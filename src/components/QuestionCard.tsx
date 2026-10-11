import { useState } from "react";
import type { Citation, Doc, Question } from "../lib/types";
import { openOriginal } from "../lib/api";

export const STATUS: Record<Question["status"], [string, string]> = {
  offen: ["wait", "Noch offen"],
  laeuft: ["wait", "Wird beantwortet"],
  beantwortet: ["ok", "Im Skript beantwortet"],
  teilweise: ["part", "Nur teilweise im Skript"],
  nicht_im_skript: ["no", "Steht nicht im Skript"],
  fehler: ["no", "Fehler"],
};

type Props = {
  q: Question;
  n: number;
  docs: Map<string, Doc>;
  busy: boolean;
  onAnswer: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  toast: (m: string) => void;
};

/** Text mit [S3, S7] in Text + klickbare Quellenmarken zerlegen. */
export function withRefs(text: string, onRef: (ref: string) => void, cites: Map<string, Citation>) {
  const parts = text.split(/(\[(?:\s*S\d+\s*,?)+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[((?:\s*S\d+\s*,?)+)\]$/);
    if (!m) return <span key={i}>{p}</span>;
    return (
      <span key={i} className="refs">
        {m[1].split(",").map((r) => r.trim()).filter(Boolean).map((r) => (
          <button key={r} type="button" className={"cite" + (cites.get(r)?.found === false ? " weak" : "")}
            onClick={() => onRef(r)} title={citeTitle(cites.get(r))}>{r}</button>
        ))}
      </span>
    );
  });
}
const citeTitle = (c?: Citation) => (c ? `${c.doc_title}${c.loc ? ", " + c.loc : ""}` : "Quelle");

export default function QuestionCard({ q, n, docs, busy, onAnswer, onEdit, onDelete, toast }: Props) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(q.question);
  const [armed, setArmed] = useState(false);
  const cites = new Map(q.citations.map((c) => [c.ref, c]));
  const [cls, label] = STATUS[q.status];
  const running = q.status === "laeuft" || busy;
  const answered = ["beantwortet", "teilweise", "nicht_im_skript"].includes(q.status);
  const unverified = q.citations.filter((c) => !c.found).length;

  function showRef(ref: string) {
    setOpen(true);
    setFlash(ref);
    requestAnimationFrame(() => {
      document.getElementById(`ev-${q.id}-${ref}`)?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center",
      });
    });
    setTimeout(() => setFlash(null), 1800);
  }

  return (
    <article className="card" id={"q-" + q.id}>
      <header className="card-head">
        <div className="chips">
          <span className="qnum">{n}</span>
          <span className={"pill " + (running ? "wait" : cls)}>{running ? "Wird beantwortet" : label}</span>
          {answered && q.citations.length > 0 && (
            <span className="pill ghost">{q.citations.length} {q.citations.length === 1 ? "Beleg" : "Belege"}{unverified ? ` · ${unverified} ungeprüft` : ""}</span>
          )}
        </div>
        {editing ? (
          <div className="edit-row">
            <textarea id={"edit-" + q.id} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
            <div className="btns">
              <button className="btn ghost sm" type="button" onClick={() => { setEditing(false); setDraft(q.question); }}>Abbrechen</button>
              <button className="btn sm" type="button" onClick={() => { setEditing(false); if (draft.trim() && draft.trim() !== q.question) onEdit(draft.trim()); }}>Speichern</button>
            </div>
          </div>
        ) : (
          <h3 className="question">{q.question}</h3>
        )}
      </header>

      {running && (
        <div className="answer"><span className="busy-line"><span className="dots"><i /><i /><i /></span>Lese die Skripte und formuliere die Antwort …</span></div>
      )}

      {!running && answered && (
        <div className="answer">
          {q.summary && <p className="summary">{withRefs(q.summary, showRef, cites)}</p>}
          {q.points.length > 0 && (
            <ul className="points">
              {q.points.map((p, i) => (
                <li key={i}>
                  <span>{p.text}</span>
                  {p.refs.length > 0 && <span className="refs">{p.refs.map((r) => (
                    <button key={r} type="button" className={"cite" + (cites.get(r)?.found === false ? " weak" : "")}
                      onClick={() => showRef(r)} title={citeTitle(cites.get(r))}>{r}</button>
                  ))}</span>}
                </li>
              ))}
            </ul>
          )}
          {q.missing && <p className="missing"><strong>Nicht im Skript:</strong> {q.missing}</p>}
        </div>
      )}

      {!running && q.status === "fehler" && <p className="error-box">{q.error}</p>}
      {!running && q.status === "offen" && <p className="answer muted small">Noch nicht beantwortet.</p>}

      {!running && q.citations.length > 0 && (
        <div className="evid">
          <button type="button" className="evid-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Belegstellen ausblenden" : "Belegstellen aus dem Skript anzeigen"}
          </button>
          {open && q.citations.map((c) => {
            const doc = docs.get(c.document_id);
            return (
              <div key={c.ref} id={`ev-${q.id}-${c.ref}`} className={"ev" + (flash === c.ref ? " flash" : "")}>
                <div className="ev-head">
                  <span className="ev-id">{c.ref}</span>
                  <span className="ev-src">{c.doc_title}{c.loc ? " · " + c.loc : ""}</span>
                  {c.found
                    ? <span className="ev-check ok">✓ wörtlich im Skript</span>
                    : <span className="ev-check bad">{c.quote ? "Zitat nicht wörtlich gefunden, Stelle prüfen" : "Abschnitt ohne Zitat"}</span>}
                  {doc?.storage_path && (
                    <button type="button" className="link" onClick={() => openOriginal(doc, c.page).catch((e) => toast(e.message))}>
                      {c.page ? `PDF auf Seite ${c.page} öffnen` : "Original öffnen"}
                    </button>
                  )}
                </div>
                <p className="ev-text">
                  {c.cut_start && "… "}{c.before}{c.match && <mark>{c.match}</mark>}{c.after}{c.cut_end && " …"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <footer className="card-foot">
        {!running && (
          <button type="button" className="link" onClick={onAnswer}>
            {q.status === "offen" ? "Jetzt beantworten" : "Neu beantworten"}
          </button>
        )}
        {!running && !editing && <button type="button" className="link" onClick={() => setEditing(true)}>Frage bearbeiten</button>}
        {!running && (
          <button type="button" className={"link danger" + (armed ? " armed" : "")}
            onClick={() => { if (armed) onDelete(); else { setArmed(true); setTimeout(() => setArmed(false), 4000); } }}>
            {armed ? "Wirklich löschen?" : "Löschen"}
          </button>
        )}
      </footer>
    </article>
  );
}
