import { DomainError } from './errors';
import type { Marker } from './marker';
import { setAliases } from './markers';
import type { Movement } from './movement';

/**
 * The JSON-document validators the app's boundaries share: a server project
 * row's `markers` and `movements` jsonb columns (ADR-0006), read in
 * `projects/types.ts` and `projects/read.ts`. Each validator checks shape,
 * enforces the domain's identity rules, and routes every marker through the
 * domain's own setAliases (it trims and enforces every alias rule against the
 * final derived label set), so a hand-edited document cannot smuggle in state
 * the app itself could not create. Errors are neutral DomainErrors; the owning
 * boundary rebrands them.
 */

type JsonObject = Record<string, unknown>;

function invalidValue(reason: string): DomainError {
  return new DomainError(reason, 'invalid-value');
}

function invalidMarkers(reason: string): DomainError {
  return new DomainError(reason, 'invalid-markers');
}

function invalidMovements(reason: string): DomainError {
  return new DomainError(reason, 'invalid-movements');
}

// The section readers share these assertion helpers; each throws a neutral
// DomainError that the owning boundary rebrands with its own context.
function assertObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidValue(`${path} must be an object.`);
  }
  // TS narrows the guard to `object`; a non-null, non-array object is a JsonObject.
  return value as JsonObject;
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidValue(`${path} must be an array.`);
  }
  return value;
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw invalidValue(`${path} must be a string.`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, path: string): string {
  const string = assertString(value, path);
  if (string.trim() === '') {
    throw invalidValue(`${path} must not be blank.`);
  }
  return string;
}

function assertFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidValue(`${path} must be a finite number.`);
  }
  return value;
}

function assertNonNegativeNumber(value: unknown, path: string): number {
  const number = assertFiniteNumber(value, path);
  if (number < 0) {
    throw invalidValue(`${path} must not be negative.`);
  }
  return number;
}

/**
 * Parses a markers document — the shared validation for the server project
 * row's `markers` column. Validates shape, enforces unique marker ids, and
 * routes every marker through the domain's own setAliases (it trims and
 * enforces every alias rule against the final derived label set), so a
 * hand-edited document cannot smuggle in state the app itself could not
 * create. Errors are neutral DomainErrors; the owning boundary rebrands them.
 */
export function parseMarkers(value: unknown): Marker[] {
  const raw = assertArray(value, '"markers"');
  const markers = raw.map((item, index) => {
    const marker = assertObject(item, `"markers[${index}]"`);
    return {
      id: assertString(marker.id, `"markers[${index}].id"`),
      time: assertNonNegativeNumber(marker.time, `"markers[${index}].time"`),
      aliases: assertArray(marker.aliases, `"markers[${index}].aliases"`).map((alias, aliasIndex) =>
        assertString(alias, `"markers[${index}].aliases[${aliasIndex}]"`),
      ),
      createdAt: assertFiniteNumber(marker.createdAt, `"markers[${index}].createdAt"`),
    };
  });

  // Marker ids are stable identity for aliases; two markers sharing one would
  // make later operations target the wrong marker.
  const seenIds = new Set<string>();
  for (const m of markers) {
    if (seenIds.has(m.id)) {
      throw invalidMarkers(`"markers" contain duplicate id "${m.id}".`);
    }
    seenIds.add(m.id);
  }

  let validated = markers;
  for (const m of markers) {
    try {
      validated = setAliases(validated, m.id, m.aliases);
    } catch (error) {
      if (error instanceof DomainError) {
        throw invalidMarkers(`marker "${m.id}": ${error.message}`);
      }
      throw error;
    }
  }
  return validated;
}

/**
 * Parses a movements document — the shared validation for the server project
 * row's `movements` column. Validates shape, enforces unique ids and strictly
 * increasing starts (ADR-0005), so a hand-edited document cannot smuggle in
 * state the surface cannot draw. Errors are neutral DomainErrors; the owning
 * boundary rebrands them.
 */
export function parseMovements(value: unknown): Movement[] {
  const raw = assertArray(value, '"movements"');
  const movements = raw.map((item, index) => {
    const movement = assertObject(item, `"movements[${index}]"`);
    return {
      id: assertString(movement.id, `"movements[${index}].id"`),
      name: assertNonEmptyString(movement.name, `"movements[${index}].name"`),
      start: assertNonNegativeNumber(movement.start, `"movements[${index}].start"`),
    };
  });

  // Movement ids are identity; two sharing one would make membership
  // derivation ambiguous.
  const seenIds = new Set<string>();
  for (const movement of movements) {
    if (seenIds.has(movement.id)) {
      throw invalidMovements(`"movements" contain duplicate id "${movement.id}".`);
    }
    seenIds.add(movement.id);
  }

  // Starts are strictly increasing: a boundary that moves backwards makes the
  // latest-start-≤-time rule point two movements at the same stretch.
  for (let i = 1; i < movements.length; i += 1) {
    if (movements[i].start <= movements[i - 1].start) {
      throw invalidMovements('"movements" starts must be strictly increasing.');
    }
  }

  return movements;
}
