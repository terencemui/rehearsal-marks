-- Local development fixture — never apply this to the hosted project.
--
-- `supabase db reset` and `supabase start` run this file automatically against
-- the local database, as the postgres role (bypassing RLS). It exists so a
-- fresh checkout has a populated gallery to work against, and it must stay
-- safe to run on any machine with no setup: it creates its own owner rather
-- than naming a real account, so no contributor needs an account to exist
-- first, and no real address is committed to a public repo.
--
-- Content and provenance:
--
--   Recording:   Tchaikovsky — Symphony No. 5 in E minor, Op. 64
--   Performance: hr-Sinfonieorchester – Frankfurt Radio Symphony, Manfred
--                Honeck, Alte Oper Frankfurt, 23 March 2018
--   Video:       https://www.youtube.com/watch?v=a_B02BZp-5Y
--   Duration:    3036 s (50:36) — the video's own metadata
--
-- The four movement starts are taken from the video's own chapter list (the
-- uploader's description), so every timing is checkable against the
-- performance itself. Additional dummy markers (no aliases) are spaced within
-- each movement's range for development/testing: labels derive from time rank
-- within a movement, so each movement's rows letter themselves A, B, C…
-- restarting at A per movement (ADR-0005). The movements (ADR-0005) carry the
-- same four starts as their boundaries, so the project groups its markers
-- under sticky movement headers and restarts its rehearsal letters at each one.
--
-- Seeding *production* is a different job with a different owner — the
-- maintainer's real account — so it is not this file's work. See
-- docs/maintainer-projects.md.
--
-- NEVER point this file at the hosted project. Two CLI commands will, if
-- asked, and they are not equally obvious about it:
--
--   supabase db push --include-seed   # opt-in; must stay unused
--   supabase db reset --linked        # seeds by DEFAULT — pass --no-seed
--
-- The second is the dangerous one, because it is the CLI's own remedy for
-- remote schema drift and `[db.seed] enabled` in config.toml makes applying
-- this file its default. Either would create the synthetic account below as a
-- real `auth.users` row and publish a project owned by it — and since every
-- policy keys on `owner_id = auth.uid()` and that account can never sign in,
-- nobody could edit or delete the row from the app.
--
-- Both inserts carry fixed ids and are idempotent, so re-running is a no-op.

-- The synthetic owner. It is inserted directly because a dev database has no
-- accounts and nothing in a fresh checkout can authenticate: the app's
-- sign-in is Google-only. The address is at example.com, which RFC 2606
-- reserves so that it can never belong to a real person.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at
)
values (
  'a0000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'dev@example.com',
  now(), now(), now()
)
on conflict (id) do nothing;

-- The project, owned by that account. `owner_id` is not null and foreign-keyed
-- to auth.users; `name` is the owner's editable label, `recording_title` is the
-- video's canonical title, `visibility` is public, and `publication_status` is
-- published — the seed runs as the postgres role, so it can set the status the
-- moderation gate would otherwise own.
insert into public.projects (
  id, owner_id, name, recording_title, video_id, duration,
  markers, movements, visibility, publication_status
)
values (
  '7f8f4a10-2c3e-4b1a-9d5b-6a0e8f9c1d2e',
  'a0000000-0000-4000-8000-000000000001',
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
