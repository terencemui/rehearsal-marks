import { useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import type { AudioController } from '../audio';
import { createAutosave } from '../storage';
import type { Autosave, ProjectRecord, SaveStatus, Storage } from '../storage';
import { Player } from './Player';

/** One project page session: the autosave over the record and its controller. */
interface ProjectSession {
  /** The project id this session was built for — keys the Player by project. */
  projectId: string;
  autosave: Autosave;
  controller: AudioController;
}

export interface ProjectPageProps {
  /** The open persistence layer — the record is read and written through it. */
  storage: Storage;
  /** Test seam: the audio controller each page session runs on. */
  controllerFactory: () => AudioController;
  /**
   * The exit channel: reports the final flush's result when the page is torn
   * down (browser Back, a navbar link, a swap to another project page), so
   * the shell can restore the workspace's save line and re-read the list.
   */
  onExitStatus: (status: SaveStatus) => void;
  /** The workspace's failure channel — a page whose record cannot be read must be heard. */
  onNotice: (notice: string | null) => void;
}

/**
 * The project page (T45): route-as-session. `/projects/:id` reads the record
 * from storage, builds the autosave and the audio controller, and renders the
 * player — the URL is the source of truth, so a refresh restores the same
 * player and browser Back is the exit. There is no App-level open session
 * anymore: each page mounts its own and tears it down on unmount (flushing
 * the session's one write, the measured duration, and reporting the result),
 * so navigating away — Back, a navbar link, or a direct swap to another
 * project page — closes it cleanly and the next page opens its own.
 *
 * The explicit not-found page is the next slice (T47); until then a record
 * that no longer exists — or a read that fails — lands quietly back on the
 * Projects home, the same way any unknown path does.
 */
export function ProjectPage({ storage, controllerFactory, onExitStatus, onNotice }: ProjectPageProps) {
  const { id } = useParams();
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [missing, setMissing] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  // The callbacks are read from refs so the session-build effect's deps stay
  // the stable inputs (the id, the storage, the seam) — the same mount-only
  // rule the shell applies to its inline controller factories.
  const onExitStatusRef = useRef(onExitStatus);
  onExitStatusRef.current = onExitStatus;
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;

  /**
   * Page teardown (the authoritative exit): settle the pending write and
   * report the result, then release. The player's own safety-net teardown
   * runs first (child cleanups), and its flush typically already wrote — so
   * this flush is the no-op; the report is the point, and it lands after the
   * write, before the workspace re-reads the list.
   */
  function tearDown({ autosave, controller }: ProjectSession): void {
    controller.destroy();
    void autosave
      .flush()
      .then(() => onExitStatusRef.current('idle'))
      .catch(() => onExitStatusRef.current('error'))
      .finally(() => autosave.dispose());
  }

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    let built: ProjectSession | null = null;
    // A new id is a fresh page: drop the old session, then read the record.
    setSession(null);
    setMissing(false);
    setReadFailed(false);
    void storage.projects
      .get(id)
      .then((record) => {
        if (cancelled) return;
        if (record === undefined) {
          // A stale row (another tab deleted it) — the not-found page is the
          // next slice (T47); for now this lands on the Projects home.
          setMissing(true);
          return;
        }
        built = {
          projectId: id,
          autosave: createAutosave(record, {
            save: (next: ProjectRecord) => storage.projects.save(next),
          }),
          controller: controllerFactory(),
        };
        setSession(built);
      })
      .catch(() => {
        if (cancelled) return;
        onNoticeRef.current("Couldn't open that project. Try again.");
        setReadFailed(true);
      });
    return () => {
      cancelled = true;
      if (built !== null) tearDown(built);
    };
    // The session is rebuilt only when the routed id, the storage, or the
    // seam changes — never on the shell's incidental re-renders.
  }, [id, storage, controllerFactory]);

  if (id === undefined || missing || readFailed) {
    return <Navigate to="/" replace />;
  }
  if (session === null) {
    // The record read is in flight — the page paints nothing until it lands.
    return null;
  }

  // Keyed by project: a fresh recording must start a fresh player — the zoom
  // level, marker state, and selection are per-session, never carried across
  // recordings.
  return (
    <Player
      key={session.projectId}
      autosave={session.autosave}
      controller={session.controller}
    />
  );
}
