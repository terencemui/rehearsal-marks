# Supabase

The hosted Postgres database behind the Commons: the `label_sets` table, with
Row Level Security as the authorization boundary (ADR-0001).

- `migrations/` — schema and RLS, one file per change, timestamp-prefixed in
  filename order. Apply with the Supabase CLI (`supabase db push`) against a
  linked project, or run each file in the dashboard's SQL editor.
- `seed.sql` — content, not schema: the first published label set, so the
  Commons is never empty. Runs as the postgres role (dashboard SQL editor),
  never via `authenticated` — see `docs/maintainer-commons.md`.

## Wiring the app

The app talks to Supabase through the auth layer (`src/auth/`) — the only
place supabase-js is referenced. Two env vars configure it (see `.env.example`
at the repo root):

- `VITE_SUPABASE_URL` — the project URL (dashboard → Settings → API).
- `VITE_SUPABASE_ANON_KEY` — the project's anon (public) key. Both values are
  public: the anon key ships with the browser, and RLS is the authorization
  boundary, not the key.

Absent or blank, the app builds and runs unconfigured: every anonymous Commons
read returns "no labels" (a link create lands in the unmatched path) and
contributor sign-in reports itself unavailable — browsing, local projects, and
YouTube playback keep working as usual.

The two consumers of that wiring:

- **Anonymous reads (T21)** — the lookup a YouTube project's creation runs
  queries the Commons directly over PostgREST with the anon key, no account
  needed.
- **Contributor sign-in (T24)** — Google OAuth through supabase-js's auth
  client; the signed-in contributor is the `contributor_id` behind every
  `label_sets` row.

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
