# Supabase

The hosted Postgres database behind the app: the `projects` table — the app's
single server-side concept (ADR-0006) — with Row Level Security as the
authorization boundary.

- `migrations/` — schema and RLS, timestamp-prefixed in filename order and
  applied in that order. It is currently a single squashed baseline
  (`20260917000000_init.sql`) that builds the whole schema from nothing; the
  incremental chain it replaced — including the retirement of the Commons and
  its label sets — lives in git history, not here. New changes go in as
  further timestamp-prefixed files. Apply with the Supabase CLI
  (`supabase db push`) against a linked project, or run a file in the
  dashboard's SQL editor.
- `seed.sql` — content, not schema: the local development fixture, run
  automatically by `supabase db reset` and `supabase start`. It creates its own
  synthetic owner, so a fresh checkout needs no setup and no real address is
  committed. It must never reach the hosted project: `db push` needs
  `--include-seed` to apply it, but **`db reset --linked` seeds by default** —
  pass `--no-seed`. Production's first published project is bootstrapped
  separately — see `docs/maintainer-projects.md`.

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
  `delete_my_account` RPC (in `migrations/20260917000000_init.sql`): a
  security-definer function that
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
