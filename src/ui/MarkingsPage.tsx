import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Navigate, useParams } from 'react-router';
import type { AudioController } from '../audio';
import { deriveLabels, practiceReadout } from '../domain';
import { createAutosave, createProjectSave } from '../projects/autosave';
import type { Autosave } from '../projects/autosave';
import type { ProjectsApi } from '../projects/api';
import { MarkersPanel } from './MarkersPanel';
import { NotFoundPage } from './NotFoundPage';
import { RecordingSurface } from './RecordingSurface';
import { usePlayerKeys } from './playerKeys';
import { useRecordingSession } from './useRecordingSession';
import './markings.css';

/** One markings page session: the autosave over the loaded project and its controller. */
interface MarkingsSession {
  /** The project id this session was built for — keys the surface by project. */
  projectId: string;
  autosave: Autosave;
  controller: AudioController;
}

export interface MarkingsPageProps {
  /** The server-project surface — the record is read and written through it. */
  projectsApi: ProjectsApi;
  /** Test seam: the audio controller each page session runs on. */
  controllerFactory: () => AudioController;
  /** The workspace's failure channel — a page whose record cannot be read must be heard. */
  onNotice: (notice: string | null) => void;
}

/**
 * The markings page (T55): `/projects/:id/markings`, where a project's owner
 * authors what the recording carries (ADR-0007). It is a routed session built
 * like the project page — it reads its project from the server, builds the
 * session over it, owns its own audio controller, and tears the whole thing
 * down on unmount — and it renders the same `RecordingSurface` the practice
 * surface does, so the recording plays here as it does there.
 *
 * Deliberately not part of the practice surface (ADR-0007): that surface stays
 * playback-only and carries no editing affordance, only the markers panel's
 * quiet way through. This page is where a project stops being empty.
 *
 * A project id that names no row shows the not-found page (T47) instead of a
 * blank or broken surface, with the way back to the Projects list in the page
 * itself; a read that fails (a transient server error, not a missing row)
 * keeps landing on the workspace home with the failure on the workspace's
 * notice line, since "not found" would misdescribe a store that was merely
 * unreachable.
 */
export function MarkingsPage({ projectsApi, controllerFactory, onNotice }: MarkingsPageProps) {
  const { id } = useParams();
  const [session, setSession] = useState<MarkingsSession | null>(null);
  /**
   * The id whose record turned out missing — null until one does. Holding the
   * id, not a boolean, is deliberate: the flag must be compared against the
   * routed id (`missingId === id`), so a stale value from a previous id can
   * never paint the not-found page on a live project's URL mid-navigation.
   */
  const [missingId, setMissingId] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  // The notice callback is read from a ref so the session-build effect's deps
  // stay the stable inputs (the id, the api, the seam) — the same mount-only
  // rule the shell applies to its inline controller factories.
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;
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
    if (id === undefined) return;
    let cancelled = false;
    let built: MarkingsSession | null = null;
    // A new id is a fresh page: drop the old session, then read the record.
    setSession(null);
    setMissingId(null);
    setReadFailed(false);
    void projectsApi
      .getProject(id)
      .then((project) => {
        // The read belongs to this id still? A stale read must never mount its
        // session (or its not-found) under a URL it no longer names.
        if (cancelled || idRef.current !== id) return;
        if (project === null) {
          // A row that no longer exists — the not-found page.
          setMissingId(id);
          return;
        }
        built = {
          projectId: id,
          // The same wire the project page saves through: a write reaches the
          // server only when a persisted field has actually changed, so a page
          // that edits nothing (T55) sends nothing — the recording load's
          // duration stamp is not a persisted field.
          autosave: createAutosave(project, { save: createProjectSave(projectsApi, project) }),
          controller: controllerFactory(),
        };
        setSession(built);
      })
      .catch(() => {
        if (cancelled || idRef.current !== id) return;
        onNoticeRef.current("Couldn't open that project. Try again.");
        setReadFailed(true);
      });
    return () => {
      cancelled = true;
      // The surface's own session teardown runs first (child cleanups), so
      // releasing here is the safety net beneath it.
      built?.controller.destroy();
      built?.autosave.dispose();
    };
    // The session is rebuilt only when the routed id, the api, or the seam
    // changes — never on the shell's incidental re-renders.
  }, [id, projectsApi, controllerFactory]);

  // A record that no longer exists is its own surface: the not-found page,
  // with the way back in the page itself. The silent bounce to the workspace
  // is left for the impossible no-id case and for a read failure — a transient
  // server error is not "not found", so the notice says what went wrong and
  // the workspace home is the honest landing.
  if (missingId === id) {
    return <NotFoundPage />;
  }
  if (id === undefined || readFailed) {
    return <Navigate to="/projects" replace />;
  }
  if (session === null) {
    // The record read is in flight — the page paints nothing until it lands.
    return null;
  }

  // Keyed by project: a fresh recording must start a fresh session — the
  // loaded playback and everything the page holds about it are per-session,
  // never carried across recordings.
  return (
    <MarkingsSurface
      key={session.projectId}
      autosave={session.autosave}
      controller={session.controller}
    />
  );
}

interface MarkingsSurfaceProps {
  autosave: Autosave;
  controller: AudioController;
}

/**
 * The page's one session, mounted once its record has landed: the recording
 * plays through the shared surface, and the marks the project already carries
 * sit beside it. Split out from the page so the session hooks run in a
 * component keyed by project — the page itself mounts and unmounts around the
 * read, which hooks cannot follow.
 */
function MarkingsSurface({ autosave, controller }: MarkingsSurfaceProps) {
  const session = useRecordingSession({ autosave, controller });
  const { record } = session;
  const playback = useSyncExternalStore(controller.subscribe, controller.getPlaybackState);

  // Labels derive from the recording's movements (ADR-0005): they restart at A
  // within each movement, so a movement's letters read the same whether the
  // piece is one movement or four. The derived label is what the page shows —
  // it is never edited, only recomputed.
  const labeled = useMemo(
    () => deriveLabels(record.markers, record.movements),
    [record.markers, record.movements],
  );
  const duration = playback.duration > 0 ? playback.duration : record.duration;

  // The playback keys shared with the practice surface (T55): play and pause,
  // seek, and walk the marks — inert until the load settles.
  usePlayerKeys({ controller, markers: labeled, settled: session.settled });

  const elapsed = Math.min(playback.currentTime, duration);
  const activeMarker = practiceReadout(labeled, elapsed, duration).passed;

  return (
    <RecordingSurface
      controller={controller}
      record={record}
      videoRef={session.containerRef}
      settled={session.settled}
      loadFailed={session.loadFailed}
      onRetryLoad={session.retryLoad}
      side={(markersMaxHeight) =>
        labeled.length === 0 ? (
          <MarkingsEmptyState />
        ) : (
          // The same panel the practice surface shows: the same rows, the same
          // derived labels, the same movement grouping — and the rows jump the
          // recording when clicked. What changes on this page is only what can
          // be done to them (T56).
          <MarkersPanel
            markers={labeled}
            movements={record.movements}
            duration={duration}
            activeId={activeMarker?.id ?? null}
            onSeek={(marker) => controller.seek(marker.time)}
            onSeekMovement={(movement) => controller.seek(movement.start)}
            maxHeight={markersMaxHeight ?? undefined}
          />
        )
      }
    />
  );
}

/**
 * The empty first paint (T55): a project with nothing marked on it says the one
 * thing that fills it, rather than showing a blank column beside a recording.
 * The recording is playable either way — that is what makes the first mark
 * placeable at all.
 */
function MarkingsEmptyState() {
  return (
    <section className="markings-empty" aria-label="Markings">
      <h2 className="player-markers-heading">Markers</h2>
      <p className="markings-empty-copy">
        Nothing marked yet. Play the recording and press <kbd>M</kbd> where a landmark goes by —
        the mark lands at the playhead.
      </p>
    </section>
  );
}
