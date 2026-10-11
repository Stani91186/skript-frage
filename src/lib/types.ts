export type Doc = {
  id: string;
  title: string;
  kind: string;
  storage_path: string | null;
  page_count: number;
  char_count: number;
  active: boolean;
  created_at: string;
};

export type QSet = { id: string; title: string; created_at: string };

export type Citation = {
  ref: string;
  chunk_id: number;
  document_id: string;
  doc_title: string;
  loc: string;
  page: number | null;
  quote: string | null;
  found: boolean;
  before: string;
  match: string;
  after: string;
  cut_start: boolean;
  cut_end: boolean;
};

export type Status = "offen" | "laeuft" | "beantwortet" | "teilweise" | "nicht_im_skript" | "fehler";

export type Question = {
  id: string;
  set_id: string;
  position: number;
  question: string;
  status: Status;
  summary: string | null;
  points: { text: string; refs: string[] }[];
  missing: string | null;
  citations: Citation[];
  error: string | null;
  model: string | null;
  answered_at: string | null;
  created_at: string;
};
