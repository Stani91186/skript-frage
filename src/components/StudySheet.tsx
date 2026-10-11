import type { Citation, QSet, Question } from "../lib/types";

const short = (c?: Citation) => (c ? `${c.doc_title}${c.page ? ", S. " + c.page : c.loc ? ", " + c.loc : ""}` : "");

/** [S3, S7] durch lesbare Quellenangaben ersetzen. */
function refsToSources(text: string, cites: Map<string, Citation>) {
  return text.replace(/\[((?:\s*S\d+\s*,?)+)\]/g, (_m, ids: string) => {
    const s = [...new Set(ids.split(",").map((x) => x.trim()).filter(Boolean).map((r) => short(cites.get(r))).filter(Boolean))];
    return s.length ? `(${s.join("; ")})` : "";
  });
}

export function toMarkdown(set: QSet, qs: Question[]) {
  const out = [`# ${set.title}`, "", `_Lernzettel aus Skript-Frage, Stand ${new Date().toLocaleDateString("de-DE")}. Alle Antworten stammen ausschließlich aus den hochgeladenen Skripten._`, ""];
  qs.forEach((q, i) => {
    const cites = new Map(q.citations.map((c) => [c.ref, c]));
    out.push(`## ${i + 1}. ${q.question}`, "");
    if (q.status === "nicht_im_skript") out.push("> Steht nicht im Skript.", "");
    if (q.summary && q.status !== "nicht_im_skript") out.push(refsToSources(q.summary, cites), "");
    for (const p of q.points) out.push(`- ${p.text}${p.refs.length ? " (" + [...new Set(p.refs.map((r) => short(cites.get(r))))].join("; ") + ")" : ""}`);
    if (q.points.length) out.push("");
    if (q.missing && q.status !== "nicht_im_skript") out.push(`_Nicht im Skript:_ ${q.missing}`, "");
  });
  return out.join("\n");
}

export default function StudySheet({ set, questions }: { set: QSet; questions: Question[] }) {
  const done = questions.filter((q) => ["beantwortet", "teilweise", "nicht_im_skript"].includes(q.status));

  function download() {
    const blob = new Blob([toMarkdown(set, done)], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = set.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() + ".md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <section className="sheet-wrap">
      <div className="sheet-tools no-print">
        <p className="muted small">{done.length} von {questions.length} Fragen beantwortet. Offene Fragen erscheinen nicht auf dem Lernzettel.</p>
        <div className="btns">
          <button className="btn ghost" type="button" onClick={download} disabled={!done.length}>Als Markdown speichern</button>
          <button className="btn" type="button" onClick={() => window.print()} disabled={!done.length}>Drucken / als PDF</button>
        </div>
      </div>
      <article className="sheet">
        <header className="sheet-head">
          <h2>{set.title}</h2>
          <p>Lernzettel · {new Date().toLocaleDateString("de-DE")} · Antworten ausschließlich aus deinen Skripten</p>
        </header>
        {done.length === 0 && <p className="muted">Noch keine beantworteten Fragen in diesem Katalog.</p>}
        {done.map((q, i) => {
          const cites = new Map(q.citations.map((c) => [c.ref, c]));
          return (
            <section key={q.id} className="sheet-q">
              <h3><span className="sheet-n">{i + 1}</span>{q.question}</h3>
              {q.status === "nicht_im_skript" ? (
                <p className="sheet-missing">Steht nicht im Skript.</p>
              ) : (
                <>
                  {q.summary && <p className="sheet-summary">{refsToSources(q.summary, cites)}</p>}
                  {q.points.length > 0 && (
                    <ul>
                      {q.points.map((p, k) => (
                        <li key={k}>{p.text}{p.refs.length > 0 && <span className="sheet-src"> ({[...new Set(p.refs.map((r) => short(cites.get(r))))].join("; ")})</span>}</li>
                      ))}
                    </ul>
                  )}
                  {q.missing && <p className="sheet-missing">Nicht im Skript: {q.missing}</p>}
                </>
              )}
            </section>
          );
        })}
      </article>
    </section>
  );
}
