/**
 * The Supabase auth backend — the only module in the app that references the
 * supabase-js library, by the same containment rule the IFrame API has in
 * `src/audio/youtube.ts` ("referenced nowhere outside this module"). Its unit
 * tests drive the `SupabaseAuth` shape the controller defines; this file is
 * the real implementation of that shape and nothing else.
 *
 * The client is built from Vite env vars (`VITE_SUPABASE_URL`,
 * `VITE_SUPABASE_ANON_KEY`) — both are public by design: the anon key is the
 * key the browser ships with, and Row Level Security, not the key, is the
 * authorization boundary (ADR-0001).
 */

import { createClient } from '@supabase/supabase-js';
import { contributorFromUser } from './controller';
import type { AuthUser, Contributor, SupabaseAuth } from './controller';

/** The env wiring contract — see `supabase/README.md`. */
export interface AuthEnv {
  /** The Supabase project URL (VITE_SUPABASE_URL). */
  url: string;
  /** The project's anon (public) key (VITE_SUPABASE_ANON_KEY). */
  anonKey: string;
}

/**
 * Reads the deployment's auth env. Returns null for every configuration the
 * client could not be built from — a missing var, a blank one, or a URL that
 * is not a parseable http(s) address (supabase-js throws on those eagerly).
 * The unconfigured case the controller reports as `unavailable`: the app
 * never constructs a client it cannot, and never crashes on a config typo.
 */
export function readAuthEnv(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): AuthEnv | null {
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (url === '' || anonKey === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return { url, anonKey };
}

/**
 * The failure markers Google's OAuth return leaves in the URL fragment when
 * consent is denied or the provider reports an error (e.g. `#error=access_denied`).
 */
export function isOAuthErrorReturn(hash: string): boolean {
  return /error(=|_)/.test(hash);
}

/**
 * Strips an OAuth error return from the URL. supabase-js leaves `#error=...`
 * in place after a failed return and, seeing it, skips session recovery on
 * every later load — a denied consent would otherwise pin an already
 * signed-in user to anonymous indefinitely. Only the fragment is touched;
 * the page keeps its path and query.
 */
export function clearOAuthErrorReturn(): void {
  if (!isOAuthErrorReturn(window.location.hash)) return;
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

/**
 * Maps a session to a contributor, tolerating auth-js's proxy for a stored
 * user that cannot be read (stale or corrupt storage). A session whose user
 * cannot be identified is no session: it degrades to anonymous instead of
 * throwing through the subscriber loop.
 */
function sessionContributor(session: { user: AuthUser } | null): Contributor | null {
  if (session === null) return null;
  try {
    return contributorFromUser(session.user);
  } catch {
    return null;
  }
}

/** The `SupabaseAuth` the controller drives, backed by a real supabase-js client. */
export function createSupabaseAuth(env: AuthEnv): SupabaseAuth {
  const client = createClient(env.url, env.anonKey);

  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) {
        clearOAuthErrorReturn();
        throw error;
      }
      return sessionContributor(data.session);
    },
    onAuthStateChange(listener) {
      // The session arg is null on sign-out and every unsigned-in event; the
      // controller only ever needs the session, not which event fired.
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(sessionContributor(session));
      });
      return { unsubscribe: () => data.subscription.unsubscribe() };
    },
    async signInWithGoogle() {
      // supabase-js reports failures in the result, not as rejections.
      const { error } = await client.auth.signInWithOAuth({ provider: 'google' });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
    async deleteAccount() {
      // The self-service deletion path (T26): supabase-js's deleteUser is
      // admin-only, so the account is removed through the
      // `delete_my_account` RPC — a security-definer function that deletes
      // the caller's own auth.users row, with the projects FK cascade
      // (T49, migration 20260828120000) taking their projects with it.
      const { error } = await client.rpc('delete_my_account');
      if (error) throw error;
      // The account is gone; the stored session is dead. Clear it locally so
      // the next load restores anonymous instead of painting a ghost session
      // that no longer exists server-side. A failure here must not fail the
      // deletion: the account is already gone, and the controller lands
      // anonymous from its own success path — the stale session just gets
      // dropped by the next failed refresh instead.
      try {
        await client.auth.signOut({ scope: 'local' });
      } catch {
        // The deletion succeeded; a dead local session is cosmetic.
      }
    },
  };
}
