import { DomainError } from './errors';
import { newId } from './id';
import { deriveLabels } from './labels';
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
 * no repeats within the set, and case-insensitive uniqueness across every
 * other marker's aliases and every derived label. Case-insensitive because
 * letter keys navigate by label, and a case-twin of a label or alias would
 * make the marker list ambiguous. Returns the normalized aliases.
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

  const takenBy = new Map<string, 'alias' | 'label'>();
  for (const m of markers) {
    if (m.id === ownId) continue;
    for (const alias of m.aliases) {
      takenBy.set(lower(alias), 'alias');
    }
  }
  for (const { label } of deriveLabels(markers)) {
    takenBy.set(lower(label), 'label');
  }

  const withinSet = new Set<string>();
  for (const alias of aliases) {
    if (withinSet.has(lower(alias))) {
      throw new DomainError(`Alias "${alias}" is repeated.`, 'alias-duplicate');
    }
    withinSet.add(lower(alias));

    const takenAs = takenBy.get(lower(alias));
    if (takenAs === 'label') {
      throw new DomainError(
        `Alias "${alias}" collides with a marker label.`,
        'alias-label-collision',
      );
    }
    if (takenAs === 'alias') {
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
