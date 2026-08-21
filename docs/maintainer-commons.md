# Maintainer guide: the Commons seed

The Commons is the hosted collection of community label sets (ADR-0001) — the
`label_sets` table in Supabase, with Row Level Security as the authorization
boundary. This file covers seeding it. The moderation workflow that runs on
`pending` submissions is T25's scope; this page is about the Commons having
its first content.

## The seed

`supabase/seed.sql` inserts the first published label set: Tchaikovsky's
Symphony No. 5, Gustav Mahler Jugendorchester under Franz Welser-Möst at the
Wiener Musikverein, 19 September 2009
(`https://www.youtube.com/watch?v=FQzc9c4LOHM`, 46:30). The four markers are
the movement starts, taken from the video's own chapter list, so each timing
is checkable against the performance itself — spot-check 2–3 by ear, the same
step the review checklist asks of every pending row.

## Running it

The seed runs as the postgres role (via the dashboard SQL editor), which
bypasses RLS — the only way a row becomes `published`, since the
`publication_status` column is out of a contributor's reach by design.

1. **The owner account must exist first.** `contributor_id` is not null and
   foreign-keyed to `auth.users`; the seed names the owner explicitly. Sign
   in with the app once (the app's Google sign-in lands with T24) or create
   the user in the dashboard's Auth → Users panel.
2. **Set the email** at the top of `supabase/seed.sql` to the account that
   will own the row, then run the file in the SQL editor. A missing account
   aborts loudly, not silently.
3. **Re-running is harmless** — the published-unique index (one published
   label set per video) makes it a no-op.

## Not here

The review checklist for `pending` submissions and the publish/edit mechanics
for contributors' rows land with T25 (moderation gate and publication
status). When that lands, this file and the checklist belong together.
