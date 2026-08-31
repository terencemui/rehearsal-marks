/**
 * The auth layer — Google sign-in (ADR-0001). supabase-js is imported only
 * inside `supabase.ts`, by the same containment rule the IFrame API has in
 * `src/audio/youtube.ts`; everything above it drives the `SupabaseAuth`
 * shape, which tests fake the way they fake `window.YT`.
 */
import { createAuthController } from './controller';
import type { AuthController } from './controller';
import { createSupabaseAuth, readAuthEnv } from './supabase';

export { createAuthController, userFromUser } from './controller';
export type { AuthController, AuthState, SupabaseAuth, User } from './controller';
export { clearOAuthErrorReturn, createSupabaseAuth, isOAuthErrorReturn, readAuthEnv } from './supabase';
export type { AuthEnv } from './supabase';

/**
 * The default controller for the real app, built from the deployment env.
 * Requires the app to be wired: the App's env gate renders the "not wired up"
 * screen before this factory is ever reached, so a null env here is a
 * programming error, not a degradation state.
 */
export function createDefaultAuthController(): AuthController {
  const env = readAuthEnv();
  if (env === null) throw new Error('Supabase is not configured, but the app did not gate on it.');
  try {
    return createAuthController(createSupabaseAuth(env));
  } catch {
    // readAuthEnv covers the known eager-throw cases; anything else the
    // client constructor can raise still means an unconfigured deployment —
    // and the env gate should have caught it, so this is the same failure.
    throw new Error('Supabase could not be initialised, but the app did not gate on it.');
  }
}
