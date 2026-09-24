/**
 * The markers panel's reveal policy: where the list should scroll to put the
 * marker holding the playhead at the top of its band, and — when the reader
 * has just scrolled the list by hand — how long to wait before it does.
 *
 * The panel follows the playhead: the current marker is kept at the top of the
 * list, both when the playhead is moved deliberately (a bar click, an arrow
 * key, the embedded player's own controls) and as playback crosses each
 * boundary. That is deliberately the one thing the panel does on its own, and
 * `revealDelay` is the brake on it.
 *
 * Which row it follows is the panel's to decide and is not here either: on the
 * markings page the row carrying the correction block (T57, T64) — the active
 * row, or the row a caret is holding the block on while a time is typed — and
 * the active row otherwise. What is left for this module is where the row goes
 * once the reveal has been decided on.
 *
 * Both functions are pure, and every number in them is a measurement the
 * caller reads off the elements or the clock. That separation is what makes
 * the policy testable: jsdom computes no layout — rects are all zero,
 * `clientHeight` and `scrollHeight` are prototype getters returning 0 — and it
 * implements no scrolling at all. `Element.scrollIntoView`, in particular,
 * does not exist in jsdom, so every test that clicks a marker row or presses
 * an arrow key would throw if this were a scrollIntoView call. Don't
 * "simplify" it into one.
 */

export interface RevealGeometry {
  /** The list's current scroll position — the reveal is measured from it. */
  scrollTop: number;
  /** The list's visible height and its full scrollable height — the clamp. */
  clientHeight: number;
  scrollHeight: number;
  /** The list's viewport rect. */
  listTop: number;
  /** The row's viewport rect. */
  rowTop: number;
  /** The height of the sticky header the row will sit under; 0 when none. */
  headerInset: number;
}

/**
 * The scroll position that puts the row at the top of the list's band — under
 * the sticky movement header, when the row has one, or the row would be
 * revealed behind its own pinned header.
 *
 * It is always the top, never "the shortest distance that brings the row into
 * view": a list that only nudged a barely-off-screen row would leave the
 * current marker sitting at the bottom edge, which is where the reader is
 * least able to see what is coming. The clamp keeps the answer assignable and
 * total — a browser would clamp the assignment itself — and it is what makes
 * the last rows behave: they cannot reach the top, because there is not enough
 * list below them to scroll that far, so the list stops at its end instead.
 */
export function revealScroll(geometry: RevealGeometry): number {
  const { scrollTop, clientHeight, scrollHeight, listTop, rowTop, headerInset } = geometry;
  const delta = rowTop - (listTop + headerInset);
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.min(max, Math.max(0, scrollTop + delta));
}

/**
 * How long to wait before revealing: 0 when the reader has not scrolled the
 * list by hand, and otherwise whatever is left of the grace period counted
 * from that scroll.
 *
 * The grace period exists because the panel now moves on its own. A reader who
 * scrolls the list to look at what is coming has taken the list away from the
 * playhead deliberately, and yanking it back the instant a boundary passes
 * would make the list unusable for reading at all. Waiting gives them the
 * list for as long as they are using it; the reveal then resumes from wherever
 * the playhead has got to.
 *
 * Both ways the stamp can be unusable answer 0 — reveal now. A scroll stamped
 * in the future means the wall clock stepped backwards under us (an NTP
 * correction, a laptop waking), and a stamp that cannot be compared against
 * `now` cannot be waited on either: honouring it would hold the panel still
 * for however far the clock moved. Revealing is the safe answer — it is one
 * correction the reader can undo by scrolling again, and the next scroll
 * re-arms the period.
 */
export function revealDelay(
  lastManualScrollAt: number | null,
  now: number,
  graceMs: number,
): number {
  if (lastManualScrollAt === null) return 0;
  if (now < lastManualScrollAt) return 0;
  // Clamped rather than returned raw: past the grace this is negative, and a
  // negative delay is not an honest answer to "how long should we wait".
  return Math.max(0, lastManualScrollAt + graceMs - now);
}
