import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Navigate, useParams } from 'react-router';
import type { AudioController } from '../audio';
import {
  activeRowId,
  addMarker,
  addMovement,
  createMarker,
  createMovement,
  errorMessage,
  formatTime,
  moveMarker,
  moveMovement,
  nudgedTime,
  parseTime,
  removeMarker,
  removeMovement,
  renameMovement,
  setAliases,
} from '../domain';
import type { LabeledMarker, Movement } from '../domain';
import { createAutosave, createProjectSave } from '../projects/autosave';
import type { Autosave } from '../projects/autosave';
import type { ProjectsApi } from '../projects/api';
import { requiresExplicitSave } from '../projects/types';
import { MarkingsAddControls, MarkersHead, MarkersPanel } from './MarkersPanel';
import type { MarkingsAddControlsProps, MarkersAuthoring } from './MarkersPanel';
import { NotFoundPage } from './NotFoundPage';
import { RecordingSurface } from './RecordingSurface';
import { SaveStatusLine } from './SaveStatusLine';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { useLabeledPlayback } from './useLabeledPlayback';
import { usePlayerKeys } from './playerKeys';
import { useRecordingSession } from './useRecordingSession';
import { useNavigationBlocker, useTabCloseGuard } from './exitGuards';
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
  const { labeled, duration, elapsed, passedMarker } = useLabeledPlayback({ controller, record });
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
   * Why the last attempt to set a movement boundary was refused (T58). Unlike
   * the two above it is not held by a row, because the attempt that failed left
   * no movement behind: the playhead was already a boundary. The complaint
   * belongs beside the control that made it.
   */
  const [movementAddError, setMovementAddError] = useState<string | null>(null);
  /**
   * The movement name the domain refused, and which header it was refused in —
   * the movement twin of `aliasError`, held the same way and for the same
   * reason: a name refused on one movement says nothing about the next.
   */
  const [movementNameError, setMovementNameError] = useState<{
    movementId: string;
    message: string;
  } | null>(null);
  /**
   * The movement time the domain refused, and which boundary it was refused on
   * (T59) — the movement twin of `timeError`, and held the same way: a time
   * refused on one boundary says nothing about the next. Unlike a mark's, this
   * refusal is not about a nonsense time but about a real one that would put
   * the boundary on or past a neighbour.
   */
  const [movementTimeError, setMovementTimeError] = useState<{
    movementId: string;
    message: string;
  } | null>(null);
  /**
   * The row the correction block is being held on — the one whose time field
   * the caret is in, by id, or null while no field has the caret (T64). It is
   * the page's one piece of held state about correcting, and it is the
   * exception: the block is on the active row, which is derived and moves with
   * the playhead, and this only says "not this one, that one, until I am done".
   *
   * Nothing else arms it. A nudge-button click is deliberately not a trigger —
   * Safari on macOS does not focus a button on click, so the same gesture would
   * pin there and not in Chrome — and it has nothing left to buy now that a
   * nudge takes the playhead with it.
   */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  /** The caret entered a row's time field: that row holds the block until `releasePin`. */
  const pin = useCallback((id: string): void => {
    setPinnedId(id);
  }, []);

  /**
   * The caret left that field, or the field left with it — the block goes back
   * to following the playhead. Both are the same fact: no caret is in a time
   * field, so there is nothing holding the block still.
   */
  const releasePin = useCallback((): void => {
    setPinnedId(null);
  }, []);

  const status = useSyncExternalStore(autosave.subscribe, autosave.status);
  /**
   * The row the correction block is on (T64): the row a caret is holding, else
   * the row the playhead is on — the boundary it is sitting on, or the mark it
   * has last passed. Derived from the live playhead every render rather than
   * held, so a correction can never be left aimed at a row that has gone, and
   * placing a mark pays for itself: the mark lands active the instant it
   * exists, with the block already on it and its time ready to be made exact.
   */
  const activeRow = activeRowId(labeled, record.movements, elapsed);
  /** What the block is actually on: the pin where a caret holds one, the active row otherwise. */
  const blockRow = pinnedId ?? activeRow;
  /** The row the correction keys correct, as the record holds it now. */
  const blockMarker = labeled.find((marker) => marker.id === blockRow) ?? null;
  /** The boundary the correction keys correct, when the block is on a movement's row. */
  const blockMovement = record.movements.find((movement) => movement.id === blockRow) ?? null;

  // The mode the session was built in, read off the autosave that owns it: this
  // page shows a Save control exactly when the project waits for one.
  const needsCommit = autosave.mode === 'manual';
  /**
   * Whether the server holds something other than what the record holds —
   * `dirty` (waiting), `saving` (asked for, unanswered) and `error` (asked for,
   * refused) alike. The failure counts because the record is still pending;
   * the in-flight write counts because the commit has been *asked for*, not
   * made, and a rejection arriving after the page is gone would come back to a
   * disposed autosave with nothing left to retry it. This is the tab's own
   * exit's question, in every mode (#136).
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
   * Whether an in-app exit would cost work only the owner can settle (T60) —
   * a `manual` record with something the server has not confirmed. An `auto`
   * record never blocks here, because a write is already scheduled for it and
   * an in-app exit runs the session's teardown, which flushes: the page is not
   * what settles that work, so leaving is not a decision to put to its owner.
   * Only a `manual` record has nothing that will write it, which is why this is
   * narrower than `uncommitted` and is named for what leaving would cost rather
   * than for what the record holds.
   *
   * It is the router's question and not the tab's (#136): the teardown that
   * answers it for an `auto` record runs on an in-app exit and never on a tab
   * close, which is why the tab's own exit takes `uncommitted` instead.
   */
  const hasWorkToLose = needsCommit && uncommitted;
  const blocker = useNavigationBlocker(hasWorkToLose);
  useTabCloseGuard(uncommitted);

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
   * Sets a movement boundary where the recording is (T58) — the boundary twin
   * of placing a mark, made the same way and for the same reason: the student
   * hears the movement begin, and presses for it there.
   *
   * A boundary is named as it is placed. The name is provisional and honestly
   * so — "Movement 2" is the second one this student set, not a claim about the
   * score — because the domain has no unnamed movement to place and the student
   * can rename it in the header a moment later. What the provisional name buys
   * is that the movement is a real movement from the instant it exists: the
   * record never holds one the parser would refuse to read back.
   */
  const addMovementAtPlayhead = useCallback((): void => {
    try {
      mutate((current) => ({
        ...current,
        movements: addMovement(
          current.movements,
          createMovement(`Movement ${current.movements.length + 1}`, controller.getCurrentTime()),
        ),
      }));
      // Cleared by the attempt that succeeded, like every other complaint here.
      setMovementAddError(null);
    } catch (error) {
      // The one way this refuses: the playhead sits on a boundary that is
      // already there. The domain says which one, and the student can see it.
      setMovementAddError(errorMessage(error));
    }
  }, [controller, mutate]);

  /**
   * Commits a name typed into a movement's header. The domain decides, as it
   * does for an alias: a name it refuses throws with its own guidance and the
   * movement is not renamed, so the refused text is never stored.
   */
  const setMovementName = useCallback(
    (movement: Movement, name: string): string => {
      try {
        mutate((current) => ({
          ...current,
          movements: renameMovement(current.movements, movement.id, name),
        }));
      } catch (error) {
        setMovementNameError({ movementId: movement.id, message: errorMessage(error) });
        // The refused text is not what the movement holds; the field goes back
        // to the name it does hold.
        return movement.name;
      }
      // Cleared for this header only: a name refused on one movement is that
      // movement's complaint, and another header's acceptance says nothing.
      setMovementNameError((current) => (current?.movementId === movement.id ? null : current));
      return name.trim();
    },
    [mutate],
  );

  /**
   * Forgets the movement time the domain refused (T59). Called wherever that
   * boundary is re-timed, nudged or removed: the complaint was about a boundary
   * as it stood, and a correction left standing over a boundary that has since
   * moved would be an error about nothing.
   *
   * Only the movement named: a refusal belongs to the boundary that earned it,
   * and another boundary's acceptance says nothing of it.
   */
  const forgetMovementTimeError = useCallback((id: string): void => {
    setMovementTimeError((current) => (current?.movementId === id ? null : current));
  }, []);

  /**
   * Re-time a movement to a time typed into its correction field (T59). The
   * domain parses the text and is the one that decides, exactly as it does for
   * a mark's time — and it is a decision with a second edge here: a time can be
   * perfectly real and still be one this boundary cannot take, because it lands
   * on or past a neighbour. That refusal throws with its own guidance naming the
   * movement in the way, and this boundary does not move.
   *
   * A time it accepts is also a seek (T64): a correction moves the recording
   * with it, so the boundary the student has just made exact is the boundary
   * they hear — and the playhead landing back on the written start is what keeps
   * the block on this row as the caret leaves it. A refusal seeks nothing,
   * because the boundary did not move to seek to.
   */
  const setMovementTime = useCallback(
    (movement: Movement, text: string): string => {
      let shown: string;
      let written: number;
      try {
        written = parseTime(text);
        mutate((current) => ({
          ...current,
          movements: moveMovement(current.movements, movement.id, written),
        }));
        shown = formatTime(written, duration);
      } catch (error) {
        setMovementTimeError({ movementId: movement.id, message: errorMessage(error) });
        // The refused text is not where the boundary is; the field goes back to
        // the exact start the movement does hold.
        return formatTime(movement.start, duration);
      }
      forgetMovementTimeError(movement.id);
      controller.seek(written);
      return shown;
    },
    [controller, duration, forgetMovementTimeError, mutate],
  );

  /**
   * Moves a boundary by `delta` seconds — the one correction the block's two
   * controls make, and the movement twin of a mark's nudge. Unlike a mark's it
   * can be refused: the boundary is bounded by its neighbours where a mark is
   * bounded by nothing, so a nudge into the movement next door is a domain
   * refusal rather than a move, and it is reported the way a refused typed time
   * is. A nudge that lands re-seeds the field (it is keyed on the start), which
   * is why the complaint goes with the success — and seeks (T64), as a typed
   * time does: a correction the student cannot hear the result of is a
   * correction they have to go and find. And it drops the pin (T64), for the
   * same reason a mark's nudge does: the field it re-seeds is the one the caret
   * was in, so the caret is not in a field any more.
   */
  const nudgeMovement = useCallback(
    (movement: Movement, delta: number): void => {
      try {
        const next = mutate((current) => {
          // Read from the record being written, not from the render this
          // gesture started in, so a nudge always moves from where the boundary
          // actually is. One that is no longer there moves nothing rather than
          // throwing — its row is gone.
          const held = current.movements.find((m) => m.id === movement.id);
          if (held === undefined) return current;
          return {
            ...current,
            movements: moveMovement(current.movements, movement.id, nudgedTime(held.start, delta)),
          };
        });
        forgetMovementTimeError(movement.id);
        // The seek reads the boundary off the record that was just written
        // rather than off the arithmetic above, so what the recording moves to
        // is what the boundary is. A boundary that had already gone moved
        // nothing, and the recording stays where it is.
        const written = next.movements.find((m) => m.id === movement.id);
        if (written !== undefined) controller.seek(written.start);
        releasePin();
      } catch (error) {
        setMovementTimeError({ movementId: movement.id, message: errorMessage(error) });
      }
    },
    [controller, forgetMovementTimeError, mutate, releasePin],
  );

  /**
   * Removes a movement boundary (T59). Nothing is done to the markers: they are
   * never attached to a movement, so they stay exactly where they are and
   * simply fall into whichever movement now runs over their time — the one
   * before it, or the leading group if it was the first — with their labels
   * drawn again from their new group. The panel asked first, and said so.
   */
  const deleteMovement = useCallback(
    (movement: Movement): void => {
      // The boundary's complaints go with it, and so does its pin: a correction
      // left aimed at a movement that no longer exists is a correction aimed at
      // nothing, and a caret cannot be in a field that has gone.
      forgetMovementTimeError(movement.id);
      setMovementNameError((current) => (current?.movementId === movement.id ? null : current));
      // The pin goes with it, for the same reason: a caret cannot be in the time
      // field of a row that has gone.
      setPinnedId((current) => (current === movement.id ? null : current));
      mutate((current) => ({
        ...current,
        movements: removeMovement(current.movements, movement.id),
      }));
    },
    [forgetMovementTimeError, mutate],
  );

  /**
   * Moves a mark by `delta` seconds — the one correction `[`, `]` and the
   * block's two controls all make. The correction takes the recording with it
   * (T64): the playhead goes to the time just written, so the student hears the
   * mark they have just made exact rather than the one it used to be. Nothing
   * else about playback is touched — a correction while the recording plays
   * corrects it and carries on playing, as it always did.
   *
   * It also drops the pin, and that is not a detail: the nudge re-seeds the time
   * field (it is keyed on the time the mark now holds), so the field the caret
   * was in is gone. In Safari, where a click does not focus a button, nothing
   * else would ever say so — no blur arrives — and the block would be held on
   * this row for good.
   */
  const nudge = useCallback(
    (marker: LabeledMarker, delta: number): void => {
      const next = mutate((current) => {
        // The mark's time is read from the record being written, not from the
        // render this gesture started in, so a nudge always moves the mark from
        // where it actually is. A mark that is no longer there corrects nothing
        // rather than throwing — its row is gone.
        const held = current.markers.find((m) => m.id === marker.id);
        if (held === undefined) return current;
        return {
          ...current,
          markers: moveMarker(current.markers, marker.id, nudgedTime(held.time, delta)),
        };
      });
      // Read off the record that was just written rather than off the
      // arithmetic above, so the recording moves to the mark's actual time. A
      // mark that had already gone moved nothing, and the recording stays put.
      const written = next.markers.find((m) => m.id === marker.id);
      if (written !== undefined) controller.seek(written.time);
      releasePin();
      // A nudge re-seeds the field with the time the mark now holds, so a time
      // refused a moment ago is a complaint about text that is no longer in the
      // field — it goes with the text, exactly as applying a typed time clears
      // it. Left standing, it would sit under a valid time contradicting it, and
      // be announced again when the block came back to this row. The alias is a
      // different fact about the mark and keeps its own.
      setTimeError((current) => (current?.markerId === marker.id ? null : current));
    },
    [controller, mutate, releasePin],
  );

  /**
   * Applies a time typed into the correction field. The domain parses it and is
   * the one that decides: a time it refuses throws with its own guidance, and
   * the mark is not moved — the refused text is never stored, and never left in
   * the field as if it were.
   *
   * A time it accepts is also a seek (T64), as a nudge is: the mark is now where
   * the student says the landmark is, so that is where the recording goes — and
   * the playhead landing back on the written time is what keeps the block on
   * this row as the caret leaves it. A refusal seeks nothing, because the mark
   * did not move to seek to.
   */
  const setTime = useCallback(
    (marker: LabeledMarker, text: string): string => {
      let written: number;
      try {
        written = parseTime(text);
        mutate((current) => ({
          ...current,
          markers: moveMarker(current.markers, marker.id, written),
        }));
      } catch (error) {
        setTimeError({ markerId: marker.id, message: errorMessage(error) });
        // The refused text is not what the mark holds; the field goes back to
        // the exact time it does hold.
        return formatTime(marker.time, duration);
      }
      // Cleared for this mark only: a time refused on one mark is that mark's
      // complaint, and another's acceptance says nothing about it.
      setTimeError((current) => (current?.markerId === marker.id ? null : current));
      controller.seek(written);
      return formatTime(written, duration);
    },
    [controller, duration, mutate],
  );

  // The playback keys shared with the practice surface — play and pause, seek,
  // and walk the marks — plus this page's own two: `M` places a mark, and `[`/`]`
  // correct the row the playhead is on. Every one of them asks the recording for
  // something — a correction is a seek now (T64) — so all of them wait for the
  // load to settle together, which is where the hook's own gate has them.
  usePlayerKeys({
    controller,
    markers: labeled,
    settled: session.settled,
    // The leave prompt takes the keyboard while it is up (T60): a mark placed
    // or a seek made behind the question would be changing the very work the
    // owner is being asked about.
    inert: blocker.state === 'blocked',
    onAddMarker: addAtPlayhead,
    // The correction keys act on the row the playhead is on and on nothing
    // else, so before the first mark they do nothing at all. Which kind of row
    // that is, is the row's own answer: a boundary is corrected as a mark is —
    // one gesture, two nouns — so the key asks what the block is on rather than
    // the page holding two keys that do the same thing to different rows.
    onNudge: (delta) => {
      if (blockMarker !== null) nudge(blockMarker, delta);
      else if (blockMovement !== null) nudgeMovement(blockMovement, delta);
    },
  });

  const authoring: MarkersAuthoring = {
    onAddMarker: addAtPlayhead,
    onAddMovement: addMovementAtPlayhead,
    movementAddError,
    onMovementName: setMovementName,
    movementNameError,
    onMovementTime: setMovementTime,
    movementTimeError,
    onNudgeMovement: nudgeMovement,
    onDeleteMovement: deleteMovement,
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
      // And so does its pin: a caret cannot be in the time field of a row that
      // has gone, and a pin left naming it would hold the block on nothing.
      setPinnedId((current) => (current === marker.id ? null : current));
      mutate((current) => ({
        ...current,
        markers: removeMarker(current.markers, marker.id),
      }));
    },
    onPin: pin,
    onReleasePin: releasePin,
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
          // Empty means empty of everything the column holds (T58): a recording
          // with its movements laid out and no marks in them yet is a project
          // being filled, and the panel is what shows the boundaries back.
          labeled.length === 0 && record.movements.length === 0 ? (
            <MarkingsEmptyState
              onAddMarker={addAtPlayhead}
              onAddMovement={addMovementAtPlayhead}
              addDisabled={!session.settled}
              movementAddError={movementAddError}
            />
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
              passedId={passedMarker?.id ?? null}
              // The row the correction block goes on, and so the row the panel
              // follows (T64) — resolved here, where the pin is held, so the row
              // the panel draws the block in is the row this page corrects. The
              // active row is derived from the playhead rather than picked out by
              // a click, so it is never stale: a mark placed a moment ago is the
              // row the playhead has just passed.
              blockRowId={blockRow}
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

/** The empty column's own way to fill itself — the same actions the head offers. */
type MarkingsEmptyStateProps = MarkingsAddControlsProps;

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
 *
 * The head carries the same two controls the filled column's does (T58), so a
 * project can be started at its boundaries as readily as at its marks: a
 * recording whose movements are laid out first is a perfectly ordinary way to
 * work through a symphony. The copy below stays about the marks, which is what
 * the key it names does.
 */
function MarkingsEmptyState({
  onAddMarker,
  onAddMovement,
  addDisabled,
  movementAddError,
}: MarkingsEmptyStateProps) {
  return (
    <section className="markings-empty" aria-label="Markers">
      <MarkersHead>
        <MarkingsAddControls
          onAddMarker={onAddMarker}
          onAddMovement={onAddMovement}
          addDisabled={addDisabled}
          movementAddError={movementAddError}
        />
      </MarkersHead>
      <p className="markings-empty-copy">
        Nothing marked yet. Play the recording and press <kbd>M</kbd> where a landmark goes by —
        the marker falls at the playhead, and you can name it afterwards.
      </p>
    </section>
  );
}
