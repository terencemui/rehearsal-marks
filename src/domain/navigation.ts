import type { LabeledMarker } from './marker';

/**
 * Keyboard navigation over markers: the pure policy behind the ↑/↓ and A–Z
 * jumps. All three functions take markers in time order — the shape
 * `deriveLabels` returns — and return the target marker, or null when there
 * is nothing to jump to. They never mutate; jumping is a read.
 *
 * The playhead anchors arrow jumps. A seek lands on a media frame boundary —
 * up to one MP3 frame (~26ms) off the requested time — so each comparison
 * tolerates one frame in the walk direction: the playhead within a frame of
 * a marker counts as having reached it, and the next press moves on. That is
 * what makes repeated presses walk the sequence instead of stalling (or,
 * worse, coin-flipping back) on a frame-snapped position. A cluster of
 * markers sharing one time is skipped past as a group — the letter keys
 * reach each of them individually.
 */

/** One media frame of tolerance, in seconds: an MP3 frame is ~26ms. */
const FRAME_EPSILON = 0.05;

/** The next marker after `time` in time order; wraps to the first. */
export function nextMarker(
  markers: readonly LabeledMarker[],
  time: number,
): LabeledMarker | null {
  const target = markers.find((marker) => marker.time > time + FRAME_EPSILON);
  return target ?? markers[0] ?? null;
}

/** The previous marker before `time` in time order; wraps to the last. */
export function previousMarker(
  markers: readonly LabeledMarker[],
  time: number,
): LabeledMarker | null {
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i];
    if (marker.time < time - FRAME_EPSILON) return marker;
  }
  return markers[markers.length - 1] ?? null;
}

/**
 * The marker whose derived label equals the given letter, case-insensitively.
 * Single letters reach labels A–Z; labels past Z (AA, AB, …) are arrow-only.
 */
export function markerForLetter(
  markers: readonly LabeledMarker[],
  letter: string,
): LabeledMarker | null {
  return markers.find((marker) => marker.label === letter.toUpperCase()) ?? null;
}
