/**
 * The auth controller — the app's whole sign-in surface, over a minimal
 * backend shape the supabase-js adapter (`supabase.ts`) implements. The
 * containment rule from the IFrame API holds here too: supabase-js is
 * referenced nowhere outside the auth layer, and the controller is driven
 * through this narrow interface so the tests can fake it exactly the way the
 * audio tests fake `window.YT`.
 *
 * The controller's contract with the app: every failure degrades to
 * anonymous browsing with an honest notice — a failed sign-in or sign-out
 * never rejects out of the controller. An unconfigured deployment never
 * reaches this controller at all: the app gates on the env and renders its
 * "not wired up" screen (T51), so a backend always exists here.
 */

/** A signed-in person — the `auth.users` row the session belongs to. */
export interface User {
  /** The auth account id (Supabase `auth.users.id`), never sent by the client. */
  id: string;
  /** The display name the provider sent, or the email when there is none. */
  name: string;
  email: string;
}

/**
 * The app's view of the auth session. The notice rides on the state it
 * describes: a failed sign-in leaves `anonymous` with the reason, a failed
 * sign-out leaves `signed-in` with the reason.
 */
export type AuthState =
  | { kind: 'anonymous'; notice?: string }
  | { kind: 'signed-in'; user: User; notice?: string };

export interface AuthController {
  /** The current snapshot — read at mount, so the first paint is already honest. */
  getState(): AuthState;
  /** Registers a listener; returns the unsubscribe. */
  subscribe(listener: (state: AuthState) => void): () => void;
  /**
   * Starts the Google OAuth flow. Resolves when the flow leaves the app (the
   * session lands later, through the backend's session events) or fails —
   * a failure lands in state as anonymous + notice, never as a rejection.
   */
  signInWithGoogle(): Promise<void>;
  /** Ends the session; a failure lands in state as a notice, never a rejection. */
  signOut(): Promise<void>;
  /**
   * Permanently deletes the signed-in user's account and the projects it owns
   * (T26). A success lands the app anonymous; a failure keeps the signed-in
   * state with the reason, never a rejection.
   */
  deleteAccount(): Promise<void>;
  /** Unsubscribes from the backend; the controller publishes nothing after. */
  destroy(): void;
}

/**
 * The backend surface the controller drives: supabase-js's auth API, narrowed
 * to what the app uses and shaped to carry `User` instead of the library's
 * own user object. `supabase.ts` is the only implementation.
 */
export interface SupabaseAuth {
  /** The current session, or null when signed out. */
  getSession(): Promise<User | null>;
  /** Registers a session listener (supabase-js fires the restored session first). */
  onAuthStateChange(listener: (user: User | null) => void): {
    unsubscribe(): void;
  };
  /** Starts the Google OAuth flow (the full-page redirect). */
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** Deletes the signed-in account and, by cascade, its projects. */
  deleteAccount(): Promise<void>;
}

/**
 * The app's account facts from the auth provider's user — the one mapping,
 * so the adapter stays a straight pass-through and the rule ("name or email")
 * is testable without supabase-js.
 */
export function userFromUser(user: AuthUser): User {
  const email = user.email ?? '';
  const metadataName = user.user_metadata?.full_name;
  const name = typeof metadataName === 'string' && metadataName.trim() !== '' ? metadataName : email;
  return { id: user.id, name, email };
}

/** The user shape the mapping reads — supabase-js's `User`, structurally. */
export interface AuthUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

export function createAuthController(backend: SupabaseAuth): AuthController {
  let state: AuthState = { kind: 'anonymous' };
  const listeners = new Set<(state: AuthState) => void>();
  // A session event is always fresher than the restore's snapshot: it can
  // fire (or already have fired) between construction and the restore's
  // resolution, and must never be overwritten by the restore's stale answer.
  let sessionEventSeen = false;

  /** Publishes a state only when it actually changes. */
  function emit(next: AuthState): void {
    if (sameState(next, state)) return;
    state = next;
    for (const listener of listeners) listener(state);
  }

  function applySession(user: User | null): void {
    sessionEventSeen = true;
    if (user === null) {
      emit({ kind: 'anonymous' });
    } else {
      emit({ kind: 'signed-in', user });
    }
  }

  // Subscribe before restoring, so a session event landing during the
  // restore's async window is still heard.
  const subscription = backend.onAuthStateChange(applySession);

  void backend.getSession().then((user) => {
    if (sessionEventSeen) return;
    applySession(user);
  }, () => {
    // A restore that fails is a startup that starts anonymous: the
    // degradation contract, silently — no notice to greet a returning
    // visitor whose session simply could not be read.
  });

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signInWithGoogle: async () => {
      try {
        await backend.signInWithGoogle();
      } catch {
        // A failed sign-in never wipes an existing session — the notice
        // describes the attempt that just failed, whatever it left behind.
        emit(
          state.kind === 'signed-in' ? { ...state, notice: SIGN_IN_FAILED } : { kind: 'anonymous', notice: SIGN_IN_FAILED },
        );
      }
    },
    signOut: async () => {
      try {
        await backend.signOut();
        // The backend fires its own signed-out event, but the state must be
        // anonymous the moment sign-out succeeded regardless — the event can
        // be delayed, and a backend that never fires one must not leave the
        // app claiming a session that no longer exists.
        emit({ kind: 'anonymous' });
      } catch {
        // A failed sign-out has two honest endings, and which one the state
        // shows by the time the error lands decides: supabase-js removes the
        // local session (firing SIGNED_OUT) before reporting the API error,
        // so the common failure lands anonymous with a partial-sign-out
        // notice; a failure before anything changed (the local session could
        // not even be read) keeps the signed-in state with the retry notice.
        emit(
          state.kind === 'signed-in'
            ? { ...state, notice: SIGN_OUT_FAILED }
            : { kind: 'anonymous', notice: SIGN_OUT_PARTIAL },
        );
      }
    },
    deleteAccount: async () => {
      if (state.kind !== 'signed-in') return;
      try {
        await backend.deleteAccount();
        // The account is gone — the state must be anonymous the moment the
        // backend confirms it, exactly as sign-out lands on its own success.
        emit({ kind: 'anonymous' });
      } catch {
        // A failed delete changes nothing: the user stays signed in, with the
        // reason next to the control that caused it. (A racing success — the
        // state already anonymous — changes nothing either; the failure is
        // not a reason to re-claim a deleted account.)
        emit(
          state.kind === 'signed-in'
            ? { ...state, notice: ACCOUNT_DELETE_FAILED }
            : state,
        );
      }
    },
    destroy: () => {
      subscription.unsubscribe();
    },
  };
}

/**
 * Whether two states describe the same situation — the dedupe key. The
 * notice rides on anonymous and signed-in only.
 */
function sameState(a: AuthState, b: AuthState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'anonymous' && b.kind === 'anonymous') return a.notice === b.notice;
  if (a.kind === 'signed-in' && b.kind === 'signed-in') {
    // The identity is the state; anything else about the user (a refreshed
    // display name) is not worth a repaint.
    return a.user.id === b.user.id && a.notice === b.notice;
  }
  return true;
}

const SIGN_IN_FAILED =
  "Google sign-in didn't work. You're still browsing anonymously — try again.";
const ACCOUNT_DELETE_FAILED = "Deleting your account didn't work. Try again.";
const SIGN_OUT_FAILED = "Signing out didn't work. Try again.";
const SIGN_OUT_PARTIAL =
  "You're signed out on this device, but the sign-out didn't reach the server.";
