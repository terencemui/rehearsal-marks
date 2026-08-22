import { translateError } from './errors';
import type { ProjectRecord } from './records';

/**
 * The save-state line's vocabulary: `dirty` and `saving` both read as
 * "Saving…" in the UI; `error` is the one failure state the user must see.
 * There is no user-facing save anywhere — `flush` settles pending writes on
 * session exit, page teardown, and in tests.
 */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Debounced autosave over one project record: every mutation is applied to
 * the in-memory record immediately, stamped with `updatedAt`, and written
 * ~500ms after the last one. Writes that overlap a mutation re-save the newer
 * state; a failed write parks the controller in `error` until the next
 * mutation retries.
 */
export interface Autosave {
  /** The current in-memory record — the pending state. */
  get(): ProjectRecord;
  /** Applies a mutation to the current record and schedules a save. */
  mutate(fn: (current: ProjectRecord) => ProjectRecord): ProjectRecord;
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
  save: (record: ProjectRecord) => Promise<void>;
  /** Debounce window; defaults to the spec's ~500ms. */
  debounceMs?: number;
}

export function createAutosave(
  initial: ProjectRecord,
  { save, debounceMs = 500 }: AutosaveOptions,
): Autosave {
  let current = initial;
  let currentVersion = 0;
  let savedVersion = 0;
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
    } catch (error) {
      lastError = translateError(error);
      setStatus('error');
      throw lastError;
    }
    setStatus(currentVersion > savedVersion ? 'dirty' : 'saved');
  }

  return {
    get: () => current,

    mutate(fn) {
      current = { ...fn(current), updatedAt: Date.now() };
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
