import { useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import type { AudioController } from '../audio';
import { createAutosave } from '../storage';
import type { Autosave, ProjectRecord, SaveStatus, Storage } from '../storage';
import { NotFoundPage } from './NotFoundPage';
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
 * A project id that names no record shows the not-found page (T47) instead of
 * a blank or broken surface, with the way back to the Projects list in the
 * page itself; a read that fails (a transient storage error, not a missing
 * row) keeps landing on the Projects home with the failure on the workspace's
 * notice line, since "not found" would misdescribe a store that was merely
 * unreachable.
 */
export function ProjectPage({ storage, controllerFactory, onExitStatus, onNotice }: ProjectPageProps) {
  const { id } = useParams();
  const [session, setSession] = useState<ProjectSession | null>(null);
  /**
   * The id whose record turned out missing — null until one does. Holding the
   * id, not a boolean, is deliberate: the flag must be compared against the
   * routed id (`missingId === id`), so a stale value from a previous id can
   * never paint the not-found page on a live project's URL mid-navigation.
   */
  const [missingId, setMissingId] = useState<string | null>(null);
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
    setMissingId(null);
    setReadFailed(false);
    void storage.projects
      .get(id)
      .then((record) => {
        if (cancelled) return;
        if (record === undefined) {
          // A stale row (another tab deleted it) — the not-found page.
          setMissingId(id);
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

  // A record that no longer exists is its own surface now (T47): the
  // not-found page, with the way back in the page itself. The check compares
  // the flagged id to the routed id, so a stale flag from a previous id can
  // never paint this page on a live project's URL. The silent bounce to `/`
  // is left for the impossible no-id case and for a read failure — a
  // transient storage error is not "not found", so the notice says what went
  // wrong and home is the honest landing.
  if (missingId === id) {
    return <NotFoundPage />;
  }
  if (id === undefined || readFailed) {
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
