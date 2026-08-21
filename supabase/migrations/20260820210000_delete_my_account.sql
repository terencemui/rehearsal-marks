-- T26 — Self-service account deletion
--
-- The app now holds user records, so a contributor must be able to delete
-- their account from inside the app (ADR-0001's privacy obligations).
-- supabase-js's deleteUser is admin-only, so the app deletes through this
-- RPC instead: a security-definer function that runs as the table owner and
-- removes the caller's own row from auth.users. The label_sets FK on
-- contributor_id cascades (migration 20260820120000), so the contributor's
-- label sets — published or pending — go with the account.
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

-- Functions execute for `public` by default; only a signed-in contributor
-- may run this one.
revoke execute on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
