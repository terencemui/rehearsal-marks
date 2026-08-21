-- T25 — Moderation gate and publication status
--
-- The T23 `publication_status` column is the moderation surface; this
-- migration builds the rest of the maintainer's tooling on top of it:
--
--   1. A third status, `rejected`, so a denied submission stays visible to
--      its contributor (own-row reads cover every status) and can be edited
--      back into the review queue.
--   2. A `contributors` table holding bans, readable by client roles only
--      through a security-definer helper — a banned contributor's published
--      rows disappear from readers, and their new submissions are refused.
--   3. The submission gate: one trigger guarding every contributor write,
--      insert and update — banned accounts are refused, submissions are
--      rate-limited (3 per rolling 7 days, resubmissions included), and a
--      contributor with a track record (3 published rows) is auto-published,
--      the escape valve the ADR calls for so the queue does not grow without
--      bound.
--   4. A maintainer-facing moderation function with validated transitions
--      (publish / reject / unpublish), callable from the dashboard SQL
--      editor; its execute right is revoked from PUBLIC, so no client role
--      can reach it.

-- 1. Rejected: a third publication status. The T23 check constraint is
-- dropped and recreated with the same name.

alter table public.label_sets
  drop constraint label_sets_publication_status_check;

alter table public.label_sets
  add constraint label_sets_publication_status_check
  check (publication_status in ('pending', 'published', 'rejected'));

-- 2. Bans: one row per banned contributor, written only by the maintainer
-- (postgres role or service_role key). No grants and no policies — client
-- roles can never read or write it; the only read path is the security-
-- definer helper below, which runs as its owner.

create table public.contributors (
  id uuid primary key references auth.users (id) on delete cascade,
  banned_at timestamptz not null default now()
);

alter table public.contributors enable row level security;
revoke all on public.contributors from anon, authenticated;

-- RLS policies evaluate as the querying role, which has no select grant on
-- contributors — the helper runs as its definer (postgres) so policies and
-- triggers can test for a ban without widening any grant.
create or replace function public.contributor_banned(p_contributor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.contributors
    where id = p_contributor_id and banned_at is not null
  );
$$;

-- A contributor with a track record — 3 published rows — is trusted: their
-- new submissions and their edits skip review. One helper, one place to
-- tune the threshold; both triggers consult it. SECURITY DEFINER like the
-- ban helper, so the count is RLS-free — published rows are public, so
-- nothing leaks.
create or replace function public.contributor_is_trusted(p_contributor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) >= 3
  from public.label_sets
  where contributor_id = p_contributor_id and publication_status = 'published';
$$;

-- 3. The submission gate. One before-insert-or-update trigger guards every
-- contributor write: a banned account is refused, submissions are
-- rate-limited (the queue's flood control), and a trusted contributor is
-- auto-published — their new set skips review entirely. The
-- published-per-video unique index bounds the auto-publish: when a
-- published row already exists for the video, the new row stays pending
-- and the maintainer decides.
--
-- The limits are the queue's policy. Tune them here:
--   3 submissions per rolling 7 days — the rate-limit count below;
--   3 published rows to be trusted — inside contributor_is_trusted.
--
-- The trigger runs as the invoking role (matching T23's `current_user`
-- checks), so it reads label_sets under the caller's RLS — the
-- contributor's own rows, which is exactly what the counts need.
--
-- Updates are submissions too: an edit that returns a row to the queue — a
-- rejected set resubmitted, a published set edited — counts against the
-- same window, so resubmission cannot flood the queue. The window counts
-- `updated_at` (bumped by T23's set_updated_at on every edit), so a row
-- counts from its last write; the row being edited counts its previous
-- write. Edits that keep a row pending, or keep a trusted contributor's
-- row published, do not count: no new queue entry.

create or replace function public.label_sets_gate_submissions()
returns trigger
language plpgsql
as $$
declare
  v_recent_submissions int;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if public.contributor_banned(new.contributor_id) then
    raise exception 'BANNED: This account is suspended from contributing to the Commons.';
  end if;

  if tg_op = 'INSERT' then
    -- The queue's flood control: 3 submissions per rolling 7 days (tuned
    -- here). Every insert is a new queue entry (or an auto-publish).
    select count(*) into v_recent_submissions
    from public.label_sets
    where contributor_id = new.contributor_id
      and created_at > now() - interval '7 days';

    if v_recent_submissions >= 3 then
      raise exception
        'RATE_LIMITED: This account has submitted 3 label sets in the last 7 days — the limit. Try again later.';
    end if;

    -- The escape valve: a trusted contributor's new set skips review. The
    -- published-per-video unique index bounds it: when a published row
    -- already exists for the video, the new row stays pending and the
    -- maintainer decides.
    if public.contributor_is_trusted(new.contributor_id) and not exists (
      select 1 from public.label_sets
      where video_id = new.video_id and publication_status = 'published'
    ) then
      new.publication_status = 'published';
    end if;
  else
    -- tg_op = 'UPDATE'. Only the queue-returning edits are submissions: a
    -- rejected set edited back into the queue, a published set edited back
    -- to pending. The count covers every recent write by this contributor
    -- (updated_at, self included — the row's previous write), so each
    -- resubmission is charged against the same window.
    if old.publication_status in ('rejected', 'published') then
      select count(*) into v_recent_submissions
      from public.label_sets
      where contributor_id = new.contributor_id
        and updated_at > now() - interval '7 days';

      if v_recent_submissions >= 3 then
        raise exception
          'RATE_LIMITED: This account has submitted 3 label sets in the last 7 days — the limit. Try again later.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger label_sets_gate_submissions
  before insert or update on public.label_sets
  for each row execute function public.label_sets_gate_submissions();

-- 4. Re-review: T23's demote-on-edit trigger, extended for the third status
-- and the escape valve. A contributor's edit to a published row returns it
-- to pending — unless they are trusted, in which case the edit stays
-- published: once a contributor's submissions are accepted by default, so
-- are their updates. An edit to a rejected row is a resubmission: back to
-- pending, or straight to published for a trusted contributor.

create or replace function public.label_sets_review_edits()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if old.publication_status = 'published' then
    if not public.contributor_is_trusted(new.contributor_id) then
      new.publication_status = 'pending';
    end if;
    return new;
  end if;

  if old.publication_status = 'rejected' then
    new.publication_status = case
      when public.contributor_is_trusted(new.contributor_id) then 'published'
      else 'pending'
    end;
    return new;
  end if;

  return new;
end;
$$;

-- 5. The maintainer's moderation surface: one SECURITY DEFINER function with
-- validated transitions, callable from the dashboard SQL editor (the
-- postgres role) or — in a trusted server-side script — by RPC under the
-- service_role key. The transitions are strict so a typo cannot silently
-- move a row the maintainer did not mean to move:
--
--   publish   — pending or rejected → published
--   reject    — pending → rejected
--   unpublish — published → pending
--
-- Returns the updated row so the editor shows the result. The T23
-- published-per-video unique index stays the invariant: publishing a second
-- row for a video that already has one fails loudly here.

create or replace function public.moderate_label_set(p_row_id uuid, p_action text)
returns public.label_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.label_sets;
begin
  case p_action
    when 'publish' then
      update public.label_sets
      set publication_status = 'published'
      where id = p_row_id and publication_status in ('pending', 'rejected')
      returning * into v_row;
      if not found then
        raise exception 'Cannot publish: no pending or rejected label set with id %', p_row_id;
      end if;
    when 'reject' then
      update public.label_sets
      set publication_status = 'rejected'
      where id = p_row_id and publication_status = 'pending'
      returning * into v_row;
      if not found then
        raise exception 'Cannot reject: no pending label set with id %', p_row_id;
      end if;
    when 'unpublish' then
      update public.label_sets
      set publication_status = 'pending'
      where id = p_row_id and publication_status = 'published'
      returning * into v_row;
      if not found then
        raise exception 'Cannot unpublish: no published label set with id %', p_row_id;
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
revoke execute on function public.moderate_label_set(uuid, text) from public;

-- 6. A banned contributor's published rows disappear from readers. Both
-- select policies consult the ban helper; a contributor's own rows stay
-- visible to them in every status.

drop policy if exists "Published label sets are readable by anyone"
  on public.label_sets;
create policy "Published label sets are readable by anyone"
  on public.label_sets for select
  to anon
  using (
    publication_status = 'published'
    and not public.contributor_banned(contributor_id)
  );

drop policy if exists "Contributors read their own and published label sets"
  on public.label_sets;
create policy "Contributors read their own and published label sets"
  on public.label_sets for select
  to authenticated
  using (
    (publication_status = 'published' and not public.contributor_banned(contributor_id))
    or contributor_id = auth.uid()
  );
