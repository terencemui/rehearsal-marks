import { describe, expect, it, vi } from 'vitest';
import { createAuthController, userFromUser } from './controller';
import type { SupabaseAuth, User } from './controller';

/**
 * The backend surface the controller drives, faked the way the audio tests
 * fake `window.YT`: the real supabase-js adapter (`supabase.ts`) is the only
 * module that touches the library, and everything above it is driven through
 * this minimal shape.
 */
function fakeBackend(overrides: Partial<SupabaseAuth> = {}): SupabaseAuth {
  return {
    getSession: vi.fn(async () => null),
    onAuthStateChange: vi.fn(() => ({ unsubscribe: vi.fn() })),
    signInWithGoogle: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    ...overrides,
  };
}

const USER: User = {
  id: 'user-1',
  name: 'Ava Cellist',
  email: 'ava@example.com',
};

describe('userFromUser', () => {
  it('takes the display name Google provides', () => {
    expect(
      userFromUser({
        id: 'u1',
        email: 'ava@example.com',
        user_metadata: { full_name: 'Ava Cellist' },
      }),
    ).toEqual({ id: 'u1', name: 'Ava Cellist', email: 'ava@example.com' });
  });

  it('falls back to the email when the provider sends no name', () => {
    expect(userFromUser({ id: 'u1', email: 'ava@example.com', user_metadata: {} })).toEqual({
      id: 'u1',
      name: 'ava@example.com',
      email: 'ava@example.com',
    });
  });

  it('tolerates a blank provider name', () => {
    expect(
      userFromUser({ id: 'u1', email: 'ava@example.com', user_metadata: { full_name: '  ' } }),
    ).toEqual({ id: 'u1', name: 'ava@example.com', email: 'ava@example.com' });
  });
});

describe('createAuthController', () => {
  it('starts anonymous when the backend has no session', () => {
    const controller = createAuthController(fakeBackend());

    expect(controller.getState()).toEqual({ kind: 'anonymous' });
  });

  it('restores a signed-in session the backend already holds', async () => {
    const backend = fakeBackend({ getSession: vi.fn(async () => USER) });
    const controller = createAuthController(backend);

    // The restore is async; the first snapshot is anonymous, the restore
    // lands as soon as getSession resolves.
    await vi.waitFor(() => {
      expect(controller.getState()).toEqual({ kind: 'signed-in', user: USER });
    });
  });

  it('lands signed-in when the backend publishes a session', async () => {
    const listeners = new Set<(user: User | null) => void>();
    const backend = fakeBackend({
      onAuthStateChange: vi.fn((listener) => {
        listeners.add(listener);
        return { unsubscribe: () => listeners.delete(listener) };
      }),
    });
    const controller = createAuthController(backend);
    const states: unknown[] = [];
    controller.subscribe((state) => states.push(state));

    for (const listener of listeners) listener(USER);

    await vi.waitFor(() => {
      expect(controller.getState()).toEqual({ kind: 'signed-in', user: USER });
      expect(states.at(-1)).toEqual({ kind: 'signed-in', user: USER });
    });
  });

  it('signs in with Google and lands signed-in when the flow completes', async () => {
    const listeners = new Set<(user: User | null) => void>();
    const signIn = vi.fn(async () => {
      // The redirect flow's return: the backend publishes the session
      // through onAuthStateChange, not through the signIn promise.
      for (const listener of listeners) listener(USER);
    });
    const backend = fakeBackend({
      signInWithGoogle: signIn,
      onAuthStateChange: vi.fn((listener) => {
        listeners.add(listener);
        return { unsubscribe: () => listeners.delete(listener) };
      }),
    });
    const controller = createAuthController(backend);

    await controller.signInWithGoogle();

    expect(signIn).toHaveBeenCalledOnce();
    expect(controller.getState()).toEqual({ kind: 'signed-in', user: USER });
  });

  it('a failed restore starts anonymous without rejecting', async () => {
    const backend = fakeBackend({ getSession: vi.fn(async () => { throw new Error('offline'); }) });
    const controller = createAuthController(backend);

    // The restore rejection is swallowed by the degradation path; the app
    // sees the safe default and no unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getState()).toEqual({ kind: 'anonymous' });
  });

  it('a failed sign-in attempt never wipes an existing session', async () => {
    const backend = fakeBackend({
      getSession: vi.fn(async () => USER),
      signInWithGoogle: vi.fn(async () => { throw new Error('nope'); }),
    });
    const controller = createAuthController(backend);
    await vi.waitFor(() => {
      expect(controller.getState().kind).toBe('signed-in');
    });

    await controller.signInWithGoogle();

    const state = controller.getState();
    expect(state.kind).toBe('signed-in');
    if (state.kind === 'signed-in') {
      expect(state.user).toEqual(USER);
      expect(state.notice).toMatch(/didn't work/i);
    }
  });

  it('degrades a failed sign-in to anonymous with an honest notice', async () => {
    const backend = fakeBackend({
      signInWithGoogle: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    const controller = createAuthController(backend);

    await controller.signInWithGoogle();

    const state = controller.getState();
    expect(state.kind).toBe('anonymous');
    if (state.kind === 'anonymous') {
      expect(state.notice).toMatch(/didn't work/i);
      expect(state.notice).toMatch(/anonymous/i);
    }
  });

  it('signs out back to anonymous', async () => {
    const listeners = new Set<(user: User | null) => void>();
    const backend = fakeBackend({
      getSession: vi.fn(async () => USER),
      signOut: vi.fn(async () => {
        for (const listener of listeners) listener(null);
      }),
      onAuthStateChange: vi.fn((listener) => {
        listeners.add(listener);
        return { unsubscribe: () => listeners.delete(listener) };
      }),
    });
    const controller = createAuthController(backend);
    await vi.waitFor(() => {
      expect(controller.getState().kind).toBe('signed-in');
    });

    await controller.signOut();

    expect(controller.getState()).toEqual({ kind: 'anonymous' });
  });

  it('a failed sign-out lands anonymous with a partial notice — the session was removed first', async () => {
    // supabase-js's real ordering: removeCurrentSession fires SIGNED_OUT,
    // then the API error surfaces. The state must reflect what the backend
    // actually did, not what the error alone suggests.
    const listeners = new Set<(user: User | null) => void>();
    const backend = fakeBackend({
      getSession: vi.fn(async () => USER),
      signOut: vi.fn(async () => {
        for (const listener of listeners) listener(null);
        throw new Error('nope');
      }),
      onAuthStateChange: vi.fn((listener) => {
        listeners.add(listener);
        return { unsubscribe: () => listeners.delete(listener) };
      }),
    });
    const controller = createAuthController(backend);
    await vi.waitFor(() => {
      expect(controller.getState().kind).toBe('signed-in');
    });

    await controller.signOut();

    const state = controller.getState();
    expect(state.kind).toBe('anonymous');
    if (state.kind === 'anonymous') {
      expect(state.notice).toMatch(/signed out on this device/i);
    }
  });

  it('a failed sign-out that changed nothing keeps the signed-in state with a notice', async () => {
    // The other real failure: the local session could not even be read, so
    // nothing was removed — the state stays signed-in and honest.
    const backend = fakeBackend({
      getSession: vi.fn(async () => USER),
      signOut: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    const controller = createAuthController(backend);
    await vi.waitFor(() => {
      expect(controller.getState().kind).toBe('signed-in');
    });

    await controller.signOut();

    const state = controller.getState();
    expect(state.kind).toBe('signed-in');
    if (state.kind === 'signed-in') {
      expect(state.notice).toMatch(/didn't work/i);
    }
  });

  it('deletes the signed-in account and returns to anonymous', async () => {
    const backend = fakeBackend({
      getSession: vi.fn(async () => USER),
      deleteAccount: vi.fn(async () => {}),
    });
    const controller = createAuthController(backend);
    await vi.waitFor(() => {
      expect(controller.getState().kind).toBe('signed-in');
    });

    await controller.deleteAccount();

    expect(backend.deleteAccount).toHaveBeenCalledOnce();
    expect(controller.getState()).toEqual({ kind: 'anonymous' });
  });

  it('a failed account deletion keeps the signed-in state with an honest notice', async () => {
    const backend = fakeBackend({
      getSession: vi.fn(async () => USER),
      deleteAccount: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    const controller = createAuthController(backend);
    await vi.waitFor(() => {
      expect(controller.getState().kind).toBe('signed-in');
    });

    await controller.deleteAccount();

    const state = controller.getState();
    expect(state.kind).toBe('signed-in');
    if (state.kind === 'signed-in') {
      expect(state.user).toEqual(USER);
      expect(state.notice).toMatch(/didn't work/i);
    }
  });

  it('a delete while anonymous is a no-op — nothing to delete', async () => {
    const deleteAccount = vi.fn(async () => {});
    const backend = fakeBackend({ deleteAccount });
    const controller = createAuthController(backend);

    await controller.deleteAccount();

    expect(deleteAccount).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({ kind: 'anonymous' });
  });

  it('stops publishing after destroy', async () => {
    const listeners = new Set<(user: User | null) => void>();
    const backend = fakeBackend({
      onAuthStateChange: vi.fn((listener) => {
        listeners.add(listener);
        return { unsubscribe: () => listeners.delete(listener) };
      }),
    });
    const controller = createAuthController(backend);
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.destroy();

    for (const handler of listeners) handler(USER);

    expect(listener).not.toHaveBeenCalled();
  });
});
