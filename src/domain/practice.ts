import type { LabeledMarker } from './marker';
import { FRAME_EPSILON } from './navigation';

/**
 * The practice readout's pure policy: what the right-hand pane says at a
 * given playhead. Given markers in time order (the shape `deriveLabels`
 * returns), the recording duration, and the live playhead, it derives the
 * most recently passed marker (or **Start** before the first mark), the next
 * marker (or **End** after the last mark), and the progress between the two
 * slots' anchor times.
 *
 * The passed/next boundary is the arrow jumps' own: a marker within one media
 * frame of the playhead counts as reached, exactly as `nextMarker` skips it —
 * so a frame-snapped seek lands the readout on the same boundary the
 * keyboard trusts. The bar never wraps: after the last mark it runs toward
 * the recording's end, and it fills only as the playhead actually advances
 * toward its target.
 */

/** The passed slot's anchor, when no marker has been reached yet: Start. */
const START_TIME = 0;

/** A snapshot of the readout at one playhead position. */
export interface PracticeReadout {
  /**
   * The most recently passed marker — null before the first mark, where the
   * left slot reads Start.
   */
  passed: LabeledMarker | null;
  /** The passed slot's anchor time: the marker's time, or 0 for Start. */
  passedTime: number;
  /**
   * The next marker — null after the last mark, where the right slot reads
   * End with the recording's duration.
   */
  next: LabeledMarker | null;
  /** The next slot's anchor time: the marker's time, or the duration for End. */
  nextTime: number;
  /** The playhead's progress from the passed anchor toward the next, 0–1. */
  progress: number;
}

/**
 * The index in `markers` of the last marker the playhead has reached, or -1
 * before the first. Markers must be in time order (as `deriveLabels` returns).
 *
 * The one rule behind two readings of the same playhead: the readout's
 * passed/next split, and the markings page's active row (ADR-0007, amended
 * 2026-09-24) — so it is written here once rather than restated by each.
 */
export function passedIndex(markers: readonly LabeledMarker[], time: number): number {
  // The most recently reached marker: the last one within a frame of the
  // playhead, walking forward. The break on the first non-reached marker
  // keeps a same-time cluster passing as a group.
  let index = -1;
  for (let i = 0; i < markers.length; i += 1) {
    if (markers[i].time <= time + FRAME_EPSILON) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

/**
 * Computes the practice readout at `time`. Markers must be in time order
 * (as `deriveLabels` returns). A playhead beyond the recording — a trailing
 * position the store can report after the media has ended — clamps to the
 * recording's end, so the bar can never exceed it.
 */
export function practiceReadout(
  markers: readonly LabeledMarker[],
  time: number,
  duration: number,
): PracticeReadout {
  const reached = passedIndex(markers, time);

  const passed = reached >= 0 ? markers[reached] : null;
  const next = reached + 1 < markers.length ? markers[reached + 1] : null;
  const passedTime = passed?.time ?? START_TIME;
  const nextTime = next?.time ?? duration;

  const span = nextTime - passedTime;
  let progress: number;
  if (span > 0) {
    progress = Math.min(1, Math.max(0, (time - passedTime) / span));
  } else {
    // The anchors coincide — a marker at the recording's very end, or a
    // zero-length recording. The playhead is within a frame of the anchor by
    // construction, so on a real recording the segment is complete: full.
    // With no recording to practice, there is nothing to fill.
    progress = duration > 0 ? 1 : 0;
  }

  return { passed, passedTime, next, nextTime, progress };
}
