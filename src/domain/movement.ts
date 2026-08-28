/**
 * A named subdivision of a recording — a self-contained portion of the musical
 * work, such as a symphony's first movement. Boundaries are start-only
 * (ADR-0005): a movement's extent runs to the next movement's start or the
 * recording's end, so `end` is derived, never stored. Membership of a moment
 * in a movement is derived from the same rule and is never stored either.
 */

export interface Movement {
  /** Stable identity; id stays the marker that anchors it, never the name. */
  id: string;
  /** The movement's display name, e.g. "I · Allegro". */
  name: string;
  /** Seconds — the recording position the movement begins at; strictly increasing. */
  start: number;
}

/**
 * The movement containing a time — the movement whose start is the latest
 * start ≤ `time` — or null before the first movement's start. A moment exactly
 * at a movement's start belongs to that movement.
 */
export function movementForTime(
  movements: readonly Movement[],
  time: number,
): Movement | null {
  let found: Movement | null = null;
  for (const movement of movements) {
    if (movement.start <= time) found = movement;
  }
  return found;
}
