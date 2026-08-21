/**
 * T08 zoom math, kept pure so the view stays a thin adapter. The player view
 * is a horizontally scrollable window over the timeline: the content is
 * `pxPerSec × duration` pixels wide, and the zoom level is the `pxPerSec`
 * itself. Zooming out never goes below the spec's ~5–10 px/s floor — except
 * that a recording short enough to fit the viewport at more than the floor
 * zooms out to fit-to-view instead, so the content is never narrower than it
 * needs to be.
 */

/** The spec's ~5–10 px/s floor: the zoomed-out minimum for long recordings. */
export const ZOOM_FLOOR_PX_PER_SEC = 8;
/** The zoomed-in ceiling: beyond ~4 ms per pixel there is nothing left to aim at. */
export const ZOOM_MAX_PX_PER_SEC = 256;
/** A short clip's fit can dwarf the ceiling; zoom-in then caps at 64× fit. */
const ZOOM_MAX_FIT_MULTIPLE = 64;
/** One wheel notch (or a pinch gesture) scales the level by this factor. */
export const ZOOM_STEP = 1.25;

/** The zoom level plus the content's scroll offset — the view in one object. */
export interface ZoomView {
  /** Pixels of content per second of recording. */
  pxPerSec: number;
  /** The content's horizontal scroll offset, px. */
  scrollLeft: number;
}

/**
 * The level at which the whole recording spans exactly the viewport — no
 * horizontal scroll, nothing off-screen. Zero for an unknown duration, which
 * cannot be fitted. This is the only level a YouTube project ever uses: the
 * video is the main item, and stretching its embed past the viewport to make
 * room for a zoomed timeline would bury it.
 */
export function fitPxPerSec(viewportWidth: number, duration: number): number {
  return duration > 0 ? viewportWidth / duration : 0;
}

/**
 * The zoomed-out limit: the ~5–10 px/s floor, or fit-to-view for recordings
 * short enough that fitting exceeds the floor. An unknown duration gets the
 * floor — nothing sensible can be fitted yet.
 */
export function minPxPerSec(viewportWidth: number, duration: number): number {
  return Math.max(ZOOM_FLOOR_PX_PER_SEC, fitPxPerSec(viewportWidth, duration));
}

/**
 * Clamps a level into the zoom range. The upper bound is the ceiling, except
 * that a recording short enough to fit the viewport at more than the ceiling
 * may zoom in past it — the range never excludes a reachable view.
 */
export function clampPxPerSec(
  pxPerSec: number,
  viewportWidth: number,
  duration: number,
): number {
  const lower = minPxPerSec(viewportWidth, duration);
  const upper = Math.max(
    ZOOM_MAX_PX_PER_SEC,
    fitPxPerSec(viewportWidth, duration) * ZOOM_MAX_FIT_MULTIPLE,
  );
  return Math.min(upper, Math.max(lower, pxPerSec));
}

/** The content's width at a level — what the flags and ruler span. */
export function contentWidth(pxPerSec: number, duration: number): number {
  return Math.max(0, pxPerSec * duration);
}

/** Clamps a scroll offset to the content: [0, contentWidth − viewportWidth]. */
export function clampScrollLeft(
  scrollLeft: number,
  viewportWidth: number,
  duration: number,
  pxPerSec: number,
): number {
  const max = Math.max(0, contentWidth(pxPerSec, duration) - viewportWidth);
  return Math.min(max, Math.max(0, scrollLeft));
}

/**
 * Applies a zoom factor around `cursorOffset` — the cursor's distance in px
 * from the viewport's left edge — so the recording time under the cursor is
 * the same before and after. The level clamps at the limits; the anchor then
 * gives way to the clamp, and the scroll never leaves the content.
 */
export function zoomAround(
  view: ZoomView,
  factor: number,
  cursorOffset: number,
  viewportWidth: number,
  duration: number,
): ZoomView {
  const pxPerSec = clampPxPerSec(view.pxPerSec * factor, viewportWidth, duration);
  // time = (scrollLeft + cursorOffset) / pxPerSec must be preserved.
  const time = (view.scrollLeft + cursorOffset) / view.pxPerSec;
  const scrollLeft = clampScrollLeft(
    time * pxPerSec - cursorOffset,
    viewportWidth,
    duration,
    pxPerSec,
  );
  return { pxPerSec, scrollLeft };
}

/**
 * The scroll offset that brings `time` into view, centered when the content
 * allows and pinned to the edges otherwise.
 */
export function scrollLeftForTime(
  time: number,
  viewportWidth: number,
  duration: number,
  pxPerSec: number,
): number {
  return clampScrollLeft(time * pxPerSec - viewportWidth / 2, viewportWidth, duration, pxPerSec);
}

/**
 * Normalizes a wheel delta to notch counts, so one physical notch zooms by
 * ZOOM_STEP regardless of how the browser reports deltas (pixels, lines, or
 * pages). The pixel divisor is tuned down from the mouse wheel's ~100 px per
 * notch: a notch then lands at ~1.6×, and a trackpad's fine-grained deltas
 * (which accumulate across a gesture) still add up to a real zoom instead of
 * dying at fractions of a notch.
 */
export function wheelNotches(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY / 3; // lines
  if (deltaMode === 2) return deltaY; // pages
  return deltaY / 50; // pixels
}
