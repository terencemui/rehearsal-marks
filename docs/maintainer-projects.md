# Maintainer guide: public projects

The app's data is the `projects` table in Supabase (ADR-0006), with Row Level
Security as the authorization boundary. This file covers the two maintainer
surfaces: seeding the gallery with its first content, and the moderation
workflow for public project submissions.

## The seed (development)

`supabase/seed.sql` is the local development fixture. `supabase db reset` and
`supabase start` run it automatically against the local database, so a fresh
checkout has a populated gallery to work against.

It is deliberately self-contained: it creates its own owner — a synthetic
account at an `example.com` address, which RFC 2606 reserves so it can never
belong to a real person — rather than naming an account that must already
exist. That is what lets it run on any machine with no setup, and it keeps a
real address out of a public repo. An identity-dependent seed cannot do either:
`db reset` would abort on every contributor's machine, and the value would have
to be committed somewhere.

The content is the recording the gallery launched with: Tchaikovsky's Symphony
No. 5, hr-Sinfonieorchester – Frankfurt Radio Symphony under Manfred Honeck at
the Alte Oper Frankfurt, 23 March 2018
(`https://www.youtube.com/watch?v=a_B02BZp-5Y`, 50:36). The four movement-start
markers are taken from the video's own chapter list, so each timing is
checkable against the performance itself.

**It never goes to the hosted project.** `supabase db push` does not run the
seed unless `--include-seed` is passed, and there it must not be. Watch the
other command too: **`supabase db reset --linked` applies this file by
default** — `[db.seed] enabled` in `config.toml` makes seeding the default, and
`--no-seed` is the only opt-out. That is the one to be careful with, because
`db reset --linked` is the CLI's own remedy for remote schema drift, so it is
exactly what a maintainer reaches for when the hosted schema looks wrong.

Either command would create the synthetic development account as a real
`auth.users` row, and publish a project owned by it. Every policy keys on
`owner_id = auth.uid()`, and that account can never sign in — so the row would
be uneditable and undeletable from the app, reachable only by hand-written SQL.
The gallery's production content is bootstrapped separately, below.

## Seeding production

Production's first published project belongs to the maintainer's own account —
a different job from the development fixture above, which is why the two are
not one file. It is a one-off, run by hand.

1. **The owner account must exist first.** `owner_id` is not null and
   foreign-keyed to `auth.users`. Sign in with the app once (Google sign-in),
   then read the account's **id** from the dashboard's Auth → Users panel: the
   uuid is what the row needs, not the email address.

2. **Run the insert as the postgres role**, which bypasses RLS — the only way a
   row becomes `published` without the moderation function, since
   `publication_status` is out of a client's reach by design. Copy the project
   `insert` out of `supabase/seed.sql`, leave its `insert into auth.users`
   behind, and point `owner_id` at the uuid from step 1:

   ```sql
   insert into public.projects (
     id, owner_id, name, recording_title, video_id, duration,
     markers, movements, visibility, publication_status
   )
   values (
     '7f8f4a10-2c3e-4b1a-9d5b-6a0e8f9c1d2e',
     '<your-account-uuid>',  -- dashboard → Auth → Users
     ...
   )
   on conflict (id) do nothing;
   ```

   Run it through the CLI rather than the dashboard SQL editor, which mangles
   long pastes — this project's marker JSON is long enough to hit that:

   ```bash
   supabase db query --linked --file /tmp/first-project.sql
   ```

   Keep that file out of git. It names one specific account, so unlike the seed
   it is environment-specific by nature; anyone rebuilding a different
   environment supplies their own uuid.

3. **Spot-check 2–3 markers by ear** before publishing — the same step the
   review checklist asks of every pending project.

4. **Re-running is harmless** — the project carries a fixed id, so a second run
   is a no-op.

## The moderation workflow

Every new public project lands `pending` — visible to its owner (whose projects
screen marks it "Pending review"), invisible to readers — unless the
submission-gate trigger auto-publishes it (see below). Private projects never
enter review at all. Moderating is running the queue and acting on it from the
dashboard's SQL editor.

### Reviewing the queue

```sql
select id, name, recording_title, video_id, created_at, owner_id
from public.projects
where visibility = 'public' and publication_status = 'pending'
order by created_at;
```

The owner reads the submitted project back as itself: open the video in the app
and confirm the marks land on it. The review checklist, for each project:

- **Recording identity** — the `video_id` is the video the owner claims; open
  the canonical URL (`https://www.youtube.com/watch?v=<id>`) and confirm the
  performance matches.
- **Marker sanity** — timings inside the performance's duration, labels in
  order, nothing duplicated (the app enforces these on placement; a quick scan
  catches the rest).
- **Spot-check by ear** — listen to 2–3 marks, the same step seeding production
  asks above.

### Acting on a row

`moderate_project(row_id, action)` is the only sanctioned state change (execute
is revoked from PUBLIC — a client role can never call it). The transitions are
strict and scoped to public rows; an invalid move raises instead of silently
doing nothing:

```sql
-- Accept: the project becomes public, and readers' anonymous lookups return it.
select public.moderate_project('<row id>', 'publish');

-- Deny: the owner's status flips to "Rejected"; editing the project and
-- saving it again returns it to the queue.
select public.moderate_project('<row id>', 'reject');

-- Withdraw: a published project goes back to pending (bad attribution, a
-- copyright claim) and readers stop seeing it immediately.
select public.moderate_project('<row id>', 'unpublish');
```

### Suspending a user

A ban is one row in `banned_users` (the renamed bans table), written only by
the maintainer:

```sql
insert into public.banned_users (id) values ('<the account's uuid>');
```

Bans cascade from `auth.users` (deleting the account removes the ban). A banned
user's published public projects disappear from readers, their public writes —
new projects and edits to public ones — are refused with "suspended from
publishing", and their existing pending public project, if any, remains in the
queue — moderate it explicitly. Their private projects keep saving: a ban gates
public visibility, not the private workspace.

### The trust threshold

One number in `supabase/migrations/20260828120000_server_side_projects.sql`
bounds the queue (commented "Tune them here"): **3 published public projects to
be trusted** — the threshold inside `user_is_trusted`. A trusted user's new
public projects publish immediately, and their edits to published or rejected
projects stay out of the queue too — the escape valve. There is no published-
per-video guard and no submission rate limit anymore: many public projects per
recording are allowed, by design.

Changing the threshold only affects future submissions — nothing retroactive.
