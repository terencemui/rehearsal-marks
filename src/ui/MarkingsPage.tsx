import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Navigate, useParams } from 'react-router';
import type { AudioController } from '../audio';
import {
  addMarker,
  createMarker,
  errorMessage,
  formatTime,
  moveMarker,
  nudgedTime,
  parseTime,
  removeMarker,
  setAliases,
} from '../domain';
import type { LabeledMarker } from '../domain';
import { createAutosave, createProjectSave } from '../projects/autosave';
import type { Autosave } from '../projects/autosave';
import type { ProjectsApi } from '../projects/api';
import { requiresExplicitSave } from '../projects/types';
import { AddMarkerControl, MarkersHead, MarkersPanel } from './MarkersPanel';
import type { AddMarkerControlProps, MarkersAuthoring } from './MarkersPanel';
import { NotFoundPage } from './NotFoundPage';
import { RecordingSurface } from './RecordingSurface';
import { SaveStatusLine } from './SaveStatusLine';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { useLabeledPlayback } from './useLabeledPlayback';
import { usePlayerKeys } from './playerKeys';
import { useRecordingSession } from './useRecordingSession';
import { useUnsavedChanges } from './useUnsavedChanges';
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
 * quiet way through. This page is where a project stops being empty — a mark is
 * placed with `M` at the playhead, named with the student's own word for it, and
 * removed if it was a mistake (T56) — and where a mark that landed wrong is put
 * right: selected, nudged by a tenth of a second or a whole one, or given an
 * exact time typed from a score (T57). A mark pressed at the moment a landmark
 * is heard always lands late by human reaction time, so a page that can place
 * marks and not correct them is a page that can only be wrong.
 *
 * Saving follows what the project is (T56, ADR-0007). A private project, or a
 * public one still awaiting review, writes itself as the student works; a
 * published or rejected one writes only when the owner commits, because a write
 * returns it to review and takes it off the public gallery — a consequence the
 * page names before the Save control, not after it.
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
          autosave: createAutosave(project, {
            // The same wire the project page saves through: a write reaches the
            // server only when a persisted field has actually changed, so a
            // visit that edits nothing sends nothing — the recording load's
            // duration stamp is not a persisted field.
            save: createProjectSave(projectsApi, project),
            // The save-mode rule (T56, ADR-0007), decided once from the project
            // as the server returned it: a published or rejected public project
            // is one a write disturbs, so it waits for a deliberate commit;
            // everything else — private, or public and still in the queue —
            // writes itself as the student works. The mode is fixed for the
            // session: the client never learns the review state a save left the
            // server holding (a demotion is the server's fact, surfaced on the
            // status line), and re-deciding mid-session would swap the save
            // model out from under work already in progress.
            mode: requiresExplicitSave(project) ? 'manual' : 'auto',
          }),
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
 * plays through the shared surface, and the marks the project carries sit
 * beside it, where they can be placed, named, corrected and removed (T56, T57).
 * Split out from the page so the session hooks run in a component keyed by
 * project — the page itself mounts and unmounts around the read, which hooks
 * cannot follow.
 */
function MarkingsSurface({ autosave, controller }: MarkingsSurfaceProps) {
  const session = useRecordingSession({ autosave, controller });
  const { record, mutate } = session;
  // The playback view of the recording — the shared derivation (T55), the same
  // one the practice surface reads.
  const { labeled, duration, activeMarker } = useLabeledPlayback({ controller, record });
  /**
   * The alias the domain refused, and where it was refused. Held by the row
   * that caused it — an alias rule broken on one mark says nothing about the
   * next — and cleared by the next attempt on that mark, whatever it says.
   */
  const [aliasError, setAliasError] = useState<{ markerId: string; message: string } | null>(null);
  /**
   * The time the domain refused, and where — the twin of `aliasError`, held
   * separately because the two are independent facts about a mark: a time
   * refused says nothing about the alias, and one field's success is no answer
   * to the other's complaint.
   */
  const [timeError, setTimeError] = useState<{ markerId: string; message: string } | null>(null);
  /**
   * The mark being corrected (T57), by id. Selection is the page's own state
   * and deliberately does not follow the playhead: the row holding the playhead
   * moves on its own as the recording plays, and a correction aimed at whatever
   * a student happened to be passing would be a correction aimed at nothing.
   * It is held by id, so a mark that a correction re-sorts keeps its selection
   * — and its label, which is a rank and follows the mark into its new place.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const status = useSyncExternalStore(autosave.subscribe, autosave.status);
  /** The selected mark itself, as the surface is rendering it. */
  const selected = labeled.find((marker) => marker.id === selectedId) ?? null;

  // The mode the session was built in, read off the autosave that owns it: this
  // page shows a Save control exactly when the project waits for one.
  const needsCommit = autosave.mode === 'manual';
  /**
   * Whether the server holds something other than what the record holds —
   * `dirty` (waiting), `saving` (asked for, unanswered) and `error` (asked for,
   * refused) alike. The failure counts because the record is still pending;
   * the in-flight write counts because the commit has been *asked for*, not
   * made, and a rejection arriving after the page is gone would come back to a
   * disposed autosave with nothing left to retry it.
   */
  const uncommitted = status === 'dirty' || status === 'saving' || status === 'error';
  /**
   * Whether there is a commit for the Save control to make — `uncommitted` less
   * the write already in flight. Save is how a waiting record is written and
   * how a refused one is retried; offering it mid-write would only start a
   * second.
   */
  const canCommit = status === 'dirty' || status === 'error';
  /**
   * Whether the page has work only its owner can settle (T60) — a `manual`
   * record with something the server has not confirmed. An `auto` record never
   * blocks, because a write is already scheduled for it: the page is not what
   * settles that work, so leaving is not a decision to put to its owner. (An
   * in-app exit does settle it — the session's teardown flushes — but closing
   * the tab runs no teardown at all, and the debounce window is the autosave's
   * own exposure rather than something this question reaches.) Only a `manual`
   * record has nothing that will write it, which is why this is narrower than
   * `uncommitted` and is named for what leaving would cost rather than for
   * what the record holds.
   */
  const hasWorkToLose = needsCommit && uncommitted;
  const blocker = useUnsavedChanges(hasWorkToLose);

  /**
   * Places a mark where the recording is — the playhead the student is hearing,
   * never zero and never a guess. The domain derives its label and sorts it into
   * place, so a mark placed out of order still lands in order.
   */
  const addAtPlayhead = useCallback((): void => {
    mutate((current) => ({
      ...current,
      markers: addMarker(current.markers, createMarker(controller.getCurrentTime())),
    }));
  }, [controller, mutate]);

  /**
   * Picks a mark out as the one being corrected (T57). A pointer clicks its row
   * and the keyboard walks to it with ↑/↓; both arrive here, so the two ways of
   * choosing are one piece of state.
   */
  const select = useCallback((marker: LabeledMarker): void => {
    setSelectedId(marker.id);
  }, []);

  /**
   * Moves a mark by `delta` seconds — the one correction `[`, `]` and the
   * block's two controls all make. Nothing here touches the controller: a
   * correction moves the mark, and the recording the student is hearing carries
   * on exactly as it was, playing or paused.
   */
  const nudge = useCallback(
    (marker: LabeledMarker, delta: number): void => {
      mutate((current) => {
        // The mark's time is read from the record being written, not from the
        // render this gesture started in, so a nudge always moves the mark from
        // where it actually is. A mark that is no longer there corrects nothing
        // rather than throwing — its selection went with it.
        const held = current.markers.find((m) => m.id === marker.id);
        if (held === undefined) return current;
        return {
          ...current,
          markers: moveMarker(current.markers, marker.id, nudgedTime(held.time, delta)),
        };
      });
      // A nudge re-seeds the field with the time the mark now holds, so a time
      // refused a moment ago is a complaint about text that is no longer in the
      // field — it goes with the text, exactly as applying a typed time clears
      // it. Left standing, it would sit under a valid time contradicting it, and
      // be announced again when the mark was next selected. The alias is a
      // different fact about the mark and keeps its own.
      setTimeError((current) => (current?.markerId === marker.id ? null : current));
    },
    [mutate],
  );

  /**
   * Applies a time typed into the correction field. The domain parses it and is
   * the one that decides: a time it refuses throws with its own guidance, and
   * the mark is not moved — the refused text is never stored, and never left in
   * the field as if it were.
   */
  const setTime = useCallback(
    (marker: LabeledMarker, text: string): string => {
      try {
        const time = parseTime(text);
        mutate((current) => ({
          ...current,
          markers: moveMarker(current.markers, marker.id, time),
        }));
        // Cleared for this mark only: a time refused on one mark is that mark's
        // complaint, and another's acceptance says nothing about it.
        setTimeError((current) => (current?.markerId === marker.id ? null : current));
        return formatTime(time, duration);
      } catch (error) {
        setTimeError({ markerId: marker.id, message: errorMessage(error) });
        // The refused text is not what the mark holds; the field goes back to
        // the exact time it does hold.
        return formatTime(marker.time, duration);
      }
    },
    [duration, mutate],
  );

  // The playback keys shared with the practice surface — play and pause, seek,
  // and walk the marks — plus this page's own two: `M` places a mark, and `[`/`]`
  // correct the selected one. The playback keys wait for the load to settle,
  // since there is nothing to play or seek until it does; `M` waits with them,
  // being a playhead gesture. The correction keys do not: they move a mark the
  // record already holds and ask the recording for nothing, which is why the
  // hook handles them above its own settle gate.
  usePlayerKeys({
    controller,
    markers: labeled,
    settled: session.settled,
    // The leave prompt takes the keyboard while it is up (T60): a mark placed
    // or a seek made behind the question would be changing the very work the
    // owner is being asked about.
    inert: blocker.state === 'blocked',
    onAddMarker: addAtPlayhead,
    // The correction keys act on the mark being corrected and on nothing else,
    // so with none selected they do nothing at all.
    onNudge: (delta) => {
      if (selected !== null) nudge(selected, delta);
    },
    // A walk picks out the mark it lands on: without this the nudge keys could
    // never reach a mark, since rows are pointer targets and not tab stops.
    onWalk: select,
  });

  const authoring: MarkersAuthoring = {
    onAdd: addAtPlayhead,
    addDisabled: !session.settled,
    onAlias(marker: LabeledMarker, alias: string): string {
      const text = alias.trim();
      try {
        // The domain is the one that decides: an alias it refuses throws with
        // its own guidance, and the mutation never happens.
        mutate((current) => ({
          ...current,
          markers: setAliases(current.markers, marker.id, text === '' ? [] : [text]),
        }));
      } catch (error) {
        setAliasError({ markerId: marker.id, message: errorMessage(error) });
        // The refused text is not what the mark holds; the field goes back to
        // the alias it does hold.
        return marker.aliases[0] ?? '';
      }
      // Cleared for this row only: a rule broken on one mark is that mark's
      // complaint, and another row's success says nothing about it.
      setAliasError((current) => (current?.markerId === marker.id ? null : current));
      return text;
    },
    aliasError,
    onDelete(marker: LabeledMarker): void {
      // The mark and its complaints go together.
      setAliasError((current) => (current?.markerId === marker.id ? null : current));
      setTimeError((current) => (current?.markerId === marker.id ? null : current));
      // And so does its selection: a correction left aimed at a mark that no
      // longer exists is a correction aimed at nothing.
      setSelectedId((current) => (current === marker.id ? null : current));
      mutate((current) => ({
        ...current,
        markers: removeMarker(current.markers, marker.id),
      }));
    },
    selectedId,
    onSelect: select,
    onNudge: nudge,
    onTime: setTime,
    timeError,
  };

  return (
    <>
      {/* The leave prompt (T60), while the router holds a navigation the owner
          asked for. Rendered inside the page's own tree so the recording it is
          asking about stays behind it, visible and unmoved. */}
      {blocker.state === 'blocked' && (
        <UnsavedChangesDialog onStay={blocker.reset} onDiscard={blocker.proceed} />
      )}
      <div className="markings-save-bar">
        <SaveStatusLine autosave={autosave} />
        {needsCommit && (
          <button
            type="button"
            className="markings-save"
            disabled={!canCommit}
            // A failed flush rejects; the status line is that failure's own
            // surface, and an unhandled rejection would drown it.
            onClick={() => void autosave.flush().catch(() => {})}
          >
            Save changes
          </button>
        )}
        {needsCommit && <p className="markings-save-note">{RETURN_TO_REVIEW_NOTE}</p>}
      </div>
      <RecordingSurface
        controller={controller}
        record={record}
        videoRef={session.containerRef}
        settled={session.settled}
        loadFailed={session.loadFailed}
        onRetryLoad={session.retryLoad}
        side={(markersMaxHeight) =>
          labeled.length === 0 ? (
            <MarkingsEmptyState onAdd={addAtPlayhead} addDisabled={!session.settled} />
          ) : (
            // The same panel the practice surface shows: the same rows, the
            // same derived labels, the same movement grouping — and the rows
            // jump the recording when clicked. What changes on this page is
            // only what can be done to them (T56), which the authoring surface
            // supplies.
            <MarkersPanel
              markers={labeled}
              movements={record.movements}
              duration={duration}
              activeId={activeMarker?.id ?? null}
              onSeek={(marker) => controller.seek(marker.time)}
              onSeekMovement={(movement) => controller.seek(movement.start)}
              maxHeight={markersMaxHeight ?? undefined}
              authoring={authoring}
            />
          )
        }
      />
    </>
  );
}

/**
 * The consequence, named before the write (T56, ADR-0007). A published or
 * rejected public project is one the owner did not ask to disturb: the server's
 * review trigger returns it to the queue on any edit, and a published one leaves
 * the public gallery until a maintainer approves it again. The page says so
 * before the Save control is used, never after it — the consequence is one the
 * owner chose knowingly or not at all.
 *
 * The exception is named too, because the owner cannot tell from here which
 * kind they are: a trusted user's commit stays published, and the server is what
 * decides. The page never asks.
 */
const RETURN_TO_REVIEW_NOTE =
  'This project is public and already reviewed. Saving returns it to review and takes it off ' +
  'the public gallery until a maintainer approves it again. A trusted user’s edits publish ' +
  'immediately.';

/** The empty column's own way to fill itself — the same action the head offers. */
type MarkingsEmptyStateProps = AddMarkerControlProps;

/**
 * The empty first paint (T55): a project with nothing marked on it says the one
 * thing that fills it, rather than showing a blank column beside a recording.
 * The recording is playable either way — that is what makes the first mark
 * placeable at all.
 *
 * Since T56 the prompt names an action that works: marking is wired up, so the
 * copy is an instruction rather than a promise about a later release. It leads
 * with the key, because marking is a listening pass and the key is what keeps
 * the hands on the recording; the control beside it is the same action for a
 * pointer.
 */
function MarkingsEmptyState({ onAdd, addDisabled }: MarkingsEmptyStateProps) {
  return (
    <section className="markings-empty" aria-label="Markers">
      <MarkersHead>
        <AddMarkerControl onAdd={onAdd} addDisabled={addDisabled} />
      </MarkersHead>
      <p className="markings-empty-copy">
        Nothing marked yet. Play the recording and press <kbd>M</kbd> where a landmark goes by —
        the marker falls at the playhead, and you can name it afterwards.
      </p>
    </section>
  );
}
