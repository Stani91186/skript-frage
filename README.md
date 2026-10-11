# Skript-Frage

Lern-App für die Klausurvorbereitung: Skripte (PDF, Word, Text) hochladen, Fragen oder ganze Fragenkataloge stellen und zusammengefasste Klausurantworten bekommen, die **ausschließlich aus den eigenen Skripten** stammen. Jede Aussage ist mit einer Quelle (Skript, Seite) belegt; die Originalstelle wird markiert angezeigt und automatisch geprüft, ob das Zitat wörtlich im Skript steht.

## Aufbau

- **Frontend:** Vite + React + TypeScript, gehostet auf GitHub Pages (`.github/workflows/deploy.yml`).
- **Backend:** Supabase
  - Tabellen `lern_documents`, `lern_chunks` (deutsche Volltextsuche), `lern_question_sets`, `lern_questions`, `lern_members` (Freischaltung)
  - Speicher-Bucket `lern-skripte` für die Originaldateien
  - Edge Function `lern-answer`: holt die Skriptabschnitte, fragt Claude (Anthropic API) mit strengen Regeln „nur aus dem Skript“, prüft die Zitate gegen den Originaltext und speichert die Antwort.
- Schema: `supabase/migrations/20261011000000_init.sql`

## Einstellungen

- Edge-Function-Secret `ANTHROPIC_API_KEY` (Pflicht), optional `ANTHROPIC_MODEL` (Standard `claude-sonnet-5-5`).
- Weitere Nutzer freischalten:
  ```sql
  insert into public.lern_members(user_id) select id from auth.users where email = 'name@example.de';
  ```

## Lokal starten

```bash
npm install
npm run dev
```
