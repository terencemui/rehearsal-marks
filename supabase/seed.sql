-- T49 — Seed: the first published public project
--
-- The gallery is empty at launch; this seeds one real, published public
-- project so it is never blank. Content and provenance:
--
--   Recording:   Tchaikovsky — Symphony No. 5 in E minor, Op. 64
--   Performance: hr-Sinfonieorchester – Frankfurt Radio Symphony, Manfred
--                Honeck, Alte Oper Frankfurt, 23 March 2018
--   Video:       https://www.youtube.com/watch?v=a_B02BZp-5Y
--   Duration:    3036 s (50:36) — the video's own metadata
--
-- The markers are the four movement starts, taken from the video's own
-- chapter list (the uploader's description), so every timing is checkable
-- against the performance itself. Spot-check 2–3 by ear before publishing —
-- the same step the review checklist asks of every pending project.
--
-- Additional dummy markers (no aliases) are spaced within each movement's
-- range for development/testing: labels derive from time rank within a
-- movement, so each movement's rows letter themselves A, B, C… restarting at
-- A per movement (ADR-0005).
--
-- The movements (ADR-0005) carry the same four starts as their boundaries, so
-- the project groups its markers under sticky movement headers and restarts
-- its rehearsal letters at each one.
--
-- The row is a project: `owner_id` names the signed-in User who owns it (the
-- maintainer), `name` is that user's editable label, `recording_title` is the
-- video's canonical title, `visibility` is public, and `publication_status`
-- is published — the seed runs as the postgres role (bypassing RLS), so it
-- can set the status the gate would otherwise own.
--
-- Who owns the row: `owner_id` is not null and foreign-keyed to auth.users,
-- and the seed runs as the postgres role (bypassing RLS), so the owner must
-- be named explicitly. Replace the email below with the Google account you
-- sign in with, then run this file in the dashboard SQL editor. If no such
-- account exists yet (the app's sign-in lands with T24), create the user in
-- the dashboard's Auth → Users panel first.
--
-- Idempotent: the project carries a fixed id, so a second run is a no-op.

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

  insert into public.projects (
    id, owner_id, name, recording_title, video_id, duration,
    markers, movements, visibility, publication_status
  )
  values (
    '7f8f4a10-2c3e-4b1a-9d5b-6a0e8f9c1d2e',
    maintainer,
    'Honeck Tchaikovsky 5',
    'Tschaikowsky: 5. Sinfonie – hr-Sinfonieorchester, Manfred Honeck',
    'a_B02BZp-5Y',
    3036.0,
    '[
      {"id":"85fdd5e1-7522-492b-8de7-5b145abb3bca","time":34.0,"aliases":["I. Andante"],"createdAt":1787184000000},
      {"id":"25c8311d-0197-43c6-97f8-2ac12683d2d9","time":150.0,"aliases":[],"createdAt":1787184000000},
      {"id":"2d87a5cf-39ed-448c-a9c1-6c4a57020fda","time":300.0,"aliases":[],"createdAt":1787184000000},
      {"id":"55d540ed-4dcf-4741-8de7-e3590dd6c128","time":450.0,"aliases":[],"createdAt":1787184000000},
      {"id":"edc2b696-a037-44e8-8999-2742f182ad5d","time":600.0,"aliases":[],"createdAt":1787184000000},
      {"id":"4607fc95-1e2f-47b1-9ab0-85b2f5ab586e","time":750.0,"aliases":[],"createdAt":1787184000000},
      {"id":"e05f14de-a281-4ff2-97a8-124ef65414b8","time":913.0,"aliases":["II. Andante"],"createdAt":1787184000000},
      {"id":"51070b65-45b4-49ec-a28e-8c36750f7c46","time":1100.0,"aliases":[],"createdAt":1787184000000},
      {"id":"901aadf6-5925-4b77-a33b-d42cd006d328","time":1300.0,"aliases":[],"createdAt":1787184000000},
      {"id":"771bca2c-5cd0-41d9-8d42-2f36c9b360c3","time":1500.0,"aliases":[],"createdAt":1787184000000},
      {"id":"156626ab-8b28-4361-87ba-2cc00e72b06c","time":1700.0,"aliases":[],"createdAt":1787184000000},
      {"id":"25629e46-4ee3-4117-88f8-962d7f658753","time":1743.0,"aliases":["III. Valse"],"createdAt":1787184000000},
      {"id":"067b1090-10e2-4285-8edc-81851900204d","time":1800.0,"aliases":[],"createdAt":1787184000000},
      {"id":"a9c6e241-7828-41a5-a689-86690acaeca7","time":1900.0,"aliases":[],"createdAt":1787184000000},
      {"id":"e27415aa-fe1b-4305-ab90-404ea5885157","time":2000.0,"aliases":[],"createdAt":1787184000000},
      {"id":"49d62d3a-8209-4fb1-bc4b-eb54d9aff1cb","time":2074.0,"aliases":["IV. Finale"],"createdAt":1787184000000},
      {"id":"ac11c10a-8e73-402e-bbd7-307b68f2a8dd","time":2200.0,"aliases":[],"createdAt":1787184000000},
      {"id":"5165a765-cbf5-4967-8d5b-2edab0c6f327","time":2400.0,"aliases":[],"createdAt":1787184000000},
      {"id":"69d448a3-980a-44c8-a120-3aa62453dabd","time":2600.0,"aliases":[],"createdAt":1787184000000},
      {"id":"14299544-c1a0-4534-aab5-3c00205366cf","time":2800.0,"aliases":[],"createdAt":1787184000000},
      {"id":"7e9146c7-7951-4881-915d-9abbfba79452","time":3000.0,"aliases":[],"createdAt":1787184000000}
    ]'::jsonb,
    '[
      {"id":"ab91b769-5670-4444-af88-5edc6d4fac5e","name":"I. Andante","start":34.0},
      {"id":"ffc7d67b-a242-444b-aad1-0c3c346cc65d","name":"II. Andante cantabile","start":913.0},
      {"id":"3882693d-4cbd-46f8-8204-ee4792bca137","name":"III. Valse","start":1743.0},
      {"id":"9277e368-2a99-4932-9a34-fcdf0a7e7a5a","name":"IV. Finale","start":2074.0}
    ]'::jsonb,
    'public',
    'published'
  )
  on conflict (id) do nothing;
end;
$$;
