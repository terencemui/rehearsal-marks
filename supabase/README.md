# Supabase

The hosted Postgres database behind the Commons: the `label_sets` table, with
Row Level Security as the authorization boundary (ADR-0001).

- `migrations/` — schema and RLS, one file per change, timestamp-prefixed in
  filename order. Apply with the Supabase CLI (`supabase db push`) against a
  linked project, or run each file in the dashboard's SQL editor.

The app itself is not wired to a project yet — that lands with the Commons
query (T21) and contributor sign-in (T24).
