/**
 * How a project names its rehearsal marks (CONTEXT.md) — the one place the
 * setting turns into a reading, so no surface can drift from another.
 *
 * A marker carries two names: the derived **Label** (its time rank within its
 * movement, never stored — ADR-0005) and the authored **Alias**. A project's
 * **Naming** says which of them names its marks: `letters` and `numbers` are
 * the same machinery written two ways — the derived label, bijective base-26
 * or decimal — while `measures` is a different kind, the owner's alias,
 * because a bar number (`17`, `42`, `63`) has gaps and can only be authored.
 */

import type { LabeledMarker } from './marker';

/** How a project names its marks (CONTEXT.md). */
export type Naming = 'letters' | 'numbers' | 'measures';

export const NAMINGS: readonly Naming[] = ['letters', 'numbers', 'measures'];

/**
 * The two parts a surface draws a name in: **the mark itself**, and the alias
 * that runs beside it.
 *
 * They are named apart because a surface may draw the mark and not the alias:
 * the practice readout and the panel's rows box the mark, and the box takes
 * the whole of it and none of the alias. A joined reading split on its em dash
 * would make the separator load-bearing, and a mark with a dash in its own
 * label would break; this is the reading divided where it divides.
 *
 * The join itself is the caller's, and it is one line: `mark — alias`, or the
 * mark alone when there is no alias. It was a function (`markerName`) until
 * T78, when the panel stopped being able to use it — the mark has to be its own
 * element for the box to reach round it, so the row writes the two parts out
 * and the separator lives at the surface that draws it.
 *
 * `mark` may be empty — an unnamed mark under `measures` has no name of its
 * own, a blank name area rather than a row the app talks to itself in. Callers
 * that must say *something* (the accessibility names, the practice readout)
 * use `markerIdentity` instead, which falls back to the derived label.
 */
export function markerReading(
  marker: LabeledMarker,
  naming: Naming,
): { mark: string; alias: string | null } {
  // Under `measures` the alias *is* the mark, so there is nothing beside it.
  if (naming === 'measures') return { mark: marker.aliases[0] ?? '', alias: null };
  return { mark: marker.label, alias: marker.aliases[0] ?? null };
}

/**
 * The reading that must never be empty — what a mark is *called* when a name
 * is required and the display reading has none.
 *
 * Where the derived label names the mark, that is the whole of it: the
 * accessibility names have always been the bare label, and an alias is read
 * beside it rather than in place of it. Under `measures` the alias is the
 * name, and a mark the owner has not named falls back to its label — so the
 * row that shows nothing still announces `Delete marker A`.
 */
export function markerIdentity(marker: LabeledMarker, naming: Naming): string {
  if (naming === 'measures') return marker.aliases[0] ?? marker.label;
  return marker.label;
}

/**
 * The browsing row's tooltip: the whole name, so a reading the row's own span
 * ellipsises — a long alias at the panel's floor — is still reachable without
 * making the row active, which would move the recording. Under `measures` the
 * name is the alias alone, and an unnamed mark says nothing on hover either.
 */
export function markerTitle(marker: LabeledMarker, naming: Naming): string {
  if (naming === 'measures') return marker.aliases[0] ?? '';
  return marker.aliases.length === 0 ? marker.label : `${marker.label} — ${marker.aliases.join(', ')}`;
}
