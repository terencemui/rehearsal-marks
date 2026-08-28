import type { LabeledMarker, Marker } from './marker';
import type { Movement } from './movement';
import { movementForTime } from './movement';

/**
 * Labels are derived from time rank within a movement, never stored: A, B, …
 * Z, AA, AB, … (Excel-style continuation), restarting at A for each movement —
 * the printed score's convention, which is the point of the feature
 * (ADR-0005). A marker before the first movement belongs to none, and forms
 * its own sequence from A.
 *
 * @param rank 0-based position in time order within one movement
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
 * Sorts markers by time (ties broken by createdAt, then id), groups them by
 * movement membership (latest start ≤ time — a marker before the first
 * movement belongs to none), and derives a dense label for each by its rank
 * within its group, restarting at A per group. The returned array is in global
 * time order; the label is carried on the copy only — it is never written back
 * onto the markers.
 */
export function deriveLabels(
  markers: readonly Marker[],
  movements: readonly Movement[] = [],
): LabeledMarker[] {
  const byTime = (a: Marker, b: Marker) =>
    a.time - b.time || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  // Grouped by movement id; the pre-first-movement bucket holds orphans.
  const groups = new Map<string | null, Marker[]>();
  for (const m of markers) {
    const key = movementForTime(movements, m.time)?.id ?? null;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const labelById = new Map<string, string>();
  for (const group of groups.values()) {
    [...group].sort(byTime).forEach((m, rank) => labelById.set(m.id, labelForRank(rank)));
  }

  return [...markers].sort(byTime).map((m) => ({ ...m, label: labelById.get(m.id) ?? '' }));
}
