import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { AudioController } from '../audio';
import { defaultPlayerMode } from '../storage';
import type { Autosave, ProjectRecord } from '../storage';
import type { PublicProject, ProjectsApi } from '../projects';
import { NotFoundPage } from './NotFoundPage';
import { Player } from './Player';
import './public-project.css';

export interface PublicProjectViewProps {
  /** The anonymous read surface — the one way a public project is opened. */
  api: ProjectsApi;
  /** Test seam: the audio controller the read-only session runs on. */
  controllerFactory: () => AudioController;
}

/**
 * A public project opened read-only (T50): `/gallery/:id`. The row is read
 * through the anonymous `ProjectsApi`, mapped into the player's record shape,
 * and rendered by the same playback-only `Player` an editing visit uses — but
 * as a read-only session: no duration stamp, no unmount flush, no edit or
 * copy affordance anywhere. A project that isn't visible (not published, not
 * public, missing) is the not-found page with the way back to the gallery; a
 * read that fails is its own error surface — "not found" would misdescribe a
 * backend that was merely unreachable.
 *
 * The session is built per id in the route-as-session pattern (T45): the URL
 * is the source of truth, the player is keyed by the id so a swap never
 * carries another project's player state, and teardown releases the session.
 */
export function PublicProjectView({ api, controllerFactory }: PublicProjectViewProps) {
  const { id } = useParams();
  /** The read-only session — the player's autosave and controller, once the row lands. */
  const [session, setSession] = useState<{ autosave: Autosave; controller: AudioController } | null>(
    null,
  );
  const [state, setState] = useState<'loading' | 'not-found' | 'error' | 'ready'>('loading');
  /**
   * The routed id as of the latest render. A read's resolution is compared
   * against this, not just the effect's `cancelled` flag: the cleanup that
   * flips `cancelled` runs in React's deferred passive-effect flush, so a
   * slow read for the previous id can resolve in the microtask window
   * between the commit of the new id and that flush — and must not build its
   * session under the new URL.
   */
  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    if (id === undefined) {
      setState('not-found');
      return;
    }
    let cancelled = false;
    let built: { autosave: Autosave; controller: AudioController } | null = null;
    // A new id is a fresh view: drop the old session, then read the row.
    setSession(null);
    setState('loading');
    void api
      .getPublicProject(id)
      .then((project) => {
        // The read belongs to this id still? A stale read must never mount
        // its player (or its not-found) under a URL it no longer names.
        if (cancelled || idRef.current !== id) return;
        if (project === null) {
          setState('not-found');
          return;
        }
        const autosave = readOnlyAutosave(projectRecordFrom(project));
        const controller = controllerFactory();
        built = { autosave, controller };
        setSession(built);
        setState('ready');
      })
      .catch(() => {
        if (cancelled || idRef.current !== id) return;
        setState('error');
      });
    return () => {
      cancelled = true;
      // The player's own teardown destroys its controller and disposes its
      // autosave (the read-only path skips the flush); releasing here is the
      // same safety net the project page keeps.
      built?.controller.destroy();
      built?.autosave.dispose();
    };
    // The session is rebuilt only when the routed id, the api, or the seam
    // changes — never on the shell's incidental re-renders.
  }, [id, api, controllerFactory]);

  if (state === 'not-found' || id === undefined) {
    return <NotFoundPage backTo="/" backLabel="Back to Gallery" />;
  }
  if (state === 'error') {
    return (
      <section className="public-project-error" role="alert">
        <h2>Couldn’t open that project</h2>
        <p className="public-project-error-copy">
          The gallery couldn’t be reached. Check your connection and try again.
        </p>
        <Link to="/" className="public-project-back">
          Back to Gallery
        </Link>
      </section>
    );
  }
  // The row read is in flight — the view paints nothing until it lands.
  if (session === null) return null;

  return (
    <div className="public-project">
      <Link to="/" className="public-project-back">
        ← Back to Gallery
      </Link>
      {/* Keyed by the session's own project, not the routed id: during a
          gallery-id swap the old session is still in state, and a player
          keyed by the new id would mount on the old session's record. The
          session's identity keeps the player on the project it belongs to
          until the next read replaces it. */}
      <Player
        key={session.autosave.get().id}
        readOnly
        autosave={session.autosave}
        controller={session.controller}
      />
    </div>
  );
}

/**
 * A public project mapped into the player's record shape. The read-only
 * session's posture follows the same rule an editing project's first open
 * does: a project with marks opens in Playback, and the player is
 * playback-only regardless — the mode matters only where the editing tools
 * live, which a read-only visit never reaches.
 */
function projectRecordFrom(project: PublicProject): ProjectRecord {
  return {
    id: project.id,
    name: project.name,
    // A published row has no update story a viewer needs; its creation stamp
    // is the honest `updatedAt` for a session that will never write.
    createdAt: project.createdAt,
    updatedAt: project.createdAt,
    videoId: project.videoId,
    duration: project.duration,
    markers: project.markers,
    movements: project.movements,
    playerMode: defaultPlayerMode(project.markerCount),
  };
}

/**
 * The read-only session's autosave: a fixed record with every write surface a
 * no-op. The player reads `get` and, in a read-only session, never mutates or
 * flushes — the guards in Player make these unreachable, and the shape keeps
 * the read-only view satisfying the same `Autosave` interface the editing
 * pages do. A mutation is refused by returning the record unchanged, exactly
 * as `get` reports it: nothing about a stranger's project may be changed, so
 * the session never diverges from what it holds.
 */
function readOnlyAutosave(record: ProjectRecord): Autosave {
  return {
    get: () => record,
    mutate: () => record,
    status: () => 'idle',
    subscribe: () => () => {},
    error: () => null,
    flush: async () => {},
    dispose: () => {},
  };
}
