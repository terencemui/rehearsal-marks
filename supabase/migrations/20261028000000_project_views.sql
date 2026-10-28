-- T101: opening a public project counts a view.
--
-- Every load of a published public project's read-only page adds one view — no
-- dedup, signed in or not. The count is not a client-writable field: no grant
-- names the column, so the only way to move it is the function below.

alter table public.projects
  add column view_count integer not null default 0
    check (view_count >= 0);

-- A view is not an edit. The shared stamping trigger fires on every write, so
-- it skips a write that moves the count (the review triggers already skip it:
-- they return early for any role but `authenticated`, and the function below
-- runs as its owner). `create or replace trigger` keeps this a migration, not
-- a drop-and-recreate.
create or replace trigger projects_set_updated_at
  before update on public.projects
  for each row
  when (old.view_count is not distinct from new.view_count)
  execute function public.set_updated_at();

-- The one writer. SECURITY DEFINER because no client role may update the
-- column; scoped to published public rows, so a view of anything else is a
-- silent no-op. It returns nothing: a caller cannot tell a missing project from
-- an unpublished one.
create or replace function public.record_project_view(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.projects
  set view_count = view_count + 1
  where id = p_id
    and visibility = 'public'
    and publication_status = 'published';
$$;

-- Client-callable by design: anonymous visitors are the point. Supabase's
-- default privileges grant EXECUTE to anon and authenticated on every new
-- function, so the revoke names `public` and the grant names both roles
-- explicitly (see the T82 migration for why the revoke alone proves nothing).
revoke execute on function public.record_project_view(uuid) from public;
grant execute on function public.record_project_view(uuid) to anon, authenticated;
