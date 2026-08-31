/** The player posture: Playback (read-only) or Label (editing). */
export type PlayerMode = 'playback' | 'label';

/**
 * A project's first-open posture — derived from what the project carries,
 * never stored (T51). A project with marks is immediately practiceable, so it
 * opens in Playback; a bare pasted link has an empty timeline and nothing to
 * practise against, so it opens in Label with the marking tools in reach.
 */
export function defaultPlayerMode(markerCount: number): PlayerMode {
  return markerCount > 0 ? 'playback' : 'label';
}
