# Supabase

The hosted Postgres database behind the Commons: the `label_sets` table, with
Row Level Security as the authorization boundary (ADR-0001).

- `migrations/` — schema and RLS, one file per change, timestamp-prefixed in
  filename order. Apply with the Supabase CLI (`supabase db push`) against a
  linked project, or run each file in the dashboard's SQL editor.

## The app's read path (T21)

Anonymous reads — the lookup a YouTube project's creation runs — query the
Commons directly over PostgREST with the project's anon key, no account needed.
Wire the app to a project with Vite env vars:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from the project dashboard>
```

Without them the app builds and runs unconfigured: every lookup reads as "no
labels" and a link create lands in the unmatched path. Contributor sign-in
(T24) is the remaining unwired piece.
