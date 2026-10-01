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
 * What a surface *shows* for a mark: `label — alias` (or the bare label) where
 * the derived label names the mark, and the alias alone under `measures`.
 *
 * The result may be empty — an unnamed mark under `measures` shows nothing, a
 * blank name area rather than a row the app talks to itself in. Callers that
 * must say *something* (the accessibility names, the practice readout) use
 * `markerIdentity` instead.
 */
export function markerName(marker: LabeledMarker, naming: Naming): string {
  if (naming === 'measures') return marker.aliases[0] ?? '';
  return marker.aliases.length === 0 ? marker.label : `${marker.label} — ${marker.aliases[0]}`;
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
