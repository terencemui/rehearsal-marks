import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { LabeledMarker } from '../domain';
import type { Movement } from '../domain';
import { movementForTime } from '../domain';
import { formatWholeSeconds } from '../domain/time';
import { revealDelay, revealScroll } from './revealScroll';

/**
 * How long the panel leaves the list alone after the reader has scrolled it by
 * hand. Long enough to read a few rows, short enough that the list does not
 * feel stuck once they stop.
 */
const MANUAL_SCROLL_GRACE_MS = 3000;

/**
 * The panel's editing surface (T56). Supplied only by the markings page, where
 * a mark can be placed, named and removed; absent on the practice surface and
 * the read-only public view, which then carry no control that could change a
 * mark. There is deliberately no "selected marker" here — the page edits every
 * row in place, so nothing has to be selected first.
 */
export interface MarkersAuthoring {
  /** Places a mark at the playhead. */
  onAdd(): void;
  /** Whether the recording's load has settled — the Add control is inert until it has. */
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
   * The active marker's id — the most recently passed marker, or null before
   * the first mark (the recording's Start has no marker of its own).
   */
  activeId: string | null;
  /** A row was clicked. The player jumps to the marker — never selects. */
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
   * What the panel may do to its marks, supplied only by the markings page
   * (T56). Present, the rows carry the alias field and the delete control and
   * the head carries Add marker; absent, the panel is the browsing list the
   * practice surface and the read-only view have always shown.
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

export interface AddMarkerControlProps {
  /** Places a mark at the playhead. */
  onAdd(): void;
  /** Whether the recording has settled; the control is inert until it has. */
  addDisabled: boolean;
}

/**
 * The pointer's way to do what `M` does (T56). Marking is a listening pass and
 * the key is what keeps the hands on the recording, but the key alone would
 * make the column's whole purpose unreachable without a keyboard — so the same
 * action exists where the marks land, inert until the playhead means something.
 */
export function AddMarkerControl({ onAdd, addDisabled }: AddMarkerControlProps) {
  return (
    <button type="button" className="markings-add" onClick={onAdd} disabled={addDisabled}>
      Add marker
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
 */
function groupMarkers(
  markers: readonly LabeledMarker[],
  movements: readonly Movement[],
): MarkerGroup[] {
  const groups = movements.map((movement) => ({ movement, markers: [] as LabeledMarker[] }));
  const byId = new Map(movements.map((movement) => [movement.id, movement]));
  const leading = { movement: null, markers: [] as LabeledMarker[] };
  for (const marker of markers) {
    const movement = movementForTime(movements, marker.time);
    const group =
      movement !== null ? groups.find((g) => g.movement === byId.get(movement.id)) : undefined;
    (group ?? leading).markers.push(marker);
  }
  const filled = groups.filter((g) => g.markers.length > 0);
  return leading.markers.length > 0 ? [leading, ...filled] : filled;
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
 * (T38). The row holding the playhead is highlighted; the panel scrolls when
 * the list outgrows its band — the player measures that band against the
 * video's bottom, so a marker-heavy project never towers past the recording.
 * Rows are click-to-jump surfaces, not tab stops — keyboard users walk the
 * marks with ↑/↓ — and the panel is pure navigation: clicking seeks, never
 * selects.
 *
 * The panel follows the playhead: whenever the active row changes, the list
 * scrolls so that row sits at the top of its band. That covers a deliberate
 * jump — a row, a header, a bar click, an arrow key, the embedded player's own
 * controls — and playback simply crossing a boundary, because all of them
 * arrive the same way, as the playhead moving. The reader is the one brake: a
 * hand scroll buys the list a few seconds of being left alone
 * (`MANUAL_SCROLL_GRACE_MS`), restarted by any further scroll while a reveal
 * is waiting — and a scroll with nothing waiting keeps the list outright,
 * until the playhead moves again.
 *
 * A movement header's jump therefore reveals the marker the seek actually
 * landed on, which is the last marker *before* the movement rather than the
 * movement's own first row: that is the row holding the playhead, and the
 * header the reader clicked sits directly under it, both visible together.
 * Revealing the header itself would put the highlight off-band instead.
 *
 * With movements (ADR-0005) the rows group under sticky, scroll-driven
 * movement headers that pin to the list's top and swap as the next movement's
 * group scrolls into place; clicking a header seeks to the movement's start.
 * Without them the panel is the flat list it always was.
 *
 * Given an `authoring` surface (T56) the panel becomes the markings page's own column:
 * rows carry the alias field and the delete control, and the head carries Add
 * marker. The list itself is untouched — the same grouping, the same derived
 * labels, the same follow-the-playhead reveal — because the marks a student
 * edits are the marks they were reading a moment ago.
 */
export function MarkersPanel({
  markers,
  // Records saved before movements existed (ADR-0005) read the field back as
  // undefined — default it to the empty, ungrouped list the contract describes.
  movements = [],
  duration,
  activeId,
  onSeek,
  onSeekMovement,
  maxHeight,
  markingsHref,
  authoring,
}: MarkersPanelProps) {
  const listRef = useRef<HTMLOListElement>(null);
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
  // rather than through a ref onto the active `<li>`: the query cannot read a
  // stale row, and it keeps working when the active id moves to a different
  // row.
  const reveal = useCallback((): void => {
    const list = listRef.current;
    if (list === null) return;
    const row = list.querySelector<HTMLElement>('li.active');
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
   * lands on the row holding the playhead *then* — which may be several
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
  // frame the new active row renders, or the panel visibly jumps twice. Keyed
  // on the active row, which is what makes the panel follow the playhead
  // however the playhead moved — including a seek made in the embedded
  // player's own controls, which nothing in this app sees as a jump.
  useLayoutEffect(() => {
    scheduleReveal();
    return () => {
      window.clearTimeout(pendingRevealRef.current);
      pendingRevealRef.current = undefined;
    };
  }, [activeId, scheduleReveal]);

  if (markers.length === 0) return null;
  const hasMovements = movements.length > 0;
  const groups = groupMarkers(markers, movements);

  return (
    <section className="player-markers" aria-label="Markers">
      <MarkersHead>
        {authoring !== undefined ? (
          // The page's own control (T56): the head of the column the mark
          // lands in, so placing one is where the list is.
          <AddMarkerControl onAdd={authoring.onAdd} addDisabled={authoring.addDisabled} />
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
        {groups.flatMap(({ movement, markers: groupMarkers }) => [
          hasMovements && (
            <li
              key={movement ? `movement-${movement.id}` : 'before-first-movement'}
              className="player-marker-movement"
            >
              {movement ? (
                <button
                  type="button"
                  className="player-movement-header"
                  onClick={() => onSeekMovement(movement)}
                  title={`Jump to ${movement.name}`}
                >
                  <span className="player-movement-name">{movement.name}</span>
                  <span className="player-marker-time">
                    {formatWholeSeconds(movement.start, duration)}
                  </span>
                </button>
              ) : (
                <div className="player-movement-header" aria-hidden="true">
                  <span className="player-movement-name">Before the first movement</span>
                </div>
              )}
            </li>
          ),
          ...groupMarkers.map((marker) => (
            <MarkerRow
              key={marker.id}
              marker={marker}
              active={marker.id === activeId}
              duration={duration}
              onSeek={onSeek}
              authoring={authoring}
            />
          )),
        ])}
      </ol>
    </section>
  );
}

interface MarkerRowProps {
  marker: LabeledMarker;
  /** Whether this row holds the playhead. */
  active: boolean;
  /** The recording's length — the row's clock divides by it. */
  duration: number;
  onSeek(marker: LabeledMarker): void;
  /** What the panel may do to its marks, when the markings page supplies it. */
  authoring?: MarkersAuthoring;
}

/**
 * One marker's row. On the browsing surfaces it is the seek control alone, as
 * it has always been. On the markings page (T56) the same seek control is
 * joined by the two things that change a mark: the alias field, and Delete.
 *
 * An editable row shows its derived label on its own rather than the browsing
 * rows' `label — alias`, because the alias is the field beside it — printing
 * it twice would read as two different facts about one mark.
 *
 * The alias field is uncontrolled and commits on leaving it (or on Enter,
 * which is the same thing): the marker's stored alias is what the field is
 * seeded with, and what it is put back to when the domain refuses the text.
 */
function MarkerRow({ marker, active, duration, onSeek, authoring }: MarkerRowProps) {
  const storedAlias = marker.aliases[0] ?? '';
  const aliasError =
    authoring !== undefined && authoring.aliasError?.markerId === marker.id
      ? authoring.aliasError.message
      : null;

  const seek = (
    <button
      type="button"
      tabIndex={-1}
      className="player-marker-row"
      onClick={(event) => {
        onSeek(marker);
        // The row is a pointer target, not a focus stop: leaving focus on it
        // would make the next Space re-activate the row (jump back to it)
        // instead of meaning play/pause.
        event.currentTarget.blur();
      }}
      title={
        marker.aliases.length > 0 ? `${marker.label} — ${marker.aliases.join(', ')}` : marker.label
      }
    >
      <span className="player-marker-title">
        {authoring !== undefined || marker.aliases.length === 0
          ? marker.label
          : `${marker.label} — ${marker.aliases[0]}`}
      </span>
      <span className="player-marker-time">{formatWholeSeconds(marker.time, duration)}</span>
    </button>
  );

  return (
    <li className={active ? 'active' : undefined}>
      {authoring === undefined ? (
        seek
      ) : (
        <div className="markings-row">
          {seek}
          <input
            type="text"
            className="markings-row-alias"
            defaultValue={storedAlias}
            placeholder="alias"
            aria-label={`Alias for marker ${marker.label}`}
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
          <button
            type="button"
            className="markings-row-delete"
            aria-label={`Delete marker ${marker.label}`}
            onClick={() => authoring.onDelete(marker)}
          >
            Delete
          </button>
        </div>
      )}
      {aliasError !== null && (
        <p role="alert" className="markings-row-error">
          {aliasError}
        </p>
      )}
    </li>
  );
}
