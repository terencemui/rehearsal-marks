import { DomainError } from './errors';
import { newId } from './id';
import type { Marker } from './marker';

export const ALIAS_MAX_LENGTH = 16;

function assertValidTime(time: number): void {
  if (!Number.isFinite(time) || time < 0) {
    throw new DomainError(
      `Marker time must be a finite, non-negative number of seconds; got ${time}.`,
      'invalid-time',
    );
  }
}

function findIndex(markers: readonly Marker[], id: string): number {
  const index = markers.findIndex((m) => m.id === id);
  if (index === -1) {
    throw new DomainError(`No marker with id "${id}".`, 'marker-not-found');
  }
  return index;
}

function updateAt(
  markers: readonly Marker[],
  index: number,
  patch: Partial<Marker>,
): Marker[] {
  return markers.map((m, i) => (i === index ? { ...m, ...patch } : m));
}

/**
 * Trims aliases and enforces every alias rule: non-empty, ≤ ALIAS_MAX_LENGTH,
 * no repeats within the set, and case-insensitive uniqueness against every
 * other marker's aliases only. The former alias-vs-label collision rule is
 * gone with the A–Z letter jumps (ADR-0005): it existed only to keep letter
 * navigation unambiguous, and labels restart per movement now, so a marker
 * labelled A and an alias "A" no longer name the same thing. Returns the
 * normalized aliases.
 */
function validateAliases(
  raw: string[],
  markers: readonly Marker[],
  ownId: string,
): string[] {
  const aliases = raw.map((alias) => {
    const trimmed = alias.trim();
    if (trimmed.length === 0) {
      throw new DomainError('Aliases must not be empty.', 'alias-empty');
    }
    if (trimmed.length > ALIAS_MAX_LENGTH) {
      throw new DomainError(
        `Aliases must be at most ${ALIAS_MAX_LENGTH} characters; got "${trimmed}".`,
        'alias-too-long',
      );
    }
    return trimmed;
  });

  const lower = (s: string) => s.toLowerCase();

  const taken = new Set<string>();
  for (const m of markers) {
    if (m.id === ownId) continue;
    for (const alias of m.aliases) {
      taken.add(lower(alias));
    }
  }

  const withinSet = new Set<string>();
  for (const alias of aliases) {
    if (withinSet.has(lower(alias))) {
      throw new DomainError(`Alias "${alias}" is repeated.`, 'alias-duplicate');
    }
    withinSet.add(lower(alias));

    if (taken.has(lower(alias))) {
      throw new DomainError(
        `Alias "${alias}" is already used by another marker.`,
        'alias-duplicate',
      );
    }
  }

  return aliases;
}

export function addMarker(markers: readonly Marker[], marker: Marker): Marker[] {
  assertValidTime(marker.time);
  if (markers.some((m) => m.id === marker.id)) {
    throw new DomainError(
      `A marker with id "${marker.id}" already exists.`,
      'duplicate-marker-id',
    );
  }
  const aliases = validateAliases(marker.aliases, markers, marker.id);
  return [...markers, { ...marker, aliases }];
}

export function removeMarker(markers: readonly Marker[], id: string): Marker[] {
  const index = findIndex(markers, id);
  return markers.filter((_, i) => i !== index);
}

export function moveMarker(markers: readonly Marker[], id: string, time: number): Marker[] {
  assertValidTime(time);
  const index = findIndex(markers, id);
  return updateAt(markers, index, { time });
}

export function setAliases(
  markers: readonly Marker[],
  id: string,
  rawAliases: string[],
): Marker[] {
  const index = findIndex(markers, id);
  const aliases = validateAliases(rawAliases, markers, id);
  return updateAt(markers, index, { aliases });
}

export function createMarker(time: number): Marker {
  assertValidTime(time);
  return { id: newId(), time, aliases: [], createdAt: Date.now() };
}
