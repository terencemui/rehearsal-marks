import type { ServerProject, ProjectUpdate } from './types';

/**
 * The save-state line's vocabulary: `dirty` and `saving` both read as
 * "Saving…" in the UI; `error` is the one failure state the user must see.
 * There is no user-facing save anywhere — `flush` settles pending writes on
 * session exit, page teardown, and the error card's retry.
 */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Debounced autosave over one server project: every mutation is applied to
 * the in-memory record immediately and written ~500ms after the last one.
 * Writes that overlap a mutation re-save the newer state; a failed write
 * parks the controller in `error` until the next mutation retries. The
 * server, not this controller, owns the project's `updated_at` stamp, so a
 * mutation never rewrites it locally.
 */
export interface Autosave {
  /** The current in-memory record — the pending state. */
  get(): ServerProject;
  /**
   * Applies a mutation to the current record and schedules a save. A mutation
   * that changes nothing the server can persist — the player's in-memory
   * duration stamp — and has nothing pending does not dirty the controller.
   */
  mutate(fn: (current: ServerProject) => ServerProject): ServerProject;
  status(): SaveStatus;
  subscribe(listener: (status: SaveStatus) => void): () => void;
  /** The failure behind an `error` status, if any. */
  error(): Error | null;
  /**
   * Cancels the debounce and writes everything pending now. Resolves once
   * the record is settled, rejects with the failure if the write fails.
   */
  flush(): Promise<void>;
  /** Cancels the pending debounce and stops notifying; in-flight writes finish. */
  dispose(): void;
}

export interface AutosaveOptions {
  save: (record: ServerProject) => Promise<void>;
  /** Debounce window; defaults to the spec's ~500ms. */
  debounceMs?: number;
}

export function createAutosave(
  initial: ServerProject,
  { save, debounceMs = 500 }: AutosaveOptions,
): Autosave {
  let current = initial;
  let currentVersion = 0;
  let savedVersion = 0;
  /** The projection the server last confirmed holding — the skip's comparison. */
  let lastSavedProjection = persistedProjection(initial);
  let status: SaveStatus = 'idle';
  let lastError: Error | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(status: SaveStatus) => void>();

  function setStatus(next: SaveStatus): void {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener(next);
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      // The timer path retries on success only: a failed write stays failed
      // until the next mutation, so a failing store is never hammered.
      void performSave()
        .then(() => {
          if (currentVersion > savedVersion) schedule();
        })
        .catch(() => {});
    }, debounceMs);
  }

  function clearPendingTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  /** Writes the current record once; never schedules, never swallows errors. */
  async function performSave(): Promise<void> {
    const version = currentVersion;
    setStatus('saving');
    try {
      await save(current);
      savedVersion = version;
      // The server now holds what was just saved — whether the wire wrote it
      // or skipped it as already-persisted, the known state has caught up.
      lastSavedProjection = persistedProjection(current);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      setStatus('error');
      throw lastError;
    }
    setStatus(currentVersion > savedVersion ? 'dirty' : 'saved');
  }

  return {
    get: () => current,

    mutate(fn) {
      current = fn(current);
      // A mutation the server cannot persist — the player's in-memory duration
      // stamp, or an edit session that returned to its loaded state — must not
      // dirty the controller when nothing is pending: dirtying would flash
      // Saving…→Saved around a write the wire would skip. The exception is a
      // pending or in-flight save (currentVersion > savedVersion): there the
      // record may have diverged mid-write, and the version bookkeeping must
      // stay ahead so the pending save's continuation re-runs and reconciles.
      if (
        currentVersion === savedVersion &&
        sameProjection(persistedProjection(current), lastSavedProjection)
      ) {
        return current;
      }
      currentVersion += 1;
      setStatus('dirty');
      schedule();
      return current;
    },

    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    error: () => lastError,

    async flush() {
      clearPendingTimer();
      while (currentVersion > savedVersion) {
        await performSave();
      }
    },

    dispose() {
      clearPendingTimer();
      listeners.clear();
    },
  };
}

/**
 * The fields an owner may persist to the server — exactly the update grant
 * the T49 migration gives the client. Everything else the record carries
 * (duration, the recording identity, the review state, stamps) is not
 * client-writable, so it is deliberately absent from a save.
 */
function persistedProjection(project: ServerProject): ProjectUpdate {
  return {
    name: project.name,
    markers: project.markers,
    movements: project.movements,
  };
}

/**
 * Whether two persisted projections carry the same content — markers and
 * movements are the two JSON documents, compared structurally (their fields
 * are plain JSON, so a string compare is exact and order-stable for the
 * shapes the domain builds).
 */
function sameProjection(a: ProjectUpdate, b: ProjectUpdate): boolean {
  return (
    a.name === b.name &&
    JSON.stringify(a.markers) === JSON.stringify(b.markers) &&
    JSON.stringify(a.movements) === JSON.stringify(b.movements)
  );
}

export interface ProjectSaveApi {
  saveProject(id: string, update: ProjectUpdate): Promise<void>;
}

/**
 * The autosave's save callback for a server project — the wire that decides
 * whether a mutation actually reaches the server. The player's one in-session
 * mutation, stamping the embed-reported duration, changes nothing the server
 * can persist; PATCHing anyway would hit the moderation gate's re-review
 * trigger (T49) and silently return a published public project to pending for
 * a change no one made. So a save that leaves the persisted fields unchanged
 * is skipped, and the last-known server state advances only on success — a
 * failed write stays different from the current record, so the next mutation
 * (or the error card's retry) re-saves it.
 */
export function createProjectSave(
  api: ProjectSaveApi,
  initial: ServerProject,
): (record: ServerProject) => Promise<void> {
  let lastPersisted = persistedProjection(initial);
  return async (next: ServerProject): Promise<void> => {
    const projection = persistedProjection(next);
    if (sameProjection(projection, lastPersisted)) return;
    await api.saveProject(next.id, projection);
    lastPersisted = projection;
  };
}
