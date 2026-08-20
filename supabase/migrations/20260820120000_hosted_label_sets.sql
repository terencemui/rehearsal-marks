-- T23 — Hosted label-set store (ADR-0001)
--
-- The Commons: one `label_sets` row per contributed label set, markers as a
-- single jsonb document. Row Level Security is the authorization boundary:
-- anonymous readers see published rows only, signed-in contributors write and
-- edit only their own rows, and publication status is out of a contributor's
-- reach — a row becomes published only through the maintainer's service_role,
-- which bypasses RLS. The table also enforces the domain's own shape rules
-- (video ID, non-blank title, finite duration) so a row no reader can parse
-- never gets in, and one published label set per video, so a lookup by video
-- ID has exactly one answer.

create table public.label_sets (
  id uuid primary key default gen_random_uuid(),
  -- The recording identity for YouTube label sets: the 11-character video ID
  -- every accepted link form collapses to (CONTEXT.md, "Recording identity").
  -- Case-sensitive, so the check is a shape check only — the domain rule.
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  -- Ownership comes from the session, never the client: default auth.uid(),
  -- excluded from the insert grant below. Cascade ties each row's lifetime
  -- to the contributor account it belongs to.
  contributor_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  -- Not blank: the row parser rejects whitespace-only titles, so a row that
  -- stores one would be unreadable forever.
  title text not null check (btrim(title) <> ''),
  -- Seconds, float — the soft check of recording identity. The upper bound
  -- is the finite check: in Postgres NaN compares greater than every
  -- non-NaN value, so `>= 0` alone would let NaN in.
  duration double precision not null
    check (duration >= 0 and duration < 'Infinity'::float8),
  -- Array of {id, time, aliases, createdAt}. Labels are derived from time
  -- rank, never stored (CONTEXT.md, "Label").
  markers jsonb not null,
  -- The moderation gate: pending rows are invisible to anon. Defaults to
  -- pending, and no grant lets a contributor set it.
  publication_status text not null default 'pending'
    check (publication_status in ('pending', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The Commons is keyed by recording identity, so one published label set per
-- video — the lookup's single answer — while any number of pending
-- submissions can compete for review. This index is also the anon lookup
-- index.
create unique index label_sets_video_id_published_uniq
  on public.label_sets (video_id)
  where (publication_status = 'published');

-- A contributor's own contributions.
create index label_sets_contributor_id_idx
  on public.label_sets (contributor_id);

-- Any edit stamps updated_at, whatever role issues it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger label_sets_set_updated_at
  before update on public.label_sets
  for each row execute function public.set_updated_at();

-- A contributor's edit to a published row returns it to pending: the
-- moderation gate guards every change, not just first publication. The
-- current_user check names the invoking role, so maintainer writes (postgres
-- or service_role) pass through untouched.
create or replace function public.label_sets_review_edits()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' and old.publication_status = 'published' then
    new.publication_status = 'pending';
  end if;
  return new;
end;
$$;

create trigger label_sets_review_edits
  before update on public.label_sets
  for each row execute function public.label_sets_review_edits();

alter table public.label_sets enable row level security;

-- Supabase grants table-wide access to anon/authenticated by default; revoke
-- it so the grants below are the whole story. service_role keeps its grant
-- and bypasses RLS: the maintainer's moderation path.
revoke all on public.label_sets from anon, authenticated;

grant select on public.label_sets to anon, authenticated;

-- The columns a contributor's insert carries: the label set itself, keyed by
-- the contributor's own project id so a set round-trips — and so a later
-- re-publication of an edited set is an UPDATE of this row, not a second
-- row. Ownership defaults to auth.uid() and status defaults to pending —
-- neither is insertable.
grant insert (id, video_id, title, duration, markers)
  on public.label_sets to authenticated;

-- The columns a contributor may edit. publication_status is deliberately
-- absent — a contributor cannot self-publish. video_id and contributor_id are
-- absent too, so a row cannot be moved to another recording or handed to
-- another account.
grant update (title, duration, markers)
  on public.label_sets to authenticated;

grant delete on public.label_sets to authenticated;

-- Anonymous clients read published label sets and nothing else.
create policy "Published label sets are readable by anyone"
  on public.label_sets for select
  to anon
  using (publication_status = 'published');

-- A signed-in contributor also sees their own pending rows.
create policy "Contributors read their own and published label sets"
  on public.label_sets for select
  to authenticated
  using (publication_status = 'published' or contributor_id = auth.uid());

create policy "Contributors insert their own label sets"
  on public.label_sets for insert
  to authenticated
  with check (contributor_id = auth.uid());

-- The ADR's moderation boundary: the with check validates ownership only,
-- not column values — column values are bounded by the update grant above.
create policy "Contributors update their own label sets"
  on public.label_sets for update
  to authenticated
  using (contributor_id = auth.uid())
  with check (contributor_id = auth.uid());

create policy "Contributors delete their own label sets"
  on public.label_sets for delete
  to authenticated
  using (contributor_id = auth.uid());
