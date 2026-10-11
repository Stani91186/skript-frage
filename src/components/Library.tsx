import { useRef, useState } from "react";
import type { Doc } from "../lib/types";
import { deleteDoc, openOriginal, setDocActive, uploadDoc } from "../lib/api";

type Props = {
  docs: Doc[];
  setDocs: (fn: (d: Doc[]) => Doc[]) => void;
  toast: (m: string) => void;
};

export default function Library({ docs, setDocs, toast }: Props) {
  const [status, setStatus] = useState("");
  const [over, setOver] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function add(files: File[]) {
    for (const f of files) {
      try {
        const doc = await uploadDoc(f, setStatus);
        setDocs((d) => [...d, doc]);
        toast(`„${doc.title}“ hinzugefügt`);
      } catch (e) {
        toast(e instanceof Error ? e.message : `${f.name} konnte nicht gelesen werden.`);
      }
    }
    setStatus("");
  }

  async function toggle(doc: Doc) {
    setDocs((d) => d.map((x) => (x.id === doc.id ? { ...x, active: !x.active } : x)));
    try { await setDocActive(doc.id, !doc.active); } catch { toast("Änderung konnte nicht gespeichert werden."); }
  }

  async function remove(doc: Doc) {
    if (confirmId !== doc.id) {
      setConfirmId(doc.id);
      setTimeout(() => setConfirmId((c) => (c === doc.id ? null : c)), 4000);
      return;
    }
    setConfirmId(null);
    try {
      await deleteDoc(doc);
      setDocs((d) => d.filter((x) => x.id !== doc.id));
      toast(`„${doc.title}“ entfernt`);
    } catch { toast("Entfernen hat nicht geklappt."); }
  }

  const active = docs.filter((d) => d.active).length;
  const chars = docs.filter((d) => d.active).reduce((n, d) => n + d.char_count, 0);

  return (
    <aside className="panel lib" aria-label="Skripte">
      <div className="row">
        <h2>Skripte</h2>
        <span className="label">{docs.length ? `${active} von ${docs.length} aktiv` : ""}</span>
      </div>

      <label
        className={"drop" + (over ? " over" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}
      >
        <input ref={input} id="doc-upload" type="file" multiple accept=".pdf,.docx,.txt,.md"
          onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <strong>Skript hochladen</strong>
        <small>PDF, Word (.docx) oder Text: hierher ziehen oder klicken</small>
      </label>
      {status && <p className="note busy-line"><span className="dots"><i /><i /><i /></span>{status}</p>}

      {docs.length === 0 ? (
        <p className="muted small">Noch keine Skripte. Lade dein erstes Skript hoch, danach kannst du Fragen stellen.</p>
      ) : (
        <ul className="docs">
          {docs.map((d) => (
            <li key={d.id} className={d.active ? "" : "off"}>
              <input type="checkbox" id={"doc-" + d.id} checked={d.active} onChange={() => toggle(d)}
                aria-label={`${d.title} bei Fragen einbeziehen`} />
              <label htmlFor={"doc-" + d.id} className="doc-main">
                <span className="doc-title">{d.title}</span>
                <span className="doc-meta">
                  {d.kind}{d.page_count ? ` · ${d.page_count} Seiten` : ""} · {(d.char_count / 1000).toFixed(0)}k Zeichen
                </span>
              </label>
              <span className="doc-actions">
                {d.storage_path && (
                  <button className="link" type="button" onClick={() => openOriginal(d).catch((e) => toast(e.message))}>Öffnen</button>
                )}
                <button className={"link danger" + (confirmId === d.id ? " armed" : "")} type="button" onClick={() => remove(d)}>
                  {confirmId === d.id ? "Wirklich?" : "Entfernen"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {chars > 150_000 && (
        <p className="note">Die aktiven Skripte sind sehr umfangreich. Pro Frage werden dann nur die passendsten Abschnitte gelesen. Für vollständige Antworten nur die Skripte zum aktuellen Thema aktivieren.</p>
      )}
      <p className="note">Nur aktivierte Skripte werden für Antworten genutzt.</p>
    </aside>
  );
}
