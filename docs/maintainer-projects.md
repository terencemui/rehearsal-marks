# Maintainer guide: public projects

The app's data is the `projects` table in Supabase (ADR-0006), with Row Level
Security as the authorization boundary. This file covers the two maintainer
surfaces: seeding the gallery with its first content, and the moderation
workflow for public project submissions.

## The seed

`supabase/seed.sql` inserts the first published public project: Tchaikovsky's
Symphony No. 5, hr-Sinfonieorchester – Frankfurt Radio Symphony under Manfred
Honeck at the Alte Oper Frankfurt, 23 March 2018
(`https://www.youtube.com/watch?v=a_B02BZp-5Y`, 50:36). The four movement-start
markers are taken from the video's own chapter list, so each timing is
checkable against the performance itself — spot-check 2–3 by ear, the same step
the review checklist asks of every pending project.

## Running the seed

The seed runs as the postgres role (via the dashboard SQL editor), which
bypasses RLS — the only way a row becomes `published` without the moderation
function, since the `publication_status` column is out of a client's reach by
design.

1. **The owner account must exist first.** `owner_id` is not null and
   foreign-keyed to `auth.users`; the seed names the owner explicitly. Sign
   in with the app once (the app's Google sign-in) or create the user in the
   dashboard's Auth → Users panel.
2. **Set the email** at the top of `supabase/seed.sql` to the account that
   will own the row, then run the file in the SQL editor. A missing account
   aborts loudly, not silently.
3. **Re-running is harmless** — the project carries a fixed id, so a second
   run is a no-op.

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
- **Spot-check by ear** — listen to 2–3 marks, the same step the seed asks.

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
