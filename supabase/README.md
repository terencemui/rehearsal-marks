# Supabase

The hosted Postgres database behind the Commons: the `label_sets` table, with
Row Level Security as the authorization boundary (ADR-0001).

- `migrations/` — schema and RLS, one file per change, timestamp-prefixed in
  filename order. Apply with the Supabase CLI (`supabase db push`) against a
  linked project, or run each file in the dashboard's SQL editor.

## Wiring the app

The app talks to Supabase through the auth layer (`src/auth/`) — the only
place supabase-js is referenced. Two env vars configure it (see `.env.example`
at the repo root):

- `VITE_SUPABASE_URL` — the project URL (dashboard → Settings → API).
- `VITE_SUPABASE_ANON_KEY` — the project's anon (public) key. Both values are
  public: the anon key ships with the browser, and RLS is the authorization
  boundary, not the key.

Absent or blank, sign-in reports itself unavailable and everything else keeps
working — contributor sign-in (T24) is wired; the anonymous Commons query
(T21) is still to land.

## Google sign-in setup

One dashboard configuration, per ADR-0001 — no password login, Google only:

1. **Authentication → Providers → Google**: enable and fill in the Google
   Cloud OAuth client (client ID and secret) from a Google Cloud project's
   **APIs & Services → Credentials**.
2. **Authentication → URL Configuration**: add the app's origin to the
   allowed redirect URLs (e.g. `http://localhost:5173` for dev, the deployed
   origin for production) — supabase-js appends the auth callback path.
3. The `auth.users` id that Google signs in becomes the `contributor_id`
   behind every `label_sets` row; the client never sends it (the schema
   defaults it to `auth.uid()`).
