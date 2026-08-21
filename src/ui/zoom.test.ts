import { describe, expect, it } from 'vitest';
import {
  ZOOM_FLOOR_PX_PER_SEC,
  ZOOM_MAX_PX_PER_SEC,
  clampPxPerSec,
  clampScrollLeft,
  contentWidth,
  minPxPerSec,
  scrollLeftForTime,
  wheelNotches,
  zoomAround,
} from './zoom';

/**
 * T08 zoom math, test-first. The invariants:
 * — the zoom level never goes below the ~5–10 px/s floor (nor above the cap);
 * — the floor gives way to fit-to-view for recordings short enough to exceed it;
 * — zooming around a cursor keeps the recording time under that cursor fixed;
 * — scroll never exceeds the content's edges;
 * — click→time mapping accounts for zoom and scroll exactly.
 */

const VIEWPORT = 1200;

describe('minPxPerSec', () => {
  it('is the 8 px/s floor for long recordings, where fitting is coarser', () => {
    // 25 minutes: fit is 0.8 px/s — below the floor.
    expect(minPxPerSec(VIEWPORT, 1500)).toBe(ZOOM_FLOOR_PX_PER_SEC);
  });

  it('is fit-to-view for recordings short enough to exceed the floor', () => {
    // 30 seconds fits at 40 px/s — zooming out stops where the whole
    // recording is visible, never narrower content than the floor.
    expect(minPxPerSec(VIEWPORT, 30)).toBe(40);
  });

  it('is the floor when the duration is unknown', () => {
    expect(minPxPerSec(VIEWPORT, 0)).toBe(ZOOM_FLOOR_PX_PER_SEC);
  });
});

describe('clampPxPerSec', () => {
  it('passes levels inside the range through', () => {
    expect(clampPxPerSec(64, VIEWPORT, 1500)).toBe(64);
  });

  it('never lets the level drop below the floor', () => {
    expect(clampPxPerSec(1, VIEWPORT, 1500)).toBe(ZOOM_FLOOR_PX_PER_SEC);
  });

  it('never lets a short recording zoom out past fit-to-view', () => {
    expect(clampPxPerSec(20, VIEWPORT, 30)).toBe(40);
  });

  it('caps the level at the maximum', () => {
    expect(clampPxPerSec(100_000, VIEWPORT, 1500)).toBe(ZOOM_MAX_PX_PER_SEC);
  });

  it('lets a very short clip fit above the ceiling and still zoom in past it', () => {
    // A 3 s clip fits at 400 px/s — above the 256 ceiling. The range must
    // include fit, and zooming in stays possible beyond it.
    expect(clampPxPerSec(500, VIEWPORT, 3)).toBe(500);
    expect(clampPxPerSec(100, VIEWPORT, 3)).toBe(400); // never below fit
    expect(clampPxPerSec(100_000, VIEWPORT, 3)).toBe(400 * 64); // 64× fit cap
  });
});

describe('contentWidth', () => {
  it('is the level times the duration', () => {
    expect(contentWidth(8, 123.456)).toBe(987.648);
  });

  it('is zero when the duration is unknown', () => {
    expect(contentWidth(8, 0)).toBe(0);
  });
});

describe('clampScrollLeft', () => {
  it('passes in-range scroll through', () => {
    expect(clampScrollLeft(400, VIEWPORT, 1500, 8)).toBe(400);
  });

  it('never scrolls before the start', () => {
    expect(clampScrollLeft(-50, VIEWPORT, 1500, 8)).toBe(0);
  });

  it('never scrolls past the content end', () => {
    // 8 px/s × 1500 s = 12000 px of content; 10800 px is the last visible pixel.
    expect(clampScrollLeft(50_000, VIEWPORT, 1500, 8)).toBe(10_800);
  });

  it('never scrolls when the content fits the viewport', () => {
    expect(clampScrollLeft(100, VIEWPORT, 30, 40)).toBe(0);
  });
});

describe('zoomAround', () => {
  it('keeps the recording time under the cursor fixed while zooming in', () => {
    // View: 1500 s recording, 8 px/s, scrolled 1000 px. Cursor 300 px in.
    // The time under the cursor is (1000 + 300) / 8 = 162.5 s.
    const view = zoomAround(
      { pxPerSec: 8, scrollLeft: 1000 },
      2,
      300,
      VIEWPORT,
      1500,
    );
    expect(view.pxPerSec).toBe(16);
    // (newScrollLeft + 300) / 16 === 162.5  →  newScrollLeft = 2300
    expect(view.scrollLeft).toBe(2300);
    expect((view.scrollLeft + 300) / view.pxPerSec).toBe(162.5);
  });

  it('keeps the time fixed while zooming out too', () => {
    const view = zoomAround(
      { pxPerSec: 64, scrollLeft: 4000 },
      0.5,
      200,
      VIEWPORT,
      1500,
    );
    expect(view.pxPerSec).toBe(32);
    expect((view.scrollLeft + 200) / view.pxPerSec).toBe((4000 + 200) / 64);
  });

  it('clamps the level at the floor; the anchored time then gives way to the clamp', () => {
    const view = zoomAround({ pxPerSec: 8, scrollLeft: 0 }, 0.1, 100, VIEWPORT, 1500);
    expect(view.pxPerSec).toBe(ZOOM_FLOOR_PX_PER_SEC);
    expect(view.scrollLeft).toBe(clampScrollLeft(view.scrollLeft, VIEWPORT, 1500, view.pxPerSec));
  });

  it('clamps the scroll at the content edges while zooming near them', () => {
    // Zoom out at the very start: the anchored scroll would go negative.
    const view = zoomAround({ pxPerSec: 32, scrollLeft: 0 }, 0.5, 0, VIEWPORT, 1500);
    expect(view.pxPerSec).toBe(16);
    expect(view.scrollLeft).toBe(0);
  });
});

describe('scrollLeftForTime', () => {
  it('centers the target when the content allows', () => {
    // 8 px/s: 600 s sits at 4800 px; centered means 4800 − 600 = 4200.
    expect(scrollLeftForTime(600, VIEWPORT, 1500, 8)).toBe(4200);
  });

  it('pins to the start for times near the beginning', () => {
    expect(scrollLeftForTime(10, VIEWPORT, 1500, 8)).toBe(0);
  });

  it('pins to the end for times near the end', () => {
    // 1500 s at 8 px/s: content end is 12000; last visible pixel is 10800.
    expect(scrollLeftForTime(1490, VIEWPORT, 1500, 8)).toBe(10_800);
  });
});

describe('wheelNotches', () => {
  it('turns a mouse notch (~100 px) into a two-notch zoom step', () => {
    // Tuned below the mouse wheel's raw delta so a trackpad's fine-grained
    // deltas still accumulate into a real zoom.
    expect(wheelNotches(100, 0)).toBe(2);
    expect(wheelNotches(-25, 0)).toBe(-0.5);
  });

  it('normalizes line-mode deltas (Firefox)', () => {
    expect(wheelNotches(3, 1)).toBe(1);
    expect(wheelNotches(-6, 1)).toBe(-2);
  });

  it('treats a page as one notch', () => {
    expect(wheelNotches(1, 2)).toBe(1);
  });
});
