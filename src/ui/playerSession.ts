import { useRef, useState } from 'react';
import type { AudioController } from '../audio';
import { createAutosave } from '../storage';
import type { Autosave, ProjectRecord, SaveStatus, Storage } from '../storage';

/** One open project session: the autosave and its controller. */
export interface PlayerSession {
  autosave: Autosave;
  controller: AudioController;
}

export interface PlayerSessionOptions {
  /** The open persistence layer; the shell opens it, this reads through it. */
  storage: Storage | null;
  /** Test seam: the audio controller each session runs on. */
  controllerFactory: () => AudioController;
  /**
   * The serialization lock shared with the workspace surface — open is one of
   * the one-at-a-time pipelines, so it must hold the same lock as rename,
   * delete, and create.
   */
  workingRef: { current: boolean };
  /** The workspace's failure channel — an open that cannot land must be heard. */
  onNotice: (notice: string | null) => void;
  /** Re-reads the workspace list — a stale-row open resyncs it. */
  refreshProjects: (source: Storage) => Promise<void>;
}

/**
 * The imperative open-session flow (T43): opening a stored project into the
 * player, closing it back to the workspace, and the race/guard bookkeeping
 * that keeps an in-flight open from landing on a tab the user navigated away
 * from. The shell owns storage, auth, and the workspace surface; this owns the
 * session itself — the state a later routing slice replaces with the URL.
 */
export function usePlayerSession({
  storage,
  controllerFactory,
  workingRef,
  onNotice,
  refreshProjects,
}: PlayerSessionOptions) {
  const [session, setSession] = useState<PlayerSession | null>(null);
  /** The row whose open is in flight, if any — the surface keeps rows inert then. */
  const [openingId, setOpeningId] = useState<string | null>(null);
  /** Bumped on mount and every tab switch; an in-flight open checks it before committing. */
  const openTokenRef = useRef(0);

  /**
   * Mount and every tab switch invalidate an in-flight open: the player must
   * never yank the user off a tab they navigated to while a read was running.
   */
  function invalidateOpen(): void {
    openTokenRef.current += 1;
  }

  /** The current open token — a link create captures it before its slow lookup. */
  function getOpenToken(): number {
    return openTokenRef.current;
  }

  /** Reopens a stored project straight into the player — no decode, no hash. */
  async function openProject(id: string): Promise<void> {
    if (storage === null || session !== null || workingRef.current) return;
    workingRef.current = true;
    setOpeningId(id);
    onNotice(null);
    const token = openTokenRef.current;
    try {
      const record = await storage.projects.get(id);
      if (record === undefined) {
        // A stale row (another tab deleted it) — quietly re-sync the list.
        await refreshProjects(storage);
        return;
      }
      if (token !== openTokenRef.current) {
        // The user switched tabs while the read ran — drop the open.
        return;
      }
      setSession({
        autosave: createAutosave(record, { save: (next) => storage.projects.save(next) }),
        controller: controllerFactory(),
      });
    } catch {
      onNotice("Couldn't open that project. Try again.");
    } finally {
      workingRef.current = false;
      setOpeningId(null);
    }
  }

  /** A link create that landed: commits the workspace's controller as a session. */
  function startSession(record: ProjectRecord, controller: AudioController): void {
    if (storage === null) {
      controller.destroy();
      return;
    }
    setSession({
      autosave: createAutosave(record, { save: (next) => storage.projects.save(next) }),
      controller,
    });
  }

  /**
   * Back from the player: settle pending writes, then report the exit state so
   * the shell can restore the workspace's save line. Settles before the player
   * unmounts, so its teardown flush is a no-op and the list read that follows
   * sees the final state. A failed final write must still be heard.
   */
  async function closeSession(): Promise<SaveStatus> {
    if (session === null || storage === null) return 'idle';
    let exitFailure: unknown = null;
    try {
      await session.autosave.flush();
    } catch (error) {
      exitFailure = error;
    }
    setSession(null);
    return exitFailure === null ? 'idle' : 'error';
  }

  return {
    session,
    openingId,
    openProject,
    startSession,
    closeSession,
    invalidateOpen,
    getOpenToken,
  };
}
