import type { LabeledMarker, Movement, Naming } from '../domain';

/**
 * PROTOTYPE — the pure derivations both directions' players share.
 *
 * Deliberately *only* derivations: no JSX, no layout, no styling. The two
 * directions must be free to throw out each other's markup entirely — that is
 * the whole point of building both — so anything shared here has to be a
 * reading of the data, not a piece of the page.
 */

/**
 * The recording's failure copy, matching `RecordingSurface`'s. A prototype
 * that invents its own wording for a real state would be showing a design
 * against fictional content.
 */
export const YOUTUBE_FAILED_EXPLANATION =
  'This YouTube video couldn’t be played — it may be private, removed, region-blocked, ' +
  'or unavailable for embedding. Your marks are still here.';

/** The leading segment's heading, matching the markers panel's. */
const BEFORE_FIRST_MOVEMENT = 'Before the first movement';

/** One movement's stretch of the recording, and the marks inside it. */
export interface MovementSegment {
  /** The movement, or null for the stretch before the first one. */
  movement: Movement | null;
  /** The heading's text. */
  name: string;
  /** Seconds the stretch begins at. */
  start: number;
  /** Seconds the stretch runs to — the next movement's start, or the end. */
  end: number;
  /** The marks inside it, in time order. */
  markers: LabeledMarker[];
}

/**
 * Splits the recording into movement stretches and files each mark under the
 * one it falls in — the rule ADR-0005 sets (a moment at a movement's start
 * belongs to that movement), so both directions group the seeded symphony the
 * same way the labels already do: A…F, A…E, A…D, A…F.
 *
 * The stretch before the first movement is its own segment, and is dropped
 * when it holds nothing — a heading for an empty stretch of a recording that
 * simply starts before its first movement is noise, not information. Every
 * *movement* keeps its heading whether or not it holds marks, because "this
 * movement has no marks" is worth reading.
 */
export function movementSegments(
  markers: readonly LabeledMarker[],
  movements: readonly Movement[],
  duration: number,
): MovementSegment[] {
  const ordered = [...movements].sort((a, b) => a.start - b.start);
  const segments: MovementSegment[] = ordered.map((movement, index) => ({
    movement,
    name: movement.name,
    start: movement.start,
    end: ordered[index + 1]?.start ?? duration,
    markers: [],
  }));

  const leading: MovementSegment = {
    movement: null,
    name: BEFORE_FIRST_MOVEMENT,
    start: 0,
    end: ordered[0]?.start ?? duration,
    markers: [],
  };

  for (const marker of markers) {
    let target = leading;
    for (const segment of segments) {
      if (marker.time >= segment.start) target = segment;
    }
    target.markers.push(marker);
  }

  return leading.markers.length > 0 ? [leading, ...segments] : segments;
}

/**
 * What a direction's box holds. A mark's boxed glyph is the thing the app is
 * named after, so it has to be the name that direction *shows*: the derived
 * label under `letters` and `numbers`, and the owner's authored alias under
 * `measures` — where a bar number is the name and the derived label is not.
 *
 * Empty when a `measures` project's mark is unnamed; a box with nothing in it
 * is the honest drawing, and the caller renders no box rather than an empty one.
 */
export function boxText(marker: LabeledMarker, naming: Naming): string {
  return naming === 'measures' ? (marker.aliases[0] ?? '') : marker.label;
}

/**
 * The alias a row reads beside its box. Under `measures` the alias is already
 * the box's content, so reading it twice would be the row talking to itself.
 */
export function aliasText(marker: LabeledMarker, naming: Naming): string {
  return naming === 'measures' ? '' : (marker.aliases[0] ?? '');
}
