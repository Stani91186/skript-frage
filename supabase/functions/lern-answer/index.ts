// Edge Function "lern-answer": beantwortet eine gespeicherte Frage ausschließlich aus den Skripten des Nutzers.
// Aufruf: POST { question_id } mit dem Login-Token des Nutzers. Row Level Security gilt durchgehend.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const FULL_BUDGET = 150_000; // bis zu dieser Zeichenzahl gehen alle aktiven Skripte komplett an Claude
const SEARCH_BUDGET = 70_000; // darüber: nur die passendsten Abschnitte

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Chunk = { id: number; document_id: string; idx: number; page: number | null; loc: string; content: string };
type Doc = { id: string; title: string; char_count: number; created_at: string };

const SYSTEM = `Du bist ein strenger Klausur-Tutor. Du beantwortest Prüfungsfragen AUSSCHLIESSLICH mit dem Inhalt der Skript-Auszüge, die der Nutzer dir gibt.

Regeln:
1. Verwende nur Informationen aus den Auszügen. Kein Allgemeinwissen, nichts aus dem Internet, keine eigenen Beispiele, Zahlen oder Ergänzungen. Auch wenn du die Antwort kennst: Was nicht in den Auszügen steht, gehört nicht in die Antwort.
2. Schreibe eine zusammengefasste, prüfungsreife Antwort:
   - "kurzantwort": 1 bis 3 Sätze, die die Frage direkt beantworten, so wie man es in einer Klausur hinschreiben würde.
   - "punkte": 2 bis 8 knappe Stichpunkte mit den wichtigsten Fakten, Definitionen, Formeln, Einheiten und Zahlen aus dem Skript. Fachbegriffe und Formeln genau so übernehmen, wie sie im Skript stehen.
3. Belege jede Aussage: In "kurzantwort" setzt du direkt hinter die Aussage die Kennung, z. B. [S3] oder [S3, S7]. Jeder Stichpunkt bekommt in "quellen" die Kennungen der Auszüge, aus denen er stammt.
4. "belege": Für jede verwendete Kennung mindestens ein Zitat, das die Aussage stützt. Das Zitat muss Zeichen für Zeichen aus dem Auszug kopiert sein (ein bis zwei Sätze, höchstens 300 Zeichen, keine Auslassungen, nichts umformulieren).
5. Deckt das Skript die Frage nur teilweise ab: status "teilweise", beantworte nur den abgedeckten Teil und nenne in "fehlt" konkret, was das Skript nicht enthält.
6. Enthält das Skript nichts dazu: status "nicht_im_skript", kurzantwort "Das Skript enthält dazu keine Angaben.", punkte und belege leer, und in "fehlt" kurz, wonach gefragt wurde.
7. Antworte in der Sprache der Frage. Gib das Ergebnis ausschließlich über das Werkzeug "klausurantwort" zurück.`;

const TOOL = {
  name: "klausurantwort",
  description: "Gibt die belegte Klausurantwort strukturiert zurück.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["beantwortet", "teilweise", "nicht_im_skript"] },
      kurzantwort: { type: "string", description: "1–3 Sätze mit [S#]-Belegen" },
      punkte: {
        type: "array",
        items: {
          type: "object",
          properties: { text: { type: "string" }, quellen: { type: "array", items: { type: "string" } } },
          required: ["text", "quellen"],
        },
      },
      fehlt: { type: "string", description: "Was das Skript nicht abdeckt, sonst leer" },
      belege: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, zitat: { type: "string" } },
          required: ["id", "zitat"],
        },
      },
    },
    required: ["status", "kurzantwort", "punkte", "fehlt", "belege"],
  },
};

// ---------- Zitatprüfung ----------
function normChar(ch: string) {
  return ch.toLowerCase().replace(/[„“”"«»‚‘’'`´]/, '"').replace(/[–—‑]/, "-");
}
function flatten(src: string) {
  const map: number[] = [];
  let f = "";
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (ch === "\u00ad") continue;
    ch = normChar(ch);
    if (/\s/.test(ch)) {
      if (!f.length || f.endsWith(" ")) continue;
      ch = " ";
    }
    for (const c of ch) { f += c; map.push(i); }
  }
  return { f, map };
}
function findQuote(text: string, quote: string): [number, number] | null {
  if (!quote) return null;
  const { f, map } = flatten(text);
  const tryFind = (q: string) => {
    const qq = flatten(q).f.trim();
    if (qq.length < 12) return null;
    const at = f.indexOf(qq);
    if (at === -1) return null;
    return [map[at], map[at + qq.length - 1] + 1] as [number, number];
  };
  const whole = tryFind(quote.replace(/^[.…\s]+|[.…\s]+$/g, ""));
  if (whole) return whole;
  // Teilstücke (bei "…" oder leicht abweichendem Ende): längstes passendes Stück nehmen
  const parts = quote.split(/\.\.\.|…|(?<=[.!?;:])\s+/).map((s) => s.trim()).filter((s) => s.length >= 25)
    .sort((a, b) => b.length - a.length);
  for (const p of parts) { const r = tryFind(p); if (r) return r; }
  return null;
}

async function callClaude(context: string, question: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "klausurantwort" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `SKRIPT-AUSZÜGE:\n\n${context}`, cache_control: { type: "ephemeral" } },
          { type: "text", text: `FRAGE: ${question}` },
        ],
      }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg: string = body?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new Error("Der Claude-API-Schlüssel ist ungültig. Bitte in Supabase neu eintragen.");
    if (/credit balance/i.test(msg)) throw new Error("Das Guthaben auf console.anthropic.com ist aufgebraucht.");
    if (res.status === 429 || res.status === 529 || res.status >= 500) throw new Error("Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.");
    throw new Error("Claude-Fehler: " + msg);
  }
  const tool = (body.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!tool) throw new Error("Claude hat keine strukturierte Antwort geliefert. Bitte erneut versuchen.");
  return tool.input as {
    status: string; kurzantwort: string; punkte: { text: string; quellen: string[] }[];
    fehlt: string; belege: { id: string; zitat: string }[];
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });

  let questionId = "";
  try { questionId = (await req.json()).question_id; } catch { /* leer */ }
  if (!questionId) return json({ error: "question_id fehlt" }, 400);

  const { data: q, error: qErr } = await sb.from("lern_questions").select("*").eq("id", questionId).single();
  if (qErr || !q) return json({ error: "Frage nicht gefunden" }, 404);

  const fail = async (message: string, status = 200) => {
    const { data } = await sb.from("lern_questions").update({ status: "fehler", error: message }).eq("id", q.id).select().single();
    return json(data ?? { error: message }, status);
  };

  if (!API_KEY) return fail("Es ist noch kein Claude-API-Schlüssel hinterlegt (Supabase → Edge Functions → Secrets → ANTHROPIC_API_KEY).");

  await sb.from("lern_questions").update({ status: "laeuft", error: null }).eq("id", q.id);

  try {
    const { data: docs } = await sb.from("lern_documents").select("id,title,char_count,created_at")
      .eq("active", true).order("created_at");
    if (!docs?.length) return fail("Es ist kein Skript ausgewählt. Lade ein Skript hoch oder aktiviere eines.");
    const docOrder = new Map((docs as Doc[]).map((d, i) => [d.id, i]));
    const docTitle = new Map((docs as Doc[]).map((d) => [d.id, d.title]));
    const total = (docs as Doc[]).reduce((n, d) => n + (d.char_count || 0), 0);
    const ids = (docs as Doc[]).map((d) => d.id);

    let chunks: Chunk[] = [];
    let partial = false;
    if (total <= FULL_BUDGET) {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("lern_chunks").select("id,document_id,idx,page,loc,content")
          .in("document_id", ids).order("id").range(from, from + 999);
        if (error) throw error;
        chunks.push(...(data as Chunk[]));
        if (!data || data.length < 1000) break;
      }
    } else {
      partial = true;
      const { data, error } = await sb.rpc("lern_search_chunks", { query: q.question, doc_ids: ids, lim: 120 });
      if (error) throw error;
      let used = 0;
      for (const c of (data ?? []) as Chunk[]) {
        if (used + c.content.length > SEARCH_BUDGET) continue;
        chunks.push(c); used += c.content.length;
      }
    }
    chunks.sort((a, b) => (docOrder.get(a.document_id)! - docOrder.get(b.document_id)!) || a.idx - b.idx);
    if (!chunks.length) {
      const { data } = await sb.from("lern_questions").update({
        status: "nicht_im_skript", summary: "Das Skript enthält dazu keine Angaben.", points: [],
        missing: "Zu den Begriffen der Frage wurde in den ausgewählten Skripten keine Stelle gefunden.",
        citations: [], error: null, model: MODEL, answered_at: new Date().toISOString(),
      }).eq("id", q.id).select().single();
      return json(data);
    }

    const context = chunks.map((c, k) =>
      `[S${k + 1}] (Quelle: ${docTitle.get(c.document_id)}${c.loc ? ", " + c.loc : ""})\n${c.content}`
    ).join("\n\n") + (partial ? "\n\n(Hinweis: Das sind die passendsten Auszüge aus längeren Skripten, nicht der vollständige Text.)" : "");

    const out = await callClaude(context, q.question);

    // Belege gegen den Originaltext prüfen
    const byRef = (ref: string) => { const n = parseInt(String(ref).replace(/\D/g, ""), 10); return chunks[n - 1] ? { n, c: chunks[n - 1] } : null; };
    const citations: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const b of out.belege ?? []) {
      const hit = byRef(b.id); if (!hit) continue;
      const ref = "S" + hit.n;
      const r = findQuote(hit.c.content, b.zitat);
      const text = hit.c.content;
      citations.push({
        ref, chunk_id: hit.c.id, document_id: hit.c.document_id, doc_title: docTitle.get(hit.c.document_id),
        loc: hit.c.loc, page: hit.c.page, quote: b.zitat, found: !!r,
        before: r ? text.slice(Math.max(0, r[0] - 280), r[0]) : "",
        match: r ? text.slice(r[0], r[1]) : "",
        after: r ? text.slice(r[1], Math.min(text.length, r[1] + 280)) : text.slice(0, 600),
        cut_start: r ? r[0] > 280 : false, cut_end: r ? r[1] + 280 < text.length : text.length > 600,
      });
      seen.add(ref);
    }
    const allRefs = new Set<string>();
    (out.kurzantwort.match(/S\d+/g) ?? []).forEach((r) => allRefs.add(r));
    for (const p of out.punkte ?? []) for (const r of p.quellen ?? []) allRefs.add("S" + String(r).replace(/\D/g, ""));
    for (const ref of allRefs) {
      if (seen.has(ref)) continue;
      const hit = byRef(ref); if (!hit) continue;
      const text = hit.c.content;
      citations.push({
        ref, chunk_id: hit.c.id, document_id: hit.c.document_id, doc_title: docTitle.get(hit.c.document_id),
        loc: hit.c.loc, page: hit.c.page, quote: null, found: false,
        before: "", match: "", after: text.slice(0, 600), cut_start: false, cut_end: text.length > 600,
      });
    }
    citations.sort((a, b) => parseInt(String(a.ref).slice(1)) - parseInt(String(b.ref).slice(1)));

    let status = ["beantwortet", "teilweise", "nicht_im_skript"].includes(out.status) ? out.status : "teilweise";
    if (status !== "nicht_im_skript" && !citations.length) status = "teilweise";

    const { data, error } = await sb.from("lern_questions").update({
      status,
      summary: out.kurzantwort,
      points: (out.punkte ?? []).map((p) => ({ text: p.text, refs: (p.quellen ?? []).map((r) => "S" + String(r).replace(/\D/g, "")) })),
      missing: (out.fehlt ?? "").trim() || null,
      citations, error: null, model: MODEL, answered_at: new Date().toISOString(),
    }).eq("id", q.id).select().single();
    if (error) throw error;
    return json(data);
  } catch (e) {
    console.error(e);
    return fail(e instanceof Error ? e.message : "Unbekannter Fehler beim Beantworten.");
  }
});
