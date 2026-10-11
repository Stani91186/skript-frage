-- Skript-Frage (Lern-App): Tabellen mit Präfix lern_, da das Supabase-Projekt mit anderen Anwendungen geteilt wird.
-- Jede Zeile gehört genau einem Nutzer; Row Level Security trennt die Daten.

create extension if not exists pgcrypto;

-- Skripte -------------------------------------------------------------------
create table public.lern_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null,
  kind         text not null default 'Text',          -- PDF | Word | Text
  storage_path text,                                   -- Originaldatei im Bucket "lern-skripte"
  page_count   int  not null default 0,
  char_count   int  not null default 0,
  active       boolean not null default true,          -- bei Fragen einbeziehen
  created_at   timestamptz not null default now()
);
create index lern_documents_user_idx on public.lern_documents(user_id, created_at);

-- Textabschnitte mit deutscher Volltextsuche -------------------------------
create table public.lern_chunks (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.lern_documents(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idx         int  not null,                           -- Reihenfolge im Skript
  page        int,                                     -- Seitenzahl (PDF) oder null
  loc         text not null default '',                -- "Seite 12" / "Abschnitt 3"
  content     text not null,
  fts         tsvector generated always as (to_tsvector('german', content)) stored
);
create index lern_chunks_doc_idx on public.lern_chunks(document_id, idx);
create index lern_chunks_user_idx on public.lern_chunks(user_id);
create index lern_chunks_fts_idx on public.lern_chunks using gin(fts);

-- Fragenkataloge ------------------------------------------------------------
create table public.lern_question_sets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null,
  created_at timestamptz not null default now()
);
create index lern_question_sets_user_idx on public.lern_question_sets(user_id, created_at);

create table public.lern_questions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  set_id      uuid not null references public.lern_question_sets(id) on delete cascade,
  position    int  not null default 0,
  question    text not null,
  status      text not null default 'offen'
              check (status in ('offen','laeuft','beantwortet','teilweise','nicht_im_skript','fehler')),
  summary     text,                                   -- Kurzantwort (1–3 Sätze)
  points      jsonb not null default '[]'::jsonb,     -- [{text, refs:["S1"]}]
  missing     text,                                   -- was im Skript fehlt
  citations   jsonb not null default '[]'::jsonb,     -- geprüfte Belege
  error       text,
  model       text,
  answered_at timestamptz,
  created_at  timestamptz not null default now()
);
create index lern_questions_set_idx on public.lern_questions(set_id, position);
create index lern_questions_user_idx on public.lern_questions(user_id);

-- Zugang: Das Projekt teilt sich die Anmeldung mit anderen Apps. Nur freigeschaltete Konten dürfen die Lern-App nutzen.
create table public.lern_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.lern_members enable row level security;
create policy "lern members see self" on public.lern_members
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.lern_is_member()
returns boolean language sql stable security definer set search_path = public, pg_catalog
as $$ select exists (select 1 from public.lern_members where user_id = auth.uid()) $$;
revoke all on function public.lern_is_member() from public, anon;
grant execute on function public.lern_is_member() to authenticated;

-- Row Level Security ---------------------------------------------------------
alter table public.lern_documents     enable row level security;
alter table public.lern_chunks        enable row level security;
alter table public.lern_question_sets enable row level security;
alter table public.lern_questions     enable row level security;

create policy "lern own documents" on public.lern_documents
  for all to authenticated using (user_id = (select auth.uid()) and (select public.lern_is_member()))
  with check (user_id = (select auth.uid()) and (select public.lern_is_member()));
create policy "lern own chunks" on public.lern_chunks
  for all to authenticated using (user_id = (select auth.uid()) and (select public.lern_is_member()))
  with check (user_id = (select auth.uid()) and (select public.lern_is_member()));
create policy "lern own sets" on public.lern_question_sets
  for all to authenticated using (user_id = (select auth.uid()) and (select public.lern_is_member()))
  with check (user_id = (select auth.uid()) and (select public.lern_is_member()));
create policy "lern own questions" on public.lern_questions
  for all to authenticated using (user_id = (select auth.uid()) and (select public.lern_is_member()))
  with check (user_id = (select auth.uid()) and (select public.lern_is_member()));

-- Suche: beste Abschnitte zu einer Frage (ODER-Verknüpfung, Präfixe für Komposita)
create or replace function public.lern_search_chunks(query text, doc_ids uuid[], lim int default 40)
returns table (id bigint, document_id uuid, idx int, page int, loc text, content text, rank real)
language sql stable security invoker set search_path = public, pg_catalog
as $$
  with terms as (
    select distinct lexeme from unnest(to_tsvector('german', query))
    where length(lexeme) > 2
  ), q as (
    select string_agg(quote_literal(lexeme) || ':*', ' | ')::tsquery as tsq from terms
  )
  select c.id, c.document_id, c.idx, c.page, c.loc, c.content, ts_rank_cd(c.fts, q.tsq) as rank
  from public.lern_chunks c, q
  where q.tsq is not null
    and c.document_id = any(doc_ids)
    and c.fts @@ q.tsq
  order by rank desc
  limit lim;
$$;

-- Speicher für Originaldateien ----------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('lern-skripte', 'lern-skripte', false, 52428800)
on conflict (id) do nothing;

create policy "lern own files read" on storage.objects for select to authenticated
  using (bucket_id = 'lern-skripte' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.lern_is_member()));
create policy "lern own files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'lern-skripte' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.lern_is_member()));
create policy "lern own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'lern-skripte' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.lern_is_member()));

revoke all on function public.lern_search_chunks(text, uuid[], int) from public, anon;
grant execute on function public.lern_search_chunks(text, uuid[], int) to authenticated;
