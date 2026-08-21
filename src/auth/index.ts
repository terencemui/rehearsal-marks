/**
 * The auth layer — contributor sign-in with Google (ADR-0001). supabase-js is
 * imported only inside `supabase.ts`, by the same containment rule the IFrame
 * API has in `src/audio/youtube.ts`; everything above it drives the
 * `SupabaseAuth` shape, which tests fake the way they fake `window.YT`.
 */
import { createAuthController } from './controller';
import type { AuthController } from './controller';
import { createSupabaseAuth, readAuthEnv } from './supabase';

export { AUTH_UNAVAILABLE_REASON, createAuthController, contributorFromUser } from './controller';
export type { AuthController, AuthState, Contributor, SupabaseAuth } from './controller';
export { createSupabaseAuth, readAuthEnv } from './supabase';
export type { AuthEnv } from './supabase';
export { BANNED_PREFIX, createSupabaseCommonsWrite, RATE_LIMITED_PREFIX } from './write';
export type { SupabaseCommonsWrite } from './write';

/**
 * The default controller for the real app: built from the deployment env, or
 * `unavailable` when the app is not wired to a Supabase project yet — the
 * honest unconfigured state, never a crash.
 */
export function createDefaultAuthController(): AuthController {
  const env = readAuthEnv();
  if (env === null) return createAuthController(null);
  try {
    return createAuthController(createSupabaseAuth(env));
  } catch {
    // readAuthEnv covers the known eager-throw cases; anything else the
    // client constructor can raise is still an unconfigured deployment, not
    // a crash — the degradation contract holds either way.
    return createAuthController(null);
  }
}
