import type { LabeledMarker, Marker } from './marker';

/**
 * Labels are derived from time rank, never stored: A, B, … Z, AA, AB, …
 * (Excel-style continuation).
 *
 * @param rank 0-based position in time order
 */
export function labelForRank(rank: number): string {
  // Bijective base-26: digits 1–26 map to A–Z.
  let n = rank + 1;
  let label = '';
  while (n > 0) {
    n -= 1;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}

/**
 * Sorts markers by time (ties broken by createdAt, then id) and derives a
 * dense label for each by rank. The label is returned on the copy only — it
 * is never written back onto the markers.
 */
export function deriveLabels(markers: readonly Marker[]): LabeledMarker[] {
  const byTime = (a: Marker, b: Marker) =>
    a.time - b.time || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  return [...markers].sort(byTime).map((m, rank) => ({ ...m, label: labelForRank(rank) }));
}
