import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import type { LabeledMarker } from '../domain';
import type { Movement } from '../domain';
import { movementForTime, NUDGE_COARSE_STEP_SECONDS, NUDGE_STEP_SECONDS } from '../domain';
import { formatTime, formatWholeSeconds } from '../domain/time';
import { revealDelay, revealScroll } from './revealScroll';

/**
 * How long the panel leaves the list alone after the reader has scrolled it by
 * hand. Long enough to read a few rows, short enough that the list does not
 * feel stuck once they stop.
 */
const MANUAL_SCROLL_GRACE_MS = 3000;

/**
 * The panel's editing surface (T56, T57, T58, T59). Supplied only by the
 * markings page, where a mark can be placed, named, corrected and removed and a
 * movement boundary can be set, named, re-timed and deleted; absent on the
 * practice surface and the read-only public view, which then carry no control
 * that could change either.
 *
 * Naming and deleting act on the row they are in, so neither needs a row chosen
 * first — and a movement is named in its own header, the same way. Correcting
 * needs no choice either (T64): the block sits on the **active row**, which the
 * page derives from the playhead rather than holding, so nothing can be left
 * aimed at a row that has gone. The one thing that moves the block off that row
 * — a caret sitting in one of a pinned row's own fields (T64, T69) — arrives as
 * `onPin` and `onReleasePin`, and the row it resolves to arrives as `blockRowId`.
 */
export interface MarkersAuthoring {
  /** Places a mark at the playhead. */
  onAddMarker(): void;
  /**
   * Places a movement boundary at the playhead (T58), named provisionally —
   * movements are markers' peers (ADR-0007), so a boundary is set where the
   * student hears it, exactly as a mark is.
   */
  onAddMovement(): void;
  /**
   * Why a movement could not be placed at all (T58) — the domain's own refusal
   * when the playhead sits on a boundary that already exists. Shown beside the
   * control that made the attempt, since a create that refused has no movement
   * of its own to hang the complaint on.
   */
  movementAddError: string | null;
  /**
   * Commits a name for the movement. Returns the name the movement holds once
   * the attempt is over — the normalized text on success, the unchanged stored
   * name when the domain refused it — so the field can be put back to the truth
   * without the panel re-reading a record it has not seen yet, as the alias
   * field is.
   */
  onMovementName(movement: Movement, name: string): string;
  /**
   * The movement name the domain refused and the guidance it gave, for the
   * field that caused it. The header it names shows the message; every other
   * header is quiet.
   */
  movementNameError: { movementId: string; message: string } | null;
  /**
   * Re-times the movement to a typed time (T59). Returns the time it holds once
   * the attempt is over — the exact time on success, the unchanged stored start
   * when the domain refused the text or the boundary it named — so the field
   * can be put back to the truth without the panel re-reading a record it has
   * not seen yet, as the alias and correction fields are.
   */
  onMovementTime(movement: Movement, text: string): string;
  /**
   * The movement time the domain refused and the guidance it gave, for the
   * field that caused it. The block it names shows the message; every other
   * movement's is quiet.
   */
  movementTimeError: { movementId: string; message: string } | null;
  /**
   * Nudges the movement's boundary by `delta` seconds, negative for earlier.
   * The movement twin of a mark's nudge, and the same steps: a boundary set at
   * the playhead lands late by reaction time, exactly as a mark does.
   */
  onNudgeMovement(movement: Movement, delta: number): void;
  /**
   * Removes the movement. The markers inside it are not removed with it — they
   * fall into whatever movement now runs over their time, and their labels are
   * redrawn (T59, ADR-0007). The panel says so before the control is used.
   */
  onDeleteMovement(movement: Movement): void;
  /** Whether the recording's load has settled — the Add controls are inert until it has. */
  addDisabled: boolean;
  /**
   * Commits an alias for the marker; an empty value clears it. Returns the
   * alias the marker holds once the attempt is over — the normalized text on
   * success, the unchanged stored alias when the domain refused it — so the
   * field can be put back to the truth without the panel re-reading a record
   * it has not seen yet.
   */
  onAlias(marker: LabeledMarker, alias: string): string;
  /**
   * The alias the domain refused and the guidance it gave, for the field that
   * caused it. The row it names shows the message; every other row is quiet.
   */
  aliasError: { markerId: string; message: string } | null;
  /** Removes the marker. */
  onDelete(marker: LabeledMarker): void;
  /**
   * The caret entered one of a row's own fields (T64) — its time, or the name
   * beside its label (T69). That row holds the block — it becomes `blockRowId` —
   * until `onReleasePin`, whatever the playhead does in the meantime, so a time
   * being typed is not re-seeded and a name half-typed is not unmounted out from
   * under the typist by the next mark going by, and the row a correction is
   * being given is not scrolled away from them.
   *
   * The pin is armed by the caret entering one of the row's fields and released
   * when it has left them all, and by nothing else. A nudge-button click is
   * deliberately not a trigger: Safari on macOS does not focus a button on
   * click, so the same gesture would pin there and not in Chrome — and it has
   * nothing left to buy, now that a nudge takes the playhead with it.
   */
  onPin(id: string): void;
  /** The caret left the row's fields. The block goes back to following the playhead. */
  onReleasePin(): void;
  /**
   * Nudges the marker by `delta` seconds, negative for earlier. The one action
   * `[`, `]` and the block's own two controls all take, so a correction is the
   * same correction however it was made.
   */
  onNudge(marker: LabeledMarker, delta: number): void;
  /**
   * Commits a typed time for the marker. Returns the time the marker holds once
   * the attempt is over — the exact time on success, the unchanged stored one
   * when the domain refused the text — so the field can be put back to the truth
   * without the panel re-reading a record it has not seen yet, as the alias
   * field is.
   */
  onTime(marker: LabeledMarker, text: string): string;
  /**
   * The time the domain refused and the guidance it gave, for the field that
   * caused it. The row it names shows the message inside the block holding that
   * field; every other row is quiet.
   */
  timeError: { markerId: string; message: string } | null;
}

export interface MarkersPanelProps {
  /** Markers with derived labels, in time order. */
  markers: LabeledMarker[];
  /**
   * The recording's movements (ADR-0005). Empty means a flat, ungrouped list —
   * exactly the pre-movement panel. When present, markers group under a sticky
   * movement header and labels restart at A within each movement.
   */
  movements: Movement[];
  /** The known recording duration, seconds — row times divide by it. */
  duration: number;
  /**
   * The passed marker's id — the most recently passed mark, or null before the
   * first mark (the recording's Start has no marker of its own). This is the row
   * the panel tints, and what the reveal follows when it has nothing better to
   * follow. A boundary holding the playhead does not change it: the tint is the
   * passed mark's, and a boundary is not a mark.
   */
  passedId: string | null;
  /**
   * The id of the row carrying the correction block (T64) — the **active row**
   * (ADR-0007, amended 2026-09-24), or the row a caret is holding the block on
   * instead. Supplied by the markings page, which derives it: that is the one
   * surface with a block to place, and the one holding the pin. The precedence
   * — a pin over the playhead — is resolved there and read here, so the row the
   * block is drawn in is the row the page corrects, by construction.
   *
   * A surface without a block passes nothing and reveals the passed marker, as
   * it always has.
   */
  blockRowId?: string | null;
  /**
   * A row was clicked. The player jumps to the marker and never interrupts
   * playback — this is the jump and only the jump. On the markings page the
   * seek is also what makes the row the active one, and so the row carrying the
   * correction block (T64), which needs no separate word from the click.
   */
  onSeek(marker: LabeledMarker): void;
  /** A movement header was clicked. The player jumps to the movement's start. */
  onSeekMovement(movement: Movement): void;
  /**
   * A measured cap on the list, so its bottom stays within the video's. When
   * omitted the stylesheet's fixed cap owns the scroll — the stacked layout,
   * where there is no video bottom to stay within.
   */
  maxHeight?: number;
  /**
   * The markings page's address — the quiet way in from the panel (T55),
   * rendered beside the heading. The panel already holds the marks, so the
   * door sits where the intent forms. Omitted in a read-only session, which
   * offers no way in at all.
   */
  markingsHref?: string;
  /**
   * What the panel may do to its marks and its movements, supplied only by the
   * markings page (T56, T57, T58). Present, the head carries Add marker and Add
   * movement, the rows carry the delete control, and — on the active row — the
   * alias field (T69) and the correction block that nudges the row and takes an
   * exact time for it, and a movement's header becomes the field its name is
   * edited in; absent, the panel is the browsing list the practice surface and
   * the read-only view have always shown, with no control that could change
   * either. Which row is the active one is `blockRowId`'s to say: this surface
   * alone does not put a field on any row.
   */
  authoring?: MarkersAuthoring;
}

export interface MarkersHeadProps {
  /** The control beside the heading — whatever this surface offers where the marks are. */
  children?: ReactNode;
}

/**
 * The markers column's head: the heading, and the one control this surface puts
 * beside it. Shared so an empty column and a filled one read as the same column
 * in two states (T55) rather than two surfaces — the markings page's first
 * paint and its marked one carry the same head above them.
 */
export function MarkersHead({ children }: MarkersHeadProps) {
  return (
    <div className="player-markers-head">
      <h2 className="player-markers-heading">Markers</h2>
      {children}
    </div>
  );
}

/**
 * What the column's two add controls take. They are the same act against
 * different nouns — set something at the playhead — so they take the same
 * shape, and each prop is named for the thing its control adds: beside
 * `onAddMovement`, a bare `onAdd` would read as either.
 */
export interface MarkingsAddControlsProps {
  /** Places a mark at the playhead. */
  onAddMarker(): void;
  /** Places a movement boundary at the playhead. */
  onAddMovement(): void;
  /** Why the last attempt to place a movement was refused, or null while none was. */
  movementAddError: string | null;
  /** Whether the recording has settled; both controls are inert until it has. */
  addDisabled: boolean;
}

/**
 * The two things a markings column can be given: a mark, and a boundary. Shared
 * by the panel's head and the empty column's prompt so the two read as the same
 * column in two states (T55) — the actions a project can be started with are
 * the actions it can be added to.
 *
 * Both are the pointer's way to do what a key does. Marking is a listening pass
 * and the keys are what keep the hands on the recording, but a key alone would
 * make the column's purpose unreachable without a keyboard — so each action
 * also exists here, where the marks land, inert until the playhead means
 * something. A boundary is placed by ear for the same reason a mark is: the
 * student hears the movement begin, and it goes there (T58).
 *
 * The movement control carries its own refusal because a create that was
 * refused left no movement behind to hang the complaint on: the message belongs
 * beside the control that made the attempt, not in a row.
 */
export function MarkingsAddControls({
  onAddMarker,
  addDisabled,
  onAddMovement,
  movementAddError,
}: MarkingsAddControlsProps) {
  return (
    <div className="markings-add-controls">
      <button type="button" className="markings-add" onClick={onAddMarker} disabled={addDisabled}>
        Add marker
      </button>
      <button
        type="button"
        className="markings-add-movement"
        onClick={onAddMovement}
        disabled={addDisabled}
      >
        Add movement
      </button>
      {movementAddError !== null && (
        <p role="alert" className="markings-add-error">
          {movementAddError}
        </p>
      )}
    </div>
  );
}

/**
 * The trash glyph the delete control shows (T66) — the first SVG in the
 * interface, and inline for that reason: the app has no icon library, and this
 * adds none.
 *
 * It is stroked in `currentColor`, so the ink it is drawn in is the control's
 * own rather than a colour of its own, and it is `aria-hidden`, because the
 * words that say what it destroys are the control's name: a glyph announced
 * beside them would say the same thing twice, in a shape no screen reader has a
 * word for.
 */
function TrashGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3.2 4.6h9.6M6.4 4.6V3.2h3.2v1.4M4.8 4.6l.55 8.1a1 1 0 0 0 1 .95h3.3a1 1 0 0 0 1-.95l.55-8.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface DeleteControlProps {
  /** What this control destroys, in words — its accessible name, and its title. */
  label: string;
  onDelete(): void;
}

/**
 * The delete control both kinds of row carry (T66): one component, so a mark's
 * trash and a movement's are the same glyph drawn the same way, and neither can
 * drift from the other.
 *
 * The glyph costs no one the word. The accessible name is still `Delete marker
 * A`, and the control says the same thing to a pointer through its title,
 * because a picture is not something a pointer can be told to read. The word
 * also survives where it is an *answer* rather than a control: a movement's
 * delete still raises its question first, and that question's confirming button
 * still reads `Delete` — the glyph replaces the control that asks, not the one
 * that answers.
 */
function DeleteControl({ label, onDelete }: DeleteControlProps) {
  return (
    <button
      type="button"
      className="markings-delete"
      aria-label={label}
      title={label}
      onClick={onDelete}
    >
      <TrashGlyph />
    </button>
  );
}

/** Markers grouped under their movement; markers before the first movement (or with no movements) lead. */
interface MarkerGroup {
  movement: Movement | null;
  markers: LabeledMarker[];
}

/**
 * Markers partitioned by movement membership (latest start ≤ time), in
 * movement order. Markers before the first movement — or every marker when the
 * recording has no movements — form the leading, movement-less group.
 *
 * Every movement gets its group whether or not a mark falls in it (T58). A
 * movement is a fact about the recording and a place the recording can be
 * jumped to, not a heading a mark earns; and now that a boundary can be set
 * where the student hears one, a movement they have just placed must be
 * visible before they have marked anything inside it.
 */
function groupMarkers(
  markers: readonly LabeledMarker[],
  movements: readonly Movement[],
): MarkerGroup[] {
  const groups = movements.map((movement) => ({ movement, markers: [] as LabeledMarker[] }));
  const byId = new Map(groups.map((group) => [group.movement.id, group]));
  const leading = { movement: null, markers: [] as LabeledMarker[] };
  for (const marker of markers) {
    const movement = movementForTime(movements, marker.time);
    const group = movement !== null ? byId.get(movement.id) : undefined;
    (group ?? leading).markers.push(marker);
  }
  return leading.markers.length > 0 ? [leading, ...groups] : groups;
}

/**
 * The height of the sticky movement header the revealed row will sit under:
 * the row's nearest preceding movement `<li>`. Every header's containing block
 * is the whole list, so that one is the header still pinned when the row
 * reaches the band's top (any earlier header has been pushed out by it), and
 * its measured height is the inset even when a long movement name wraps past
 * the 35px the styles imply. 0 for a row in the leading, movement-less group —
 * and for a flat list, which has no headers at all.
 */
function pinnedHeaderInset(row: HTMLElement): number {
  for (let node = row.previousElementSibling; node !== null; node = node.previousElementSibling) {
    if (node instanceof HTMLElement && node.classList.contains('player-marker-movement')) {
      return node.getBoundingClientRect().height;
    }
  }
  return 0;
}

/**
 * The markers panel (player side column): one row per marker — `label — alias`
 * (the bare label when there's no alias) and the timestamp right-aligned in a
 * shared column — a click-to-jump surface that replaces the timeline flags
 * (T38). The passed marker's row is highlighted; the panel scrolls when
 * the list outgrows its band — the player measures that band against the
 * video's bottom, so a marker-heavy project never towers past the recording.
 * Rows are click-to-jump surfaces, not tab stops — keyboard users walk the
 * marks with ↑/↓. On the browsing surfaces the panel is pure navigation:
 * clicking seeks and nothing else. On the markings page, where a row can be
 * corrected (T57), clicking and walking are also what *get you there*: the click
 * seeks, the seek puts the playhead on that row, and the row the playhead is on
 * is the one carrying the correction block (T64).
 *
 * The panel follows the playhead: whenever the row it follows changes, the list
 * scrolls so that row sits at the top of its band. That covers a deliberate
 * jump — a row, a header, a bar click, an arrow key, the embedded player's own
 * controls — and playback simply crossing a boundary, because all of them
 * arrive the same way, as the playhead moving. While a caret sits in the
 * correction block's time field the panel follows that row instead, and does
 * not re-aim when the playhead moves under it: a time being given to one row is
 * not the playhead moving, and the row it is being given to must not slide out
 * from under the student typing it. The reader is the one other brake: a
 * hand scroll buys the list a few seconds of being left alone
 * (`MANUAL_SCROLL_GRACE_MS`), restarted by any further scroll while a reveal
 * is waiting — and a scroll with nothing waiting keeps the list outright,
 * until the playhead moves again.
 *
 * A movement header's jump therefore reveals the marker the seek actually
 * landed on, which is the last marker *before* the movement rather than the
 * movement's own first row: that is the row the playhead has last passed, and
 * the header the reader clicked sits directly under it, both visible together.
 * Revealing the header itself would put the highlight off-band instead.
 *
 * With movements (ADR-0005) the rows group under sticky, scroll-driven
 * movement headers that pin to the list's top and swap as the next movement's
 * group scrolls into place; clicking a header seeks to the movement's start.
 * Without them the panel is the flat list it always was.
 *
 * Given an `authoring` surface (T56, T57, T58, T59) the panel becomes the
 * markings page's own column: the head carries Add marker and Add movement, the
 * rows carry the delete control and — on the active row — the alias field
 * (T69), a movement's header carries its name, its jump and its own delete, and
 * the active row carries the correction block — a mark's exact time and
 * nudges, or a boundary's. The list
 * itself is untouched — the same grouping, the same derived labels, the same
 * reveal — because the marks a student edits are the marks they were reading a
 * moment ago. The reveal follows the row carrying the block, which is the
 * active row but for the one case where a caret is holding it elsewhere (see
 * `reveal`).
 */
export function MarkersPanel({
  markers,
  // Records saved before movements existed (ADR-0005) read the field back as
  // undefined — default it to the empty, ungrouped list the contract describes.
  movements = [],
  duration,
  passedId,
  blockRowId,
  onSeek,
  onSeekMovement,
  maxHeight,
  markingsHref,
  authoring,
}: MarkersPanelProps) {
  const listRef = useRef<HTMLOListElement>(null);
  /**
   * The row carrying the correction block (T64), as the page resolved it: the
   * row a caret is holding, or — the ordinary case — the active row. Null on a
   * surface with no block at all, which has no block row to find and follows the
   * playhead as it always has.
   */
  const blockId = authoring === undefined ? null : (blockRowId ?? null);
  /** When the reader last scrolled the list themselves; null until they do. */
  const manualScrollAtRef = useRef<number | null>(null);
  /**
   * The position this panel last wrote to the list. Every assignment echoes
   * back as a `scroll` event, and an echo is not the reader — anything that
   * does not match is a hand scroll, which starts the grace period.
   */
  const writtenTopRef = useRef<number | null>(null);
  /** The reveal waiting out the grace period, while there is one. */
  const pendingRevealRef = useRef<number | undefined>(undefined);

  // The reveal, and the whole of the DOM half of it (the arithmetic and the
  // grace period are revealScroll's).
  //
  // The row is found by querying the DOM the current commit already produced
  // rather than through a ref onto the passed `<li>`: the query cannot read a
  // stale row, and it keeps working when the passed id moves to a different
  // row.
  const reveal = useCallback((): void => {
    const list = listRef.current;
    if (list === null) return;
    // The row the panel follows: the one carrying the correction block, which
    // is the active row but for the case the block is held elsewhere by a caret
    // in its time field. The field's own row is the student's statement of
    // which row they are giving a time to; while the caret is in it, the panel
    // holds that row still. On a surface with no block — the practice surface,
    // the read-only view — there is nothing to prefer and the panel is the
    // playhead's alone, as it has always been.
    const row =
      list.querySelector<HTMLElement>('li.correcting') ??
      list.querySelector<HTMLElement>('li.passed');
    if (row === null) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    list.scrollTop = revealScroll({
      scrollTop: list.scrollTop,
      clientHeight: list.clientHeight,
      scrollHeight: list.scrollHeight,
      listTop: listRect.top,
      rowTop: rowRect.top,
      headerInset: pinnedHeaderInset(row),
    });
    // Read the position back rather than trusting the one written: the
    // browser clamps it against the list's own ends, and it is the landed
    // value its echo will carry.
    writtenTopRef.current = list.scrollTop;
  }, []);

  /**
   * Reveals now, or at the end of whatever is left of the grace period. The
   * delay is read here and the row is read at fire time, so a deferred reveal
   * lands on the row it is following by *then* — which may be several
   * boundaries on from the one that queued it.
   */
  const scheduleReveal = useCallback((): void => {
    window.clearTimeout(pendingRevealRef.current);
    // Cleared, not just cancelled: the ref is what "a reveal is waiting" means
    // to the scroll handler, and a cancelled timer is not a waiting one.
    pendingRevealRef.current = undefined;
    const delay = revealDelay(manualScrollAtRef.current, Date.now(), MANUAL_SCROLL_GRACE_MS);
    if (delay === 0) {
      reveal();
      return;
    }
    pendingRevealRef.current = window.setTimeout(() => {
      pendingRevealRef.current = undefined;
      reveal();
    }, delay);
  }, [reveal]);

  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const onScroll = (): void => {
      if (list.scrollTop === writtenTopRef.current) return;
      // Consumed: a later return to that exact position is the reader's, not
      // a straggling echo of this write.
      writtenTopRef.current = null;
      manualScrollAtRef.current = Date.now();
      // Only a reveal that is already waiting is re-armed. A scroll on its own
      // queues nothing: a reader who takes the list while the playhead sits
      // still has asked for the list, and it stays theirs until the playhead
      // moves again.
      if (pendingRevealRef.current !== undefined) scheduleReveal();
    };
    list.addEventListener('scroll', onScroll);
    return () => list.removeEventListener('scroll', onScroll);
  }, [scheduleReveal]);

  // A layout effect, not a passive one: the reveal has to land in the same
  // frame the new followed row renders, or the panel visibly jumps twice. Keyed
  // on the row the reveal follows — the block's row where there is one, the
  // passed marker otherwise — which is what makes the panel follow the playhead
  // however the playhead moved, including a seek made in the embedded player's
  // own controls, which nothing in this app sees as a jump. That row moves when
  // a caret takes or gives up the block as well, so taking the caret out of a
  // field hands the list back to the playhead through the same key.
  const revealId = blockId ?? passedId;
  useLayoutEffect(() => {
    scheduleReveal();
    return () => {
      window.clearTimeout(pendingRevealRef.current);
      pendingRevealRef.current = undefined;
    };
  }, [revealId, scheduleReveal]);

  // An empty column paints nothing — unless it holds movements, which are the
  // column's content in their own right (T58): a recording with its boundaries
  // laid out and nothing marked inside them yet is a project being filled, not
  // an empty one.
  if (markers.length === 0 && movements.length === 0) return null;
  const hasMovements = movements.length > 0;
  const groups = groupMarkers(markers, movements);

  return (
    <section className="player-markers" aria-label="Markers">
      <MarkersHead>
        {authoring !== undefined ? (
          // The page's own controls (T56, T58): the head of the column the mark
          // and the boundary land in, so placing either is where the list is.
          <MarkingsAddControls
            onAddMarker={authoring.onAddMarker}
            onAddMovement={authoring.onAddMovement}
            addDisabled={authoring.addDisabled}
            movementAddError={authoring.movementAddError}
          />
        ) : (
          markingsHref !== undefined && (
            // The way into the markings page (T55), where the marks can be
            // changed. It navigates; it edits nothing from here.
            <Link to={markingsHref} className="player-markings-open">
              Markings <span aria-hidden="true">→</span>
            </Link>
          )
        )}
      </MarkersHead>
      <ol
        ref={listRef}
        className="player-marker-list"
        style={maxHeight !== undefined ? { maxHeight } : undefined}
      >
        {groups.flatMap(({ movement, markers: groupMarkers }) => {
          // Where this group's movement sits among the recording's movements —
          // -1 for the leading group, which has no movement at all. The list is
          // what knows it, and what deleting a boundary costs depends on it: a
          // movement's marks fall to the one before it (T59).
          const at = movement === null ? -1 : movements.findIndex((m) => m.id === movement.id);
          return [
            hasMovements && (
              <li
                key={movement ? `movement-${movement.id}` : 'before-first-movement'}
                className="player-marker-movement"
              >
                <MovementHeader
                  movement={movement}
                  duration={duration}
                  // What deleting this boundary costs, which only the list can
                  // say: how many marks it holds, and which movement now runs
                  // over their time (T59).
                  markCount={groupMarkers.length}
                  fallsTo={at > 0 ? movements[at - 1] : null}
                  onSeek={onSeekMovement}
                  authoring={authoring}
                />
              </li>
            ),
            // The movement the block is on (T59, T64), directly under its header
            // and outside it: the header's `<li>` is the list's sticky band, and
            // a correction block inside it would grow that band over the group
            // it is pinned above. As a row of its own it scrolls with the marks,
            // and the reveal follows it for the same reason it follows a
            // corrected mark's row — it is a row the playhead can be on, which
            // is what the student is working on. The delete question is the
            // exception, and stays in the band; the header says why.
            //
            // It is here, under the header and ahead of the group's own rows,
            // rather than beside the boundary the block corrects: the header is
            // the band, and the row that may carry the block is the first thing
            // under it. The block itself still names its movement either way.
            //
            // It is drawn when the playhead sits *on* the boundary (T64), which
            // is why the panel only ever has one block: the active row is one
            // row, and a movement that holds the playhead holds it alone.
            //
            // The row is the pin's (T64, T69): the caret leaving the block's own
            // field, and not landing in another field of this row, is what hands
            // the block back to the playhead. A row with one field releases as
            // it always did; the rule is stated once and in one place because a
            // mark's row has two.
            movement !== null && blockId === movement.id && authoring !== undefined && (
              <li
                key={`correct-${movement.id}`}
                className="correcting"
                aria-current="true"
                onBlur={(event) => {
                  if (caretLeftTheRow(event.currentTarget, event.relatedTarget)) {
                    authoring.onReleasePin();
                  }
                }}
              >
                <MovementCorrection movement={movement} duration={duration} authoring={authoring} />
              </li>
            ),
            ...groupMarkers.map((marker) => (
              <MarkerRow
                key={marker.id}
                marker={marker}
                passed={marker.id === passedId}
                carrying={blockId === marker.id}
                duration={duration}
                onSeek={onSeek}
                authoring={authoring}
              />
            )),
          ];
        })}
      </ol>
    </section>
  );
}

interface MovementHeaderProps {
  /** The movement this header names, or null for the leading, movement-less group. */
  movement: Movement | null;
  /** The recording's length — the header's clock divides by it. */
  duration: number;
  /** How many marks the movement holds — what deleting it would move (T59). */
  markCount: number;
  /**
   * The movement a deleted movement's marks would fall to — the one before it,
   * or null when it is the first and they join the leading group instead (T59).
   */
  fallsTo: Movement | null;
  onSeek(movement: Movement): void;
  /** What the panel may do to its movements, when the markings page supplies it. */
  authoring?: MarkersAuthoring;
}

/**
 * A movement's header: its name and its start, and the way to jump there. On
 * the browsing surfaces it is the jump control alone, as it has always been —
 * the whole header is the button, and clicking anywhere in it seeks.
 *
 * On the markings page (T58) the same header is where the movement is *named*,
 * so the name becomes the editable field, exactly as a mark's alias does in its
 * row. What is left of the header is the movement's start, and that is the jump:
 * a name written in a button would be a second copy of the field beside it,
 * reading as two different facts about one movement. The control is labelled by
 * the time it shows and titled with where it goes, the same convention the
 * nudge controls follow — a name that replaced the visible text would leave the
 * button unaddressable by the words on it.
 *
 * The leading group — marks before the first movement — has no movement and so
 * nothing to name or jump to; it keeps the plain label it has always had.
 *
 * The header is also where the movement is deleted (T59), and that is a
 * question rather than an act: a boundary can be put back in a moment, but the
 * marks standing inside it cannot be un-fallen once they have dropped into the
 * movement before — so the delete asks first, where the movement is, the way the
 * workspace's rows and the account control ask. What it asks is spelled out
 * from what this movement actually holds (`movementDeleteQuestion`), because
 * the answer differs by movement.
 *
 * The question is drawn *inside* this header, unlike the correction block, and
 * the difference is deliberate. The correction block is a surface the student
 * works in while the list scrolls under it, so it has to be a row of its own,
 * scrolling with the marks it belongs to; and the reveal follows it, so jumping
 * to a movement brings the row that corrects it into view with it. The question
 * is neither: it is raised by a
 * control in this header and answered in the next breath, and it has to be
 * visible the moment it is raised — including when this header is pinned, which
 * is where the control that raised it is. A row of its own would be laid out at
 * this header's *flow* position, which a pinned header paints over and leaves
 * scrolled away above; the band growing for the moment the question stands is
 * the price of the question always being where the reader is looking.
 */
function MovementHeader({
  movement,
  duration,
  markCount,
  fallsTo,
  onSeek,
  authoring,
}: MovementHeaderProps) {
  /**
   * Whether this movement's delete is being asked about. Held here rather than
   * on the page: the question belongs to the row that raised it, and it is
   * answered or abandoned long before any record changes.
   */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (movement === null) {
    return (
      <div className="player-movement-header" aria-hidden="true">
        <span className="player-movement-name">Before the first movement</span>
      </div>
    );
  }

  const time = formatWholeSeconds(movement.start, duration);

  if (authoring === undefined) {
    return (
      <button
        type="button"
        className="player-movement-header"
        onClick={() => onSeek(movement)}
        title={`Jump to ${movement.name}`}
      >
        <span className="player-movement-name">{movement.name}</span>
        <span className="player-marker-time">{time}</span>
      </button>
    );
  }

  const nameError =
    authoring.movementNameError?.movementId === movement.id
      ? authoring.movementNameError.message
      : null;

  return (
    <>
      <div className="player-movement-header markings-movement-header">
        <input
          type="text"
          className="markings-movement-name"
          defaultValue={movement.name}
          placeholder="movement name"
          aria-label={`Name for the movement ${movement.name}`}
          onBlur={(event) => {
            const field = event.currentTarget;
            // Nothing typed is nothing to commit — and re-committing the stored
            // name would only re-validate text already accepted.
            if (field.value === movement.name) return;
            // The panel writes the honest value back: the normalized name when
            // the domain took it, the unchanged stored one when it did not — so
            // the field never shows a name the record does not hold.
            field.value = authoring.onMovementName(movement, field.value);
          }}
          onKeyDown={(event) => {
            // Enter commits by leaving the field — one commit path, not two.
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <button
          type="button"
          className="markings-movement-jump"
          // The jump is also how the boundary is reached to be re-timed (T59,
          // T64): seeking to a movement and correcting its start are the same
          // intent — this is where the boundary is, make it exact — and the
          // seek parks the playhead on the boundary, which is the whole of what
          // puts the block on it. The marks answer to the same gesture: a row
          // click jumps, and the playhead landing there is what carries the
          // block.
          onClick={() => onSeek(movement)}
          title={`Jump to ${movement.name}`}
        >
          <span className="player-marker-time">{time}</span>
        </button>
        {!confirmingDelete && (
          <DeleteControl
            label={`Delete movement ${movement.name}`}
            onDelete={() => setConfirmingDelete(true)}
          />
        )}
      </div>
      {nameError !== null && (
        <p role="alert" className="markings-row-error">
          {nameError}
        </p>
      )}
      {confirmingDelete && (
        // The question stands where the movement does and names what this one
        // actually holds, so the answer is informed: the marks stay, and the
        // labels they carry are not the labels they will keep. The control that
        // raised it gives way to it, as the workspace's Delete does.
        <p className="markings-movement-confirm">
          {movementDeleteQuestion(movement, markCount, fallsTo)}
          {/* Cancel first, as the workspace's own delete question has it: a
              keyboard reaching into the question lands on the answer that keeps
              the movement, not on the one that does not. */}
          <button type="button" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="markings-movement-confirm-delete"
            onClick={() => {
              setConfirmingDelete(false);
              authoring.onDeleteMovement(movement);
            }}
          >
            Delete
          </button>
        </p>
      )}
    </>
  );
}

/**
 * What deleting a movement costs, in the terms it actually costs (T59): the
 * marks inside it are the movement's only by derivation — membership is
 * whichever movement's extent the mark's time falls in (ADR-0005), and a label
 * is a rank within that movement — so removing the boundary does not remove
 * them. They drop into whatever movement now runs over their time, and the
 * letters they carry are drawn again from their new group.
 *
 * The owner is told both before the boundary goes. Discovering afterwards that
 * a mark they placed inside movement II now reads as movement I's D, with
 * nothing having said it would, is exactly the surprise this sentence exists to
 * prevent — and the sentence is built from the movement's own numbers, because
 * a movement holding nothing and one holding twelve are not the same decision.
 */
function movementDeleteQuestion(
  movement: Movement,
  markCount: number,
  fallsTo: Movement | null,
): string {
  if (markCount === 0) {
    return `Delete “${movement.name}”? It holds no markers.`;
  }

  const one = markCount === 1;
  const held = one ? 'Its marker' : `Its ${markCount} markers`;
  const landing =
    fallsTo === null
      ? `${one ? 'joins' : 'join'} the markers before the first movement`
      : `${one ? 'falls' : 'fall'} to “${fallsTo.name}”`;

  return (
    `Delete “${movement.name}”? ${held} ${one ? 'stays' : 'stay'} — ` +
    `${one ? 'it' : 'they'} ${landing}, and ${one ? 'its label renumbers' : 'their labels renumber'}.`
  );
}

/**
 * Whether a blur hands its row back to the playhead (T64, T69). It does unless
 * the caret has landed in another field *of that same row*.
 *
 * The question is asked of the row and answered by its fields, because a row
 * now has two of them and one edit can move between them: a name half-typed is
 * not abandoned because the student has stepped to the time beside it. Naming
 * the destination this narrowly is deliberate — a rule that held the row for
 * any focus landing inside it would behave differently in Safari, where a click
 * does not focus a button at all, which is the same divergence T64 rejected.
 */
function caretLeftTheRow(row: HTMLElement, related: EventTarget | null): boolean {
  return !(related instanceof HTMLInputElement && row.contains(related));
}
// The test above is an `input` and not "a field" on purpose: what holds the row
// is a caret, and a caret is what an input has. A row's fields are all inputs
// today, so the narrower rule and the wider one agree — and if a later ticket
// gives a row a field that is not one, this is the line that has to learn about
// it, because a node the rule does not recognise reports the row as left and an
// input unmounted mid-edit takes what was typed with it.

interface CorrectionBlockProps {
  /**
   * The block's own name, as a reader hears it — which row it corrects and what
   * kind of row that is. "Correct marker A" and "Re-time movement II" are both
   * this one field, because the blocks differ only in what they say.
   */
  groupLabel: string;
  /** The time field's name, on the field it names. */
  fieldLabel: string;
  /** The time the row holds, in the exactness a correction is made at. */
  time: string;
  /**
   * The row's time in seconds. The field is keyed on it, so a nudge re-seeds
   * what is typed: the refused text of a moment ago is a complaint about text
   * that is no longer in the field, and goes with it.
   */
  seed: number;
  /** The domain's refusal of the last commit on this row, if it refused one. */
  error: string | null;
  /** Commits typed text; returns the honest time to put back in the field. */
  onTime(text: string): string;
  /** Nudges the row by `delta` seconds, negative for earlier. */
  onNudge(delta: number): void;
  /**
   * The caret entered the time field, so this row holds the block until the pin
   * is released (T64). Which row that is the caller's to say — the block knows
   * only that its own field was entered.
   */
  onPin(): void;
}

/**
 * The correction block the active row carries (T57, T59, T64): the row's exact
 * time, editable, and the two nudge controls. One block for both kinds of row,
 * because it is one correction — a boundary placed by ear at the playhead lands
 * late by human reaction time exactly as a mark does, so the two are made exact
 * by the same gesture, in the same steps, and then a tenth of a second apart
 * whether or not they say so the same way.
 *
 * The field is the row's own time rather than its clock, because the clock is
 * the music-stand reading — whole seconds, which a tenth of a second never
 * moves — while a correction is exact by nature.
 *
 * The field is also what arms the pin (T64): the block follows the playhead from
 * row to row, and the one thing that may hold it still is a caret in this field.
 * While the caret is here the student is telling one row what time it holds, and
 * neither a mark going by nor the row itself being nudged may take the field out
 * from under them — so the focus is reported up and the row it names is the one
 * the panel follows.
 *
 * It is presentational: which row, what the commit means, what the domain said
 * of it, and which row the caret's presence pins are all the caller's. A mark's
 * row and a movement's header differ in every one of those and in nothing else.
 */
function CorrectionBlock({
  groupLabel,
  fieldLabel,
  time,
  seed,
  error,
  onTime,
  onNudge,
  onPin,
}: CorrectionBlockProps) {
  return (
    // The group is named for the row it corrects, so the block is not a set of
    // loose controls in a long list — a reader hears which row they have picked
    // out, and what they may do to it.
    <div className="markings-correct" role="group" aria-label={groupLabel}>
      <label className="markings-correct-time">
        <span className="markings-correct-label">Time</span>
        <input
          key={seed}
          type="text"
          className="markings-row-time"
          defaultValue={time}
          aria-label={fieldLabel}
          // The caret has arrived: this row holds the block, and the panel stops
          // following the playhead until it leaves (T64). Focus is the whole of
          // the gesture — a nudge-button click is deliberately not one, because
          // Safari on macOS does not focus a button on click, and the same
          // gesture would pin there and not in Chrome.
          onFocus={onPin}
          onBlur={(event) => {
            const field = event.currentTarget;
            // Nothing typed is nothing to commit — and re-committing the time
            // the row holds would only re-validate a time already accepted.
            if (field.value === time) return;
            // The panel writes the honest value back: the exact time when the
            // domain took it, the unchanged stored one when it did not — so the
            // field never shows a time the record does not hold.
            field.value = onTime(field.value);
          }}
          onKeyDown={(event) => {
            // Enter commits by leaving the field — one commit path, not two.
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </label>
      {/* The controls are named by what they show, not by a label of their own:
          the row they correct is already the name of the group around them, and
          a name that replaced the visible text would leave the button
          unaddressable by the words on it. */}
      <button
        type="button"
        className="markings-nudge"
        title="Shift-click to nudge a whole second"
        onClick={(event) =>
          onNudge(event.shiftKey ? -NUDGE_COARSE_STEP_SECONDS : -NUDGE_STEP_SECONDS)
        }
      >
        −0.1s
      </button>
      <button
        type="button"
        className="markings-nudge"
        title="Shift-click to nudge a whole second"
        onClick={(event) => onNudge(event.shiftKey ? NUDGE_COARSE_STEP_SECONDS : NUDGE_STEP_SECONDS)}
      >
        +0.1s
      </button>
      {error !== null && (
        // The domain's own sentence, inside the block that holds the field that
        // caused it.
        <p role="alert" className="markings-row-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface MovementCorrectionProps {
  movement: Movement;
  duration: number;
  authoring: MarkersAuthoring;
}

/**
 * The movement being re-timed (T59): its own correction block, over its start.
 *
 * What the domain refuses here is not a nonsense time, as it is for a mark, but
 * a real one that lands on or past a neighbour — and its guidance says which
 * movement is in the way. The block shows it, because that is where the field
 * that caused it is.
 */
function MovementCorrection({ movement, duration, authoring }: MovementCorrectionProps) {
  return (
    <CorrectionBlock
      groupLabel={`Re-time movement ${movement.name}`}
      fieldLabel={`Time for movement ${movement.name}`}
      time={formatTime(movement.start, duration)}
      seed={movement.start}
      error={
        authoring.movementTimeError?.movementId === movement.id
          ? authoring.movementTimeError.message
          : null
      }
      onTime={(text) => authoring.onMovementTime(movement, text)}
      onNudge={(delta) => authoring.onNudgeMovement(movement, delta)}
      // The pin names the row the caret is in, and this block is the boundary's
      // (T64) — a movement is a marker's peer, so its boundary is pinned exactly
      // as a mark's row is.
      onPin={() => authoring.onPin(movement.id)}
    />
  );
}

interface MarkerRowProps {
  marker: LabeledMarker;
  /** Whether the playhead has passed this mark — the tint, which the block does not follow. */
  passed: boolean;
  /**
   * Whether this row carries the correction block (T64) — the active row, or the
   * row a caret is holding it on. The two are told apart because they are two
   * facts: the playhead may have moved on while a time is being typed, and the
   * row being typed into keeps the block and the highlight both.
   *
   * It is also the whole of what makes the row a *form* (T69): the alias is a
   * field on this row and text on every other, because being the row the student
   * is working on is the one thing that may put a control in a list of them. A
   * mark's name can therefore only be edited where its time can, and a surface
   * that supplies `authoring` without ever setting `blockRowId` offers no way to
   * name a mark at all — the panel has one gate for both, and this is it.
   */
  carrying: boolean;
  /** The recording's length — the row's clock divides by it. */
  duration: number;
  onSeek(marker: LabeledMarker): void;
  /** What the panel may do to its marks, when the markings page supplies it. */
  authoring?: MarkersAuthoring;
}

/**
 * One marker's row, in one of two shapes. On the browsing surfaces it is the
 * seek control alone, as it has always been: one button wrapping `label —
 * alias` and the clock. On the markings page (T56, T67) it is a container
 * holding the two things a mark is read by as seek controls of their own —
 * the label and the clock — with the two that change it beside them: the alias
 * field, and the delete control, a trash glyph since T66 with the word it
 * replaced surviving as the control's name.
 *
 * **The container is what makes the rest of this page possible** (T67): an
 * input cannot live inside a button, so an alias and a time field cannot sit
 * between the label and the clock while one button spans them. For a reader
 * nothing changes — the row is still clickable anywhere, and a click still
 * jumps to the mark — but the row is now a row *with* controls in it rather
 * than a row that *is* a control.
 *
 * An editable row shows its derived label on its own rather than the browsing
 * rows' `label — alias`, because the alias is the row's own beside it —
 * printing it twice would read as two different facts about one mark.
 *
 * **The alias is text until its row is active** (T69), and a field on the row
 * the playhead is on: a row is a line of a table of contents until it is the
 * line being worked on, and a form only then. The two shapes are one slot of
 * one rendered size, so nothing in the row moves as the playhead arrives on it,
 * and the slot is there whether or not the mark has a name — it is what holds
 * the clock off the label. A name is read where the label is, because the two
 * things that name a mark belong together rather than at opposite ends of the
 * row with the clock wedged between them.
 *
 * The alias field is uncontrolled and commits on leaving it (or on Enter,
 * which is the same thing): the marker's stored alias is what the field is
 * seeded with, and what it is put back to when the domain refuses the text.
 *
 * The row the block is on (T57, T64) grows it under the row — the mark's exact
 * time, editable, and the two nudge controls, all of it `CorrectionBlock`, which
 * also serves a movement's boundary. It is a sibling of the row container and
 * not part of it, so the decks are the correction's own surface: a click on one
 * of their controls is that control's, and never the row's. Everything else
 * about the row is unchanged, so the mark being corrected is still read, and
 * still jumped to, as the mark it was a moment ago.
 */
function MarkerRow({ marker, passed, carrying, duration, onSeek, authoring }: MarkerRowProps) {
  const storedAlias = marker.aliases[0] ?? '';
  const aliasError =
    authoring !== undefined && authoring.aliasError?.markerId === marker.id
      ? authoring.aliasError.message
      : null;
  // Formatted only for the one row that renders it. The panel re-renders on
  // every playhead tick, and every row it draws is a row it may draw again a
  // moment later; formatting each mark's exact time for rows with no field to
  // put it in would be that work multiplied by the whole project, per tick.
  /** The mark's exact time, the way the correction field reads and writes it. */
  const exactTime = carrying ? formatTime(marker.time, duration) : '';
  const timeError =
    authoring !== undefined && carrying && authoring.timeError?.markerId === marker.id
      ? authoring.timeError.message
      : null;
  const classes = `${passed ? ' passed' : ''}${carrying ? ' correcting' : ''}`.trim();
  const clock = formatWholeSeconds(marker.time, duration);

  /**
   * The jump either shape of the row makes when one of its own seek controls is
   * clicked. The click is the jump and only the jump: seeking lands the playhead
   * on this mark, which is the whole of what makes the row the active one, and
   * the active row is the one carrying the block (T64) — so the click needs no
   * separate word to say which row is being corrected.
   *
   * The control gives the focus up afterwards, because it is a pointer target
   * and not a focus stop: left focused, the next Space would re-activate it —
   * jumping back to the row just clicked — instead of meaning play/pause.
   */
  const seek = (event: MouseEvent<HTMLButtonElement>): void => {
    onSeek(marker);
    event.currentTarget.blur();
  };

  return (
    <li
      className={classes === '' ? undefined : classes}
      aria-current={carrying ? 'true' : undefined}
      // The caret leaving the row's own fields is what hands the row back to
      // the playhead (T64, T69). Both of them are in here — the alias and the
      // time — so the rule is the row's own rather than either field's, and
      // stepping from one to the other is one edit, not two.
      onBlur={(event) => {
        if (caretLeftTheRow(event.currentTarget, event.relatedTarget)) {
          authoring?.onReleasePin();
        }
      }}
    >
      {authoring === undefined ? (
        <button
          type="button"
          tabIndex={-1}
          className="player-marker-row"
          onClick={seek}
          title={
            marker.aliases.length > 0
              ? `${marker.label} — ${marker.aliases.join(', ')}`
              : marker.label
          }
        >
          <span className="player-marker-title">
            {marker.aliases.length === 0 ? marker.label : `${marker.label} — ${marker.aliases[0]}`}
          </span>
          <span className="player-marker-time">{clock}</span>
        </button>
      ) : (
        // The markings page's row (T67): the label and the clock are seek
        // controls of their own, and every other pixel of the row — the space
        // between its controls and the row's own padding — moves the playhead
        // to the mark as well, so a student still never has to aim.
        <div
          className="markings-row"
          onClick={(event) => {
            // A control in the row keeps its own click: a field takes the
            // caret, the delete control deletes. The guard walks up from the
            // click's target rather than reading that target's own tag name,
            // because a click need not land on the control itself — the delete
            // control's glyph puts a `<path>` under the pointer (T66), and no
            // tag name for the control would catch it.
            if (
              (event.target as HTMLElement).closest('input, button, select, textarea') !== null
            ) {
              return;
            }
            onSeek(marker);
          }}
        >
          <button
            type="button"
            tabIndex={-1}
            className="player-marker-title"
            title={`Jump to ${marker.label}`}
            onClick={seek}
          >
            {marker.label}
          </button>
          {carrying ? (
            <input
              type="text"
              className="markings-alias-slot markings-row-alias"
              defaultValue={storedAlias}
              aria-label={`Alias for marker ${marker.label}`}
              // The caret is in the row's own field, so the row is the one being
              // worked on whatever the playhead does next (T64, T69) — the twin
              // of the same gesture in the time field, and the reason a name
              // half-typed is not unmounted by the next mark going by.
              onFocus={() => authoring.onPin(marker.id)}
              onBlur={(event) => {
                const field = event.currentTarget;
                // Nothing typed is nothing to commit — and re-committing the
                // stored alias would only re-validate text already accepted.
                if (field.value === storedAlias) return;
                // The panel writes the honest value back: the normalized alias
                // when the domain took it, the unchanged stored one when it did
                // not — so the field never shows text the record does not hold.
                field.value = authoring.onAlias(marker, field.value);
              }}
              onKeyDown={(event) => {
                // Enter commits by leaving the field — one commit path, not two.
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          ) : (
            // The name as it is read (T69): plain text, in the slot the field
            // will occupy, so the row is a line of a list of contents until the
            // playhead lands on it and a form only then. It is rendered
            // whether or not the mark has a name: the slot is what holds the
            // clock off the label, so a row without one keeps the same gap
            // rather than bunching its clock and its trash against the label.
            //
            // The title carries the whole name, as the browsing row's own span
            // carries the whole reading: at the panel's floor the slot ellipsises
            // a long name, and a student should not have to make the row active —
            // which moves the recording to it — to read the rest of it.
            <span className="markings-alias-slot" title={storedAlias === '' ? undefined : storedAlias}>
              {storedAlias}
            </span>
          )}
          <button
            type="button"
            tabIndex={-1}
            className="player-marker-time"
            title={`Jump to ${marker.label}`}
            onClick={seek}
          >
            {clock}
          </button>
          <DeleteControl
            label={`Delete marker ${marker.label}`}
            onDelete={() => authoring.onDelete(marker)}
          />
        </div>
      )}
      {aliasError !== null && (
        <p role="alert" className="markings-row-error">
          {aliasError}
        </p>
      )}
      {carrying && authoring !== undefined && (
        <CorrectionBlock
          groupLabel={`Correct marker ${marker.label}`}
          fieldLabel={`Time for marker ${marker.label}`}
          time={exactTime}
          seed={marker.time}
          error={timeError}
          onTime={(text) => authoring.onTime(marker, text)}
          onNudge={(delta) => authoring.onNudge(marker, delta)}
          onPin={() => authoring.onPin(marker.id)}
        />
      )}
    </li>
  );
}
