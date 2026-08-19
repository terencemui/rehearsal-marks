/**
 * The library catalog — the community's manifest of CC0 recordings. Pure
 * parsing and URL math: the network I/O lives in the load pipeline, the UI in
 * the Library screen. Every entry's facts come from the maintainer-curated
 * `library.json`; a malformed catalog fails loudly instead of rendering a
 * half-trustworthy list.
 */

import { LibraryError } from './errors';

/** One row of the catalog: the facts a browser needs to list, load, and verify a recording. */
export interface CatalogEntry {
  /** Stable slug, unique within the catalog — the label set's filename. */
  id: string;
  composer: string;
  piece: string;
  performer: string;
  /** Seconds, float — the recording's known duration. */
  duration: number;
  license: string;
  attribution: string;
  /** Where the audio streams from. Never in the repo: R2 in production. */
  audioUrl: string;
  /**
   * The recording's sha256 — the truth every downloaded copy is verified
   * against before it is cached, and the join that makes a label set
   * applicable to exactly this recording.
   */
  sha256: string;
  /** The contributed label set — one `project.json` file per entry, relative to the catalog. */
  labelsetUrl: string;
}

/** The only catalog schema version this app reads. */
export const CATALOG_SCHEMA_VERSION = 1;

/**
 * Parses `library.json`. Tolerates unknown fields (forward compatibility),
 * rejects newer schema versions, and validates every field a browser depends
 * on — so a bad manifest is a loud error, never a broken list or a download
 * of the wrong recording. Uppercase sha256 hex is normalized to lowercase so
 * hash comparisons are exact.
 */
export function parseCatalog(text: string): CatalogEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalidCatalog('The manifest is not valid JSON.');
  }
  const root = assertObject(raw, 'the manifest root');

  const schemaVersion = root.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw invalidCatalog('"schemaVersion" must be a positive integer.');
  }
  if (schemaVersion > CATALOG_SCHEMA_VERSION) {
    throw invalidCatalog(
      `This catalog uses schema version ${schemaVersion}, but this app supports version ${CATALOG_SCHEMA_VERSION}. Update the app to browse it.`,
    );
  }

  const entries = assertArray(root.entries, '"entries"').map((item, index) =>
    readEntry(item, index),
  );

  // The id is the cache key and the label set filename; two rows sharing one
  // would make one silently overwrite the other.
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw invalidCatalog(`"entries" contain duplicate id "${entry.id}".`);
    }
    seenIds.add(entry.id);
  }
  return entries;
}

/**
 * Resolves a catalog-relative URL (the label set path) against the catalog's
 * own URL. Absolute URLs pass through untouched, so the audio URL's `new
 * URL(url, baseUrl)` round-trip changes nothing.
 */
export function resolveUrl(baseUrl: string, url: string): string {
  return new URL(url, baseUrl).toString();
}

type JsonObject = Record<string, unknown>;

function invalidCatalog(reason: string): LibraryError {
  return new LibraryError(`Invalid library catalog: ${reason}`, 'invalid-catalog');
}

function assertObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidCatalog(`${path} must be an object.`);
  }
  return value as JsonObject;
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidCatalog(`${path} must be an array.`);
  }
  return value;
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') {
    throw invalidCatalog(`${path} must be a string.`);
  }
  return value;
}

function assertFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidCatalog(`${path} must be a finite number.`);
  }
  return value;
}

function assertNonNegativeNumber(value: unknown, path: string): number {
  const number = assertFiniteNumber(value, path);
  if (number < 0) {
    throw invalidCatalog(`${path} must not be negative.`);
  }
  return number;
}

function assertSha256(value: unknown, path: string): string {
  const hash = assertString(value, path);
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw invalidCatalog(`${path} must be a 64-character hex string.`);
  }
  return hash.toLowerCase();
}

function readEntry(value: unknown, index: number): CatalogEntry {
  const raw = assertObject(value, `"entries[${index}]"`);
  return {
    id: assertString(raw.id, `"entries[${index}].id"`),
    composer: assertString(raw.composer, `"entries[${index}].composer"`),
    piece: assertString(raw.piece, `"entries[${index}].piece"`),
    performer: assertString(raw.performer, `"entries[${index}].performer"`),
    duration: assertNonNegativeNumber(raw.duration, `"entries[${index}].duration"`),
    license: assertString(raw.license, `"entries[${index}].license"`),
    attribution: assertString(raw.attribution, `"entries[${index}].attribution"`),
    audioUrl: assertString(raw.audioUrl, `"entries[${index}].audioUrl"`),
    sha256: assertSha256(raw.sha256, `"entries[${index}].sha256"`),
    labelsetUrl: assertString(raw.labelsetUrl, `"entries[${index}].labelsetUrl"`),
  };
}
