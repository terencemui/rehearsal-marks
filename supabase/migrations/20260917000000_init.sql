-- Initial schema: the projects world (ADR-0006).
--
-- This is a squashed baseline. It replaces the five-migration chain that built
-- this schema incrementally — the hosted label sets, the moderation gate,
-- account deletion, movements, and the server-side projects rewrite. Those
-- files recorded the retirement of the Commons and its label sets; with the
-- transition complete and no environment left to upgrade, only the resulting
-- state is worth carrying. The pre-squash chain lives in git history.
--
-- A baseline is a different kind of file from a migration: it has to be
-- complete on its own, where a migration only has to be a correct step. Three
-- things below are easy to lose in a squash precisely because the migration
-- that introduced the projects table never touched them:
--
--   * `set_updated_at` — the shared stamping trigger function. Loud if
--     dropped: the projects trigger at the bottom names it.
--   * `delete_my_account` — the self-service account-deletion RPC. Silent if
--     dropped: nothing here references it, so the app's delete-account path
--     would simply stop existing, with no error at migration time.
--   * the `revoke all` on `banned_users` — silent, and a security hole.
--     Supabase grants anon/authenticated full privileges (arwdDxtm) on every
--     new table in `public` by default, so a `create table` with no revoke
--     leaves the bans table client-readable *and* client-writable.

-- 1. The shared stamping function. Language plpgsql, so nothing in it is bound
-- to a table at creation and every table's updated_at trigger can reuse it.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Self-service account deletion. supabase-js's deleteUser is admin-only, so
-- the app deletes through this RPC instead: a security-definer function that
-- runs as the table owner and removes the caller's own row from auth.users
-- (ADR-0001's privacy obligations). The projects owner_id FK cascades, so the
-- account's projects go with it.
--
-- Scope note: this removes the auth.users row; the account's sessions and
-- refresh tokens reference it and stop working with it. An access token
-- already issued keeps working until it expires (RLS honors it for at most
-- the token lifetime), the usual bound of any account-deletion flow.

create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = public
as $$
  -- auth.uid() reads the caller's JWT claims, so this can only ever delete
  -- the caller's own account, whatever role the function runs as.
  delete from auth.users where id = auth.uid();
$$;

-- Functions execute for `public` by default; only a signed-in user may run
-- this one.
revoke execute on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- 3. The projects table — the app's entire server-side concept. Each project
-- belongs to a signed-in User, carries its own name plus the recording's
-- canonical title, and is public by default with a visibility flag and a
-- publication status. The recording-identity shape rules (video ID, non-blank
-- titles, finite duration) keep a row no reader can parse out of the store;
-- `name` is the user's editable label while `recording_title` is the canonical
-- title fetched once from YouTube, never edited in place. `publication_status`
-- is meaningful for public projects only; `visibility` is the flag that
-- decides whether a project enters the review surface at all.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  -- Ownership comes from the session, never the client: default auth.uid(),
  -- excluded from the insert grant below. Cascade ties each project's
  -- lifetime to the account it belongs to.
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  -- The user's editable project name — the gallery groups by recording
  -- title, never by this, so a rename never mislabels the recording.
  name text not null check (btrim(name) <> ''),
  -- The canonical recording title, fetched once from YouTube at creation and
  -- never editable (ADR-0006, "Recording title").
  recording_title text not null check (btrim(recording_title) <> ''),
  -- The recording identity for YouTube projects: the 11-character video ID
  -- every accepted link form collapses to (CONTEXT.md, "Recording identity").
  -- Case-sensitive, so the check is a shape check only — the domain rule.
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  -- Seconds, float — the soft check of recording identity. The upper bound
  -- is the finite check: in Postgres NaN compares greater than every
  -- non-NaN value, so `>= 0` alone would let NaN in.
  duration double precision not null
    check (duration >= 0 and duration < 'Infinity'::float8),
  -- Array of {id, time, aliases, createdAt}. Labels are derived from time
  -- rank, never stored (CONTEXT.md, "Label").
  markers jsonb not null,
  -- Array of {id, name, start} movement boundaries (ADR-0005), additive and
  -- optional — a project with no movements is one flat marker sequence.
  movements jsonb not null default '[]'::jsonb,
  -- Public by default — a project is a contribution unless its owner opts
  -- out. Private projects never enter review and are visible to no one but
  -- their owner.
  visibility text not null default 'public'
    check (visibility in ('public', 'private')),
  -- The moderation surface, meaningful for public projects only. Defaults to
  -- pending, and no grant lets a client set it — the gate trigger and the
  -- maintainer's moderation function are its only writers.
  publication_status text not null default 'pending'
    check (publication_status in ('pending', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The owner's own projects, whatever their status or visibility.
create index projects_owner_id_idx
  on public.projects (owner_id);

-- The gallery read: published public projects, newest first. Partial, so the
-- anon lookup stays small as private and pending rows accumulate.
create index projects_public_newest_idx
  on public.projects (created_at desc)
  where visibility = 'public' and publication_status = 'published';

-- 4. Bans. One row per banned user, written only by the maintainer (postgres
-- role or service_role key). No grants and no policies — client roles can
-- never read or write it; the only read path is the security-definer helper
-- below, which runs as its owner (postgres), so policies and triggers can
-- test for a ban without widening any grant. The revoke is load-bearing:
-- Supabase's default privileges would otherwise hand anon and authenticated
-- full access to this table the moment it is created.

create table public.banned_users (
  id uuid primary key references auth.users (id) on delete cascade,
  banned_at timestamptz not null default now()
);

alter table public.banned_users enable row level security;

revoke all on public.banned_users from anon, authenticated;

-- service_role — the trusted server-side role — keeps access, so a maintainer
-- script under the service key can read and write bans. Granted explicitly
-- rather than inherited: the platform's default privileges differ between
-- environments (a hosted project carries them, a locally built one does not),
-- so inheriting them would make the schema depend on where it was built.
grant select, insert, update, delete on public.banned_users to service_role;

-- RLS policies evaluate as the querying role, which has no select grant on
-- banned_users — the helper runs as its definer (postgres) so policies and
-- triggers can test for a ban without widening any grant.
create or replace function public.user_banned(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.banned_users
    where id = p_owner_id and banned_at is not null
  );
$$;

-- A User with a track record — 3 published public projects — is trusted:
-- their new public projects publish immediately and their edits skip review.
-- One helper, one place to tune the threshold; both triggers consult it.
-- SECURITY DEFINER like the ban helper, so the count is RLS-free — published
-- rows are public, so nothing leaks.
create or replace function public.user_is_trusted(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) >= 3
  from public.projects
  where owner_id = p_owner_id
    and visibility = 'public'
    and publication_status = 'published';
$$;

-- 5. The submission gate. One before-insert-or-update trigger guards public
-- writes: a banned owner is refused, and a trusted owner's new public project
-- auto-publishes unconditionally — no published-per-video guard and no
-- submission rate limit, so many public projects per recording are allowed.
-- Private writes bypass the gate entirely: a private project is visible to
-- its owner alone, so there is nothing to review and nothing to refuse.

create or replace function public.projects_gate_writes()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- Private writes bypass the moderation gate.
  if new.visibility = 'private' then
    return new;
  end if;

  -- Public writes from a banned owner are refused; their private projects
  -- keep saving (the check above already passed them through).
  if public.user_banned(new.owner_id) then
    raise exception 'BANNED: This account is suspended from publishing public projects.';
  end if;

  -- The escape valve: a trusted owner's new public project publishes
  -- immediately. Unconditional — many public projects per recording are
  -- allowed, so there is no published-per-video guard, and the submission
  -- rate limit is gone.
  if tg_op = 'INSERT' then
    if public.user_is_trusted(new.owner_id) then
      new.publication_status = 'published';
    end if;
  end if;

  return new;
end;
$$;

create trigger projects_gate_writes
  before insert or update on public.projects
  for each row execute function public.projects_gate_writes();

-- 6. Re-review. An owner's edit to a published public project returns it to
-- pending — unless they are trusted, in which case the edit stays published:
-- once a user's projects publish by default, so do their updates. An edit to
-- a rejected project is a resubmission: back to pending, or straight to
-- published for a trusted owner. A private project made public enters the
-- queue the same way. Private projects bypass all of this.

create or replace function public.projects_review_edits()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- Private projects bypass the gate; their status is meaningless.
  if new.visibility = 'private' then
    return new;
  end if;

  -- A private project made public is a new submission.
  if old.visibility = 'private' and new.visibility = 'public' then
    new.publication_status = case
      when public.user_is_trusted(new.owner_id) then 'published'
      else 'pending'
    end;
    return new;
  end if;

  if old.publication_status = 'published' then
    if not public.user_is_trusted(new.owner_id) then
      new.publication_status = 'pending';
    end if;
    return new;
  end if;

  if old.publication_status = 'rejected' then
    new.publication_status = case
      when public.user_is_trusted(new.owner_id) then 'published'
      else 'pending'
    end;
  end if;

  return new;
end;
$$;

create trigger projects_review_edits
  before update on public.projects
  for each row execute function public.projects_review_edits();

-- 7. The maintainer's moderation surface: one SECURITY DEFINER function with
-- validated transitions, callable from the dashboard SQL editor (the postgres
-- role) or — in a trusted server-side script — by RPC under the service_role
-- key. The transitions are strict so a typo cannot silently move a row the
-- maintainer did not mean to move. Status is meaningful for public projects
-- only, so every transition is scoped to public rows:
--
--   publish   — pending or rejected public → published
--   reject    — pending public → rejected
--   unpublish — published public → pending
--
-- Returns the updated row so the editor shows the result.

create or replace function public.moderate_project(p_row_id uuid, p_action text)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.projects;
begin
  case p_action
    when 'publish' then
      update public.projects
      set publication_status = 'published'
      where id = p_row_id
        and visibility = 'public'
        and publication_status in ('pending', 'rejected')
      returning * into v_row;
      if not found then
        raise exception 'Cannot publish: no pending or rejected public project with id %', p_row_id;
      end if;
    when 'reject' then
      update public.projects
      set publication_status = 'rejected'
      where id = p_row_id
        and visibility = 'public'
        and publication_status = 'pending'
      returning * into v_row;
      if not found then
        raise exception 'Cannot reject: no pending public project with id %', p_row_id;
      end if;
    when 'unpublish' then
      update public.projects
      set publication_status = 'pending'
      where id = p_row_id
        and visibility = 'public'
        and publication_status = 'published'
      returning * into v_row;
      if not found then
        raise exception 'Cannot unpublish: no published public project with id %', p_row_id;
      end if;
    else
      raise exception
        'Unknown moderation action "%" — use publish, reject, or unpublish.', p_action;
  end case;
  return v_row;
end;
$$;

-- The moderation surface is not a client surface: only the postgres role
-- (dashboard SQL editor) can execute it by default. A future trusted
-- server-side script may `grant execute ... to service_role` explicitly.
revoke execute on function public.moderate_project(uuid, text) from public;

-- 8. Row Level Security on projects. Supabase grants table-wide access to
-- anon/authenticated by default; revoke it so the grants below are the whole
-- story. service_role keeps its grant and bypasses RLS: the maintainer's
-- moderation path and the seed.

alter table public.projects enable row level security;

revoke all on public.projects from anon, authenticated;

grant select on public.projects to anon, authenticated;

-- The columns a project's insert carries. Ownership defaults to auth.uid()
-- and status defaults to pending — neither is insertable, so the client can
-- neither hand the project to another account nor self-publish.
grant insert (name, recording_title, video_id, duration, markers, movements, visibility)
  on public.projects to authenticated;

-- The columns an owner may edit. publication_status is deliberately absent —
-- a client cannot self-publish or unpublish. recording_title, video_id, and
-- duration are absent too — the recording identity is fixed at creation.
grant update (name, markers, movements, visibility)
  on public.projects to authenticated;

grant delete on public.projects to authenticated;

-- service_role bypasses RLS but still needs table privileges — it is the
-- maintainer's moderation path and the seed. The revoke above does not touch
-- it (it names anon and authenticated only), so this grant is what actually
-- establishes its access; explicit for the same reason as the bans table's.
grant select, insert, update, delete on public.projects to service_role;

-- Anonymous readers see published public projects and nothing else — the
-- gallery's read surface, with banned owners' rows excluded.
create policy "Published public projects are readable by anyone"
  on public.projects for select
  to anon
  using (
    visibility = 'public'
    and publication_status = 'published'
    and not public.user_banned(owner_id)
  );

-- A signed-in user also sees their own projects in every status and both
-- visibilities — the projects screen — plus everyone's published public
-- projects, banned owners excluded.
create policy "Users read their own and published public projects"
  on public.projects for select
  to authenticated
  using (
    (visibility = 'public'
      and publication_status = 'published'
      and not public.user_banned(owner_id))
    or owner_id = auth.uid()
  );

create policy "Users insert their own projects"
  on public.projects for insert
  to authenticated
  with check (owner_id = auth.uid());

-- The with check validates ownership only, not column values — column values
-- are bounded by the update grant above.
create policy "Users update their own projects"
  on public.projects for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Users delete their own projects"
  on public.projects for delete
  to authenticated
  using (owner_id = auth.uid());

-- 9. Any write stamps updated_at, whatever role issues it.

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
