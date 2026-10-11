// Text aus PDF, Word und Textdateien lesen und in Abschnitte zerlegen.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type Page = { page: number | null; loc: string; text: string };
export type ChunkIn = { idx: number; page: number | null; loc: string; content: string };

export function kindOf(file: File): "PDF" | "Word" | "Text" | null {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || file.type === "application/pdf") return "PDF";
  if (ext === "docx") return "Word";
  if (["txt", "md", "text", "csv"].includes(ext) || file.type.startsWith("text/")) return "Text";
  return null;
}

export async function readPdf(file: File, onPage?: (i: number, n: number) => void): Promise<Page[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: Page[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let s = "";
    let lastY: number | null = null;
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const y = it.transform ? it.transform[5] : null;
      if (lastY !== null && y !== null) {
        const dy = Math.abs(y - lastY);
        if (dy > 14) s += "\n\n";
        else if (dy > 2 && !s.endsWith("\n")) s += "\n";
      }
      s += it.str + (it.hasEOL ? "\n" : "");
      if (y !== null) lastY = y;
    }
    pages.push({ page: i, loc: "Seite " + i, text: s });
    onPage?.(i, doc.numPages);
  }
  return pages;
}

export async function readDocx(file: File): Promise<Page[]> {
  // @ts-expect-error: Browser-Build von mammoth bringt keine Typen mit
  const mammoth = (await import("mammoth/mammoth.browser.js")).default;
  const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return sections(r.value as string);
}

export async function readText(file: File): Promise<Page[]> {
  return sections(await file.text());
}

export async function readPlain(file: File): Promise<string> {
  const k = kindOf(file);
  if (k === "PDF") return (await readPdf(file)).map((p) => p.text).join("\n\n");
  if (k === "Word") return (await readDocx(file)).map((p) => p.text).join("\n\n");
  return file.text();
}

/** Text ohne Seiten in benannte Abschnitte (~6000 Zeichen) teilen. */
export function sections(text: string): Page[] {
  const paras = text.replace(/\r/g, "").split(/\n\s*\n/);
  const pages: Page[] = [];
  let cur = "";
  let n = 1;
  for (const p of paras) {
    if (cur.length + p.length > 6000 && cur) {
      pages.push({ page: null, loc: "Abschnitt " + n++, text: cur });
      cur = "";
    }
    cur += p + "\n\n";
  }
  if (cur.trim()) pages.push({ page: null, loc: pages.length ? "Abschnitt " + n : "", text: cur });
  return pages;
}

function splitLong(p: string, max: number): string[] {
  if (p.length <= max) return [p];
  const sents = p.match(/[^.!?]+[.!?]+["»“)]?\s*|[^.!?]+$/g) || [p];
  const out: string[] = [];
  let cur = "";
  for (const s of sents) {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ""; }
    if (s.length > max) for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Seiten in Abschnitte von ca. 1000 Zeichen zerlegen, Seitenzuordnung bleibt erhalten. */
export function chunkPages(pages: Page[]): ChunkIn[] {
  const chunks: ChunkIn[] = [];
  for (const pg of pages) {
    const text = pg.text
      .replace(/­/g, "")
      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (!text) continue;
    const paras = text
      .split(/\n\s*\n/)
      .map((s) => s.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean)
      .flatMap((p) => splitLong(p, 1100));
    let cur = "";
    for (const p of paras) {
      if (cur && cur.length + p.length > 1000) {
        chunks.push({ idx: chunks.length, page: pg.page, loc: pg.loc, content: cur });
        cur = "";
      }
      cur = cur ? cur + "\n" + p : p;
    }
    if (cur) chunks.push({ idx: chunks.length, page: pg.page, loc: pg.loc, content: cur });
  }
  return chunks;
}

/** Fragen aus einem Text erkennen: eine Frage pro Zeile oder nummeriert, Umbrüche werden zusammengeführt. */
export function parseQuestions(raw: string): string[] {
  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const marker = /^(\(?\d{1,3}[.)]|\(?[a-z][.)]|[-–•*▪●○]|Frage\s*\d+\s*[:.)]?)\s+/i;
  const items: string[] = [];
  let cur = "";
  const hasMarkers = lines.filter((l) => marker.test(l)).length >= 2;
  for (const l of lines) {
    if (!l) { if (cur) { items.push(cur); cur = ""; } continue; }
    if (hasMarkers) {
      if (marker.test(l)) { if (cur) items.push(cur); cur = l.replace(marker, ""); }
      else cur = cur ? cur + " " + l : l;
    } else {
      // ohne Nummerierung: jede Zeile ist eine Frage, außer sie setzt eine unvollständige fort
      if (cur && !/[?.!:]$/.test(cur) && /^\p{Ll}/u.test(l)) cur += " " + l;
      else { if (cur) items.push(cur); cur = l; }
    }
  }
  if (cur) items.push(cur);
  return items.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length >= 6);
}
