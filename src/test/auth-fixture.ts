import { vi } from 'vitest';
import { createAuthController } from '../auth';
import type { AuthController, Contributor, SupabaseAuth } from '../auth';

/**
 * Test double for the SupabaseAuth seam — the one seam the auth controller
 * drives, faked the way the audio tests fake `window.YT`. The backend starts
 * anonymous and succeeds by default; `setContributor` lets a test publish a
 * session the way the real backend's sign-in round-trip would, and
 * `failNextSignIn` / `failNextSignOut` exercise the degrade-to-anonymous
 * paths.
 */
export interface MockAuthBackend extends SupabaseAuth {
  /** The session as the backend would hold it after a sign-in round-trip. */
  setContributor(contributor: Contributor | null): void;
  /** The next sign-in rejects — a provider or network failure. */
  failNextSignIn(): void;
  /** The next sign-out rejects. */
  failNextSignOut(): void;
  /** The next account deletion rejects — a backend failure. */
  failNextAccountDelete(): void;
}

export function mockAuthBackend(): MockAuthBackend {
  let contributor: Contributor | null = null;
  let nextSignInFails = false;
  let nextSignOutFails = false;
  let nextDeleteFails = false;
  const listeners = new Set<(contributor: Contributor | null) => void>();

  return {
    getSession: vi.fn(async () => contributor),
    onAuthStateChange: vi.fn((listener) => {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    }),
    signInWithGoogle: vi.fn(async () => {
      if (nextSignInFails) {
        nextSignInFails = false;
        throw new Error('google sign-in failed');
      }
      // The real flow redirects away and the session lands through the
      // session events on return; tests drive that with setContributor.
    }),
    signOut: vi.fn(async () => {
      if (nextSignOutFails) {
        nextSignOutFails = false;
        // supabase-js removes the local session (firing SIGNED_OUT) before
        // reporting the API error — mirror that ordering so the controller's
        // failure path is tested against the real shape of a failure.
        contributor = null;
        for (const listener of listeners) listener(null);
        throw new Error('sign-out failed');
      }
      contributor = null;
      for (const listener of listeners) listener(null);
    }),
    deleteAccount: vi.fn(async () => {
      if (nextDeleteFails) {
        nextDeleteFails = false;
        // A failed deletion changes nothing server-side: the session stays.
        throw new Error('account deletion failed');
      }
      // The account is gone: the backend's own session is dead, and the
      // controller lands anonymous from its own success path.
      contributor = null;
      for (const listener of listeners) listener(null);
    }),
    setContributor(next) {
      contributor = next;
      for (const listener of listeners) listener(next);
    },
    failNextSignIn() {
      nextSignInFails = true;
    },
    failNextSignOut() {
      nextSignOutFails = true;
    },
    failNextAccountDelete() {
      nextDeleteFails = true;
    },
  };
}

/** A controller over a fresh fake backend, with the backend to drive it. */
export function mockAuth(): { controller: AuthController; backend: MockAuthBackend } {
  const backend = mockAuthBackend();
  return { controller: createAuthController(backend), backend };
}
