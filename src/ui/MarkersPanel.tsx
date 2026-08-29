import type { LabeledMarker } from '../domain';
import type { Movement } from '../domain';
import { movementForTime } from '../domain';
import { formatWholeSeconds } from '../domain/time';

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
 * With movements (ADR-0005) the rows group under sticky, scroll-driven
 * movement headers that pin to the list's top and swap as the next movement's
 * group scrolls into place; clicking a header seeks to the movement's start.
 * Without them the panel is the flat list it always was.
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
}: MarkersPanelProps) {
  if (markers.length === 0) return null;
  const hasMovements = movements.length > 0;
  const groups = groupMarkers(markers, movements);

  return (
    <section className="player-markers" aria-label="Markers">
      <h2 className="player-markers-heading">Markers</h2>
      <ol
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
            <li key={marker.id} className={marker.id === activeId ? 'active' : undefined}>
              <button
                type="button"
                tabIndex={-1}
                className="player-marker-row"
                onClick={(event) => {
                  onSeek(marker);
                  // The row is a pointer target, not a focus stop: leaving
                  // focus on it would make the next Space re-activate the row
                  // (jump back to it) instead of meaning play/pause.
                  event.currentTarget.blur();
                }}
                title={
                  marker.aliases.length > 0
                    ? `${marker.label} — ${marker.aliases.join(', ')}`
                    : marker.label
                }
              >
                <span className="player-marker-title">
                  {marker.aliases.length > 0 ? `${marker.label} — ${marker.aliases[0]}` : marker.label}
                </span>
                <span className="player-marker-time">
                  {formatWholeSeconds(marker.time, duration)}
                </span>
              </button>
            </li>
          )),
        ])}
      </ol>
    </section>
  );
}
