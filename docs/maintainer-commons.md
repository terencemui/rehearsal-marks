# Maintainer guide: the Commons

The Commons is the hosted collection of community label sets (ADR-0001) — the
`label_sets` table in Supabase, with Row Level Security as the authorization
boundary. This file covers the two maintainer surfaces: seeding the Commons
with its first content, and the moderation workflow for contributor
submissions (T25).

## The seed

`supabase/seed.sql` inserts the first published label set: Tchaikovsky's
Symphony No. 5, Gustav Mahler Jugendorchester under Franz Welser-Möst at the
Wiener Musikverein, 19 September 2009
(`https://www.youtube.com/watch?v=FQzc9c4LOHM`, 46:30). The four markers are
the movement starts, taken from the video's own chapter list, so each timing
is checkable against the performance itself — spot-check 2–3 by ear, the same
step the review checklist asks of every pending row.

## Running the seed

The seed runs as the postgres role (via the dashboard SQL editor), which
bypasses RLS — the only way a row becomes `published` without the moderation
function, since the `publication_status` column is out of a contributor's
reach by design.

1. **The owner account must exist first.** `contributor_id` is not null and
   foreign-keyed to `auth.users`; the seed names the owner explicitly. Sign
   in with the app once (the app's Google sign-in) or create the user in the
   dashboard's Auth → Users panel.
2. **Set the email** at the top of `supabase/seed.sql` to the account that
   will own the row, then run the file in the SQL editor. A missing account
   aborts loudly, not silently.
3. **Re-running is harmless** — the published-unique index (one published
   label set per video) makes it a no-op.

## The moderation workflow

Every contributor submission lands `pending` — visible to the contributor
(the row badge reads "Pending review"), invisible to readers — unless the
submission-gate trigger auto-publishes it (see below). Moderating is running
the queue and acting on it from the dashboard's SQL editor.

### Reviewing the queue

```sql
select id, title, video_id, created_at, contributor_id
from public.label_sets
where publication_status = 'pending'
order by created_at;
```

The contributor reads the submitted set back as a project: open the video in
the app and confirm the marks land on it. The review checklist, for each row:

- **Recording identity** — the `video_id` is the video the contributor
  claims; open the canonical URL (`https://www.youtube.com/watch?v=<id>`) and
  confirm the performance matches.
- **Marker sanity** — timings inside the performance's duration, labels in
  order, nothing duplicated (the app enforces these on placement; a quick
  scan catches the rest).
- **Spot-check by ear** — listen to 2–3 marks, the same step the seed asks.

### Acting on a row

`moderate_label_set(row_id, action)` is the only sanctioned state change
(execute is revoked from PUBLIC — a client role can never call it). The
transitions are strict; an invalid move raises instead of silently doing
nothing:

```sql
-- Accept: the row becomes public, and readers' anonymous lookups return it.
select public.moderate_label_set('<row id>', 'publish');

-- Deny: the contributor's badge flips to "Rejected"; editing the set and
-- submitting it again returns the row to the queue.
select public.moderate_label_set('<row id>', 'reject');

-- Withdraw: a published row goes back to pending (bad attribution, a
-- copyright claim) and readers stop seeing it immediately.
select public.moderate_label_set('<row id>', 'unpublish');
```

Publishing a second row for a video that already has one published fails
loudly (the published-per-video unique index) — the established row wins.

### Suspending a contributor

A ban is one row in `contributors`, written only by the maintainer:

```sql
insert into public.contributors (id) values ('<the account's uuid>');
```

Bans cascade from `auth.users` (deleting the account removes the ban). A
banned contributor's published rows disappear from readers, their pending and
published rows stay visible to themselves, and their writes — new submissions
and edits alike — are refused with "suspended from contributing". Their
existing pending row, if any, remains in the queue — moderate it explicitly.

### The queue's policy limits

Two numbers in `supabase/migrations/20260820140000_moderation_gate.sql` bound
the queue (both commented "Tune them here"):

- **3 submissions per rolling 7 days** — the rate limit in the submission-gate
  trigger. Resubmissions count too: an edit that returns a row to the queue
  (a rejected set edited back in, a published set edited) charges the same
  window, so resubmission cannot flood the queue. The app surfaces a
  rejection as the contributor's own message.
- **3 published rows to be trusted** — the threshold inside
  `contributor_is_trusted` (the one helper both triggers consult). A trusted
  contributor's new sets skip review entirely, and their edits to published
  or rejected rows stay out of the queue too — the escape valve. Auto-publish
  defers to the published-per-video unique index: a second row for an
  already-published video stays `pending` for the maintainer to judge, and a
  race on that index fails the submission with its own message.

Changing a limit only affects future submissions — nothing retroactive.
