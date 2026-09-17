import { describe, expect, it } from 'vitest';
import type { RevealGeometry } from './revealScroll';
import { revealDelay, revealScroll } from './revealScroll';

/**
 * A list 320px tall (its band spans viewport y 100–420) holding 1000px of rows,
 * with the row under the playhead already at the band's top. Each case moves
 * the one number it is about.
 */
function geometry(overrides: Partial<RevealGeometry> = {}): RevealGeometry {
  return {
    scrollTop: 0,
    clientHeight: 320,
    scrollHeight: 1000,
    listTop: 100,
    rowTop: 100,
    headerInset: 0,
    ...overrides,
  };
}

describe('revealScroll', () => {
  it('leaves the list alone when the row is already at the top', () => {
    // The common case during playback within one marker: the effect re-runs on
    // the active row, and that row is already where it belongs.
    expect(revealScroll(geometry({ scrollTop: 250, rowTop: 100 }))).toBe(250);
  });

  it('scrolls the row up to the top of the band, not just into view', () => {
    // The row is visible — 60px into the band — but the reveal is not "make it
    // visible": a row parked at the bottom edge is the one place the reader
    // can least see what is coming next.
    expect(revealScroll(geometry({ scrollTop: 100, rowTop: 160 }))).toBe(160);
  });

  it('scrolls down to a row below the band', () => {
    expect(revealScroll(geometry({ rowTop: 450 }))).toBe(350);
  });

  it('scrolls up to a row above the band', () => {
    expect(revealScroll(geometry({ scrollTop: 400, rowTop: 50 }))).toBe(350);
  });

  it('insets the band by the sticky header the row will sit under', () => {
    // Without the inset the row would be revealed behind its own pinned
    // movement header — the reveal would appear not to have happened. The
    // un-inset answer here would be 140, so the 35px header is visible in it.
    expect(revealScroll(geometry({ rowTop: 240, headerInset: 35 }))).toBe(105);
  });

  it('stops at the end of the list when the row cannot reach the top', () => {
    // The last rows have nothing below them to scroll with: the list stops at
    // its end rather than scrolling past it.
    expect(revealScroll(geometry({ scrollTop: 600, rowTop: 980 }))).toBe(680);
  });

  it('never scrolls before the start of the list', () => {
    expect(revealScroll(geometry({ scrollTop: 10, rowTop: -200 }))).toBe(0);
  });

  it('has nowhere to scroll when the rows fit the list', () => {
    // The degenerate geometry — a list shorter than its own box, or the
    // all-zero rects jsdom reports — is total rather than a divide-by-nothing.
    expect(revealScroll(geometry({ clientHeight: 1000, scrollHeight: 1000, rowTop: 900 }))).toBe(0);
  });
});

describe('revealDelay', () => {
  const GRACE = 3000;

  it('reveals at once when the reader has never scrolled the list', () => {
    expect(revealDelay(null, 1_000, GRACE)).toBe(0);
  });

  it('reveals at once once the grace period has passed', () => {
    // A millisecond past the grace, where the arithmetic is −1: the clamp is
    // what makes the answer 0 rather than a negative delay.
    expect(revealDelay(1_000, 4_001, GRACE)).toBe(0);
  });

  it('waits out the rest of the grace period mid-window', () => {
    expect(revealDelay(1_000, 2_500, GRACE)).toBe(1_500);
  });

  it('waits the whole period immediately after a scroll', () => {
    expect(revealDelay(1_000, 1_000, GRACE)).toBe(GRACE);
  });

  it('reveals rather than waiting on a scroll the clock has not reached yet', () => {
    // The stamp is 4s in the reader's future — the wall clock stepped
    // backwards after they scrolled. Waiting on it would hold the panel still
    // for however far the clock moved; the reveal resumes instead, and the
    // reader's next scroll re-arms the period.
    expect(revealDelay(5_000, 1_000, GRACE)).toBe(0);
  });
});
