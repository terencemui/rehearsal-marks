import type { LabeledMarker, Marker } from './marker';
import type { Movement } from './movement';
import { movementForTime } from './movement';
import type { Naming } from './naming';

/**
 * Labels are derived from time rank within a movement, never stored, and
 * restart per movement — the printed score's convention, which is the point of
 * the feature (ADR-0005). A marker before the first movement belongs to none,
 * and forms its own sequence from the start.
 *
 * The rank is *written* in the hand the project's Naming names: `letters` is
 * the score that letters its rehearsals (A, B, … Z, AA, AB, … — Excel-style
 * continuation), `numbers` the score that numbers them (1, 2, 3). A project
 * whose Naming is `measures` displays the Alias instead; its derived label
 * exists only as the fallback a name is required for, and is written in the
 * default hand.
 *
 * @param rank 0-based position in time order within one movement
 */
export function labelForRank(rank: number, naming: Naming = 'letters'): string {
  // A numbers score counts its figures: the rank, one-based, in decimal.
  if (naming === 'numbers') return String(rank + 1);

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
 * within its group, restarting at the start per group. The returned array is
 * in global time order; the label is carried on the copy only — it is never
 * written back onto the markers.
 *
 * The project's `naming` writes every label in that hand (see `labelForRank`);
 * it changes the spelling and nothing else — the ordering, the grouping, and
 * the per-movement restart are the same under either, which is why one function
 * serves both conventions.
 */
export function deriveLabels(
  markers: readonly Marker[],
  movements: readonly Movement[] = [],
  naming: Naming = 'letters',
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
    [...group].sort(byTime).forEach((m, rank) => labelById.set(m.id, labelForRank(rank, naming)));
  }

  return [...markers].sort(byTime).map((m) => ({ ...m, label: labelById.get(m.id) ?? '' }));
}
