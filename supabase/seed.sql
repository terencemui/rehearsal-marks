-- T22 — Seed: the Commons' first published label set
--
-- The Commons is empty at launch; this seeds one real, published label set
-- so it is never blank. Content and provenance:
--
--   Recording:   Tchaikovsky — Symphony No. 5 in E minor, Op. 64
--   Performance: Gustav Mahler Jugendorchester, Franz Welser-Möst,
--                Wiener Musikverein, 19 September 2009
--   Video:       https://www.youtube.com/watch?v=FQzc9c4LOHM
--   Duration:    2790 s (46:30) — the video's own metadata
--
-- The markers are the four movement starts, taken from the video's own
-- chapter list (the uploader's description), so every timing is checkable
-- against the performance itself. Spot-check 2–3 by ear before publishing —
-- the same step the review checklist asks of every pending row.
--
-- The movements (ADR-0005) carry the same four starts as their boundaries, so
-- a project created from this set groups its markers under sticky movement
-- headers and restarts its rehearsal letters at each one.
--
-- Who owns the row: `contributor_id` is not null and foreign-keyed to
-- auth.users, and the seed runs as the postgres role (bypassing RLS), so the
-- owner must be named explicitly. Replace the email below with the Google
-- account you sign in with, then run this file in the dashboard SQL editor.
-- If no such account exists yet (the app's sign-in lands with T24), create
-- the user in the dashboard's Auth → Users panel first.
--
-- Idempotent: the published-unique partial index (one published label set
-- per video) makes a second run a no-op.

do $$
declare
  maintainer uuid;
begin
  select id into maintainer
  from auth.users
  where email = 'you@example.com'  -- TODO: replace with your sign-in email
  limit 1;

  if maintainer is null then
    raise exception
      'Seed aborted: no auth.users row for the email in supabase/seed.sql. '
      'Sign in with the app once (or create the user in the dashboard Auth '
      'panel), set the email at the top of this file, and run it again.';
  end if;

  insert into public.label_sets (video_id, contributor_id, title, duration, markers, movements, publication_status)
  values (
    'FQzc9c4LOHM',
    maintainer,
    'Tchaikovsky: Symphony No. 5 in E minor, Op. 64 — Gustav Mahler Jugendorchester, Franz Welser-Möst',
    2790.0,
    '[
      {"id":"a308978e-edbd-4279-8749-0e684818fea2","time":0.0,"aliases":["I. Andante"],"createdAt":1787184000000},
      {"id":"ad1fd498-30f8-4642-b7a9-63e74e5100a3","time":831.0,"aliases":["II. Andante"],"createdAt":1787184000000},
      {"id":"25791492-e717-452d-8bf0-ff157e2df7db","time":1620.0,"aliases":["III. Valse"],"createdAt":1787184000000},
      {"id":"de5c1cbe-a6ae-44ae-b646-d8e8b406ba37","time":1965.0,"aliases":["IV. Finale"],"createdAt":1787184000000}
    ]'::jsonb,
    '[
      {"id":"bb27d39e-62c5-4b0a-9b1a-8e5f2f3a2c11","name":"I. Andante","start":0.0},
      {"id":"c14e39e0-4a7d-4c2e-b4d7-0a9f8e7d6c55","name":"II. Andante cantabile","start":831.0},
      {"id":"d09f5a4b-3e6d-4a9c-b5e8-1b2c3d4e5f66","name":"III. Valse","start":1620.0},
      {"id":"e05c6b7d-2f8e-4b0a-a6f9-2c3d4e5f6a77","name":"IV. Finale","start":1965.0}
    ]'::jsonb,
    'published'
  )
  on conflict (video_id) where publication_status = 'published' do nothing;
end;
$$;
