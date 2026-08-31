# Supabase

The hosted Postgres database behind the app: the `projects` table — the app's
single server-side concept (ADR-0006) — with Row Level Security as the
authorization boundary.

- `migrations/` — schema and RLS, one file per change, timestamp-prefixed in
  filename order. Apply with the Supabase CLI (`supabase db push`) against a
  linked project, or run each file in the dashboard's SQL editor.
- `seed.sql` — content, not schema: the first published public project, so the
  gallery is never empty. Runs as the postgres role (dashboard SQL editor),
  never via `authenticated` — see `docs/maintainer-projects.md`.

## Wiring the app

The app is fully server-side (ADR-0006): every screen reads and writes the
`projects` table through the `ProjectsApi` seam, and an unconfigured
deployment — absent the two env vars below — renders the "not wired up"
screen instead of the app. The browser stores and the `label_sets` era
(ADR-0001's Commons) are retired: nothing of the user's data lives in the
browser.

Two env vars configure the Supabase client (see `.env.example` at the repo
root):

- `VITE_SUPABASE_URL` — the project URL (dashboard → Settings → API).
- `VITE_SUPABASE_ANON_KEY` — the project's anon (public) key. Both values are
  public: the anon key ships with the browser, and RLS is the authorization
  boundary, not the key.

The consumers of that wiring:

- **Anonymous reads** — the public gallery queries `projects` directly over
  PostgREST with the anon key, no account needed. RLS limits the result to
  published public projects.
- **Signed-in writes** — Google OAuth through supabase-js's auth client; the
  signed-in user is the `owner_id` behind every `projects` row.
- **Account deletion** — a signed-in user deletes their account through the
  `delete_my_account` RPC (migration
  `20260820210000_delete_my_account.sql`): a security-definer function that
  removes the caller's own `auth.users` row, with the `projects` FK cascade
  taking their projects with it. supabase-js's `deleteUser` is admin-only,
  so the RPC is the self-service path.

## Google sign-in setup

One dashboard configuration, per ADR-0006 — no password login, Google only:

1. **Authentication → Providers → Google**: enable and fill in the Google
   Cloud OAuth client (client ID and secret) from a Google Cloud project's
   **APIs & Services → Credentials**.
2. **Authentication → URL Configuration**: add the app's origin to the
   allowed redirect URLs (e.g. `http://localhost:5173` for dev, the deployed
   origin for production) — supabase-js appends the auth callback path.
3. The `auth.users` id that Google signs in becomes the `owner_id` behind
   every `projects` row; the client never sends it (the schema defaults it to
   `auth.uid()`).
