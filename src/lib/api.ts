import { supabase } from "./supabase";
import { chunkPages, kindOf, readDocx, readPdf, readText } from "./extract";
import type { Doc, QSet, Question } from "./types";

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

// ---------- Skripte ----------
export async function listDocs(): Promise<Doc[]> {
  return must(await supabase.from("lern_documents").select("*").order("created_at"));
}

export async function setDocActive(id: string, active: boolean) {
  must(await supabase.from("lern_documents").update({ active }).eq("id", id));
}

export async function deleteDoc(doc: Doc) {
  if (doc.storage_path) await supabase.storage.from("lern-skripte").remove([doc.storage_path]);
  must(await supabase.from("lern_documents").delete().eq("id", doc.id));
}

export async function openOriginal(doc: Pick<Doc, "storage_path">, page?: number | null) {
  if (!doc.storage_path) throw new Error("Für dieses Skript ist keine Originaldatei gespeichert.");
  const { data, error } = await supabase.storage.from("lern-skripte").createSignedUrl(doc.storage_path, 3600);
  if (error || !data) throw new Error("Die Originaldatei konnte nicht geöffnet werden.");
  window.open(data.signedUrl + (page ? "#page=" + page : ""), "_blank", "noopener");
}

export async function uploadDoc(file: File, onStatus: (s: string) => void): Promise<Doc> {
  const kind = kindOf(file);
  if (!kind) throw new Error(`${file.name}: Dieses Format wird nicht unterstützt. Bitte PDF, Word (.docx) oder Text verwenden.`);
  onStatus(`${file.name}: wird gelesen …`);
  const pages =
    kind === "PDF" ? await readPdf(file, (i, n) => onStatus(`${file.name}: Seite ${i} von ${n}`))
    : kind === "Word" ? await readDocx(file)
    : await readText(file);
  const chunks = chunkPages(pages);
  if (!chunks.length)
    throw new Error(`${file.name}: Kein Text gefunden. Gescannte PDFs ohne Textebene bitte vorher mit einer Texterkennung (OCR) umwandeln.`);

  const { data: u } = await supabase.auth.getUser();
  const uid = u.user!.id;
  const charCount = chunks.reduce((n, c) => n + c.content.length, 0);
  const doc: Doc = must(
    await supabase.from("lern_documents").insert({
      title: file.name.replace(/\.[^.]+$/, ""),
      kind,
      page_count: kind === "PDF" ? pages.length : 0,
      char_count: charCount,
    }).select().single(),
  );

  try {
    onStatus(`${file.name}: Text wird gespeichert …`);
    for (let i = 0; i < chunks.length; i += 300) {
      must(await supabase.from("lern_chunks").insert(chunks.slice(i, i + 300).map((c) => ({ ...c, document_id: doc.id }))));
    }
    onStatus(`${file.name}: Originaldatei wird hochgeladen …`);
    const safe = file.name.normalize("NFKD").replace(/[^\w.-]+/g, "_");
    const path = `${uid}/${doc.id}/${safe}`;
    const up = await supabase.storage.from("lern-skripte").upload(path, file, { contentType: file.type || undefined });
    if (!up.error) {
      must(await supabase.from("lern_documents").update({ storage_path: path }).eq("id", doc.id));
      doc.storage_path = path;
    }
    return doc;
  } catch (e) {
    await supabase.from("lern_documents").delete().eq("id", doc.id);
    throw e;
  }
}

// ---------- Fragenkataloge ----------
export async function listSets(): Promise<QSet[]> {
  return must(await supabase.from("lern_question_sets").select("*").order("created_at"));
}
export async function createSet(title: string): Promise<QSet> {
  return must(await supabase.from("lern_question_sets").insert({ title }).select().single());
}
export async function renameSet(id: string, title: string) {
  must(await supabase.from("lern_question_sets").update({ title }).eq("id", id));
}
export async function deleteSet(id: string) {
  must(await supabase.from("lern_question_sets").delete().eq("id", id));
}

export async function listQuestions(setId: string): Promise<Question[]> {
  return must(await supabase.from("lern_questions").select("*").eq("set_id", setId).order("position").order("created_at"));
}
export async function addQuestions(setId: string, texts: string[], startPos: number): Promise<Question[]> {
  return must(
    await supabase.from("lern_questions")
      .insert(texts.map((question, i) => ({ set_id: setId, question, position: startPos + i })))
      .select(),
  );
}
export async function updateQuestionText(id: string, question: string): Promise<Question> {
  return must(
    await supabase.from("lern_questions")
      .update({ question, status: "offen", summary: null, points: [], missing: null, citations: [], error: null })
      .eq("id", id).select().single(),
  );
}
export async function deleteQuestion(id: string) {
  must(await supabase.from("lern_questions").delete().eq("id", id));
}

/** Lässt die Frage auf dem Server beantworten und gibt die gespeicherte Zeile zurück. */
export async function answerQuestion(id: string): Promise<Question> {
  const { data, error } = await supabase.functions.invoke("lern-answer", { body: { question_id: id } });
  if (error) {
    let msg = "Die Verbindung zum Server ist fehlgeschlagen. Bitte erneut versuchen.";
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) msg = body.error;
      if (body?.id) return body as Question;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as Question;
}
