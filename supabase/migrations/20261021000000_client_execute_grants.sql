-- T82: only the maintainer's database path may call the moderation function.
--
-- The baseline revokes EXECUTE on `moderate_project` from `public`, which
-- reads as the whole guard. It is not: Supabase's default privileges grant
-- EXECUTE on every new function in `public` to `anon` and `authenticated`,
-- and a revoke from `public` does not undo a grant made to a role. On a
-- hosted project the browser's anon key therefore let any visitor call the
-- RPC and change any public project's publication status, bypassing RLS.
-- The local stack's default privileges differ, which is why building locally
-- never surfaced it. This file leaves service_role and postgres untouched.

revoke execute on function public.moderate_project(uuid, text) from public, anon, authenticated;

-- Account deletion stays a signed-in surface: anon loses the platform's
-- default grant; authenticated keeps the explicit one from the baseline.
revoke execute on function public.delete_my_account() from public, anon;
