import type { LabeledMarker } from './marker';
import type { Movement } from './movement';
import { FRAME_EPSILON } from './navigation';
import { passedIndex } from './practice';

/**
 * The row the playhead is on (ADR-0007, amended 2026-09-24): the movement
 * boundary it is sitting on, or — failing that — the marker it has last
 * passed. The markings page puts its correction controls on whichever row
 * this names, which is why the row is derived here rather than picked out
 * there: nothing can be left aimed at a row that has gone, and placing a mark
 * pays for itself, since the mark lands active the instant it exists.
 *
 * One rule for both kinds of row, because movements are markers' peers
 * (ADR-0007): a boundary set by ear is corrected exactly as a mark placed by
 * ear is, and a mark standing on a boundary yields the boundary rather than
 * the two needing a precedence to remember.
 *
 * "Sitting on a boundary" is the frame question `addMovement` already asks
 * when it refuses a boundary on a boundary — a boundary placed at the playhead
 * reads back off the media element, so it lands a frame or so from the time
 * that was asked for, and the same tolerance answers both. Above the first
 * mark there is no row: the recording's Start is not one.
 */
export function activeRowId(
  markers: readonly LabeledMarker[],
  movements: readonly Movement[],
  time: number,
): string | null {
  const boundary = movements.find((movement) => Math.abs(movement.start - time) <= FRAME_EPSILON);
  if (boundary !== undefined) return boundary.id;

  // The marker the playhead has passed, by the rule the readout's passed slot
  // reads — the same one, not a second copy of it.
  const reached = passedIndex(markers, time);
  return reached === -1 ? null : markers[reached].id;
}
