/**
 * A rehearsal mark pinned to a moment in a recording.
 *
 * `label` (A, B, … Z, AA, …) is deliberately absent: it is derived from time
 * rank, never stored. Aliases attach to `id` and follow the marker wherever it
 * goes.
 */
export interface Marker {
  /** uuid — stable identity; aliases, undo, and export follow this, never the label. */
  id: string;
  /** Seconds, float, full precision. Rounding is display-only. */
  time: number;
  /** User-facing names; constraints enforced by the domain module. */
  aliases: string[];
  /** Epoch ms. */
  createdAt: number;
}

/** A marker with its derived label. */
export interface LabeledMarker extends Marker {
  label: string;
}
