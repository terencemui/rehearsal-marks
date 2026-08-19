import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from './catalog';
import { parseCatalog, resolveUrl } from './catalog';

const HASH = 'a'.repeat(64);

const VALID_ENTRY: CatalogEntry = {
  id: 'goldberg-aria',
  composer: 'J. S. Bach',
  piece: 'Goldberg Variations, BWV 988 — Aria',
  performer: 'Kimiko Ishizaka',
  duration: 230.4,
  license: 'CC0',
  attribution: 'Kimiko Ishizaka, via the Open Goldberg Variations',
  audioUrl: 'https://example.org/audio/goldberg-aria.mp3',
  sha256: HASH,
  labelsetUrl: './labelsets/goldberg-aria.json',
};

/** Serializes a manifest with the given entries and (optional) schema version. */
function manifest(entries: unknown, schemaVersion: unknown = 1): string {
  return JSON.stringify({ schemaVersion, entries });
}

describe('parseCatalog', () => {
  it('parses a catalog with every entry field', () => {
    const entries = parseCatalog(manifest([VALID_ENTRY]));

    expect(entries).toEqual([VALID_ENTRY]);
  });

  it('tolerates unknown fields on entries and the root', () => {
    const entries = parseCatalog(
      JSON.stringify({
        schemaVersion: 1,
        extra: true,
        entries: [{ ...VALID_ENTRY, somethingNew: 42 }],
      }),
    );

    expect(entries).toEqual([VALID_ENTRY]);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseCatalog('not json')).toThrow(/not valid JSON/);
  });

  it('rejects a newer schema version with a clear error', () => {
    expect(() => parseCatalog(manifest([VALID_ENTRY], 2))).toThrow(/schema version 2/);
  });

  it('rejects a missing or malformed schemaVersion', () => {
    expect(() => parseCatalog(JSON.stringify({ entries: [VALID_ENTRY] }))).toThrow(/schemaVersion/);
    expect(() => parseCatalog(manifest([VALID_ENTRY], '1'))).toThrow(/schemaVersion/);
  });

  it('rejects entries that are not an array', () => {
    expect(() => parseCatalog(JSON.stringify({ schemaVersion: 1, entries: {} }))).toThrow(
      /"entries" must be an array/,
    );
  });

  it('rejects a missing required field with its path', () => {
    const missing: Record<string, unknown> = { ...VALID_ENTRY };
    delete missing.piece;
    expect(() => parseCatalog(manifest([missing]))).toThrow(/"entries\[0\]\.piece" must be a string/);
  });

  it('rejects a non-finite or negative duration', () => {
    expect(() => parseCatalog(manifest([{ ...VALID_ENTRY, duration: '4:00' }]))).toThrow(
      /"entries\[0\]\.duration" must be a finite number/,
    );
    expect(() => parseCatalog(manifest([{ ...VALID_ENTRY, duration: -1 }]))).toThrow(
      /must not be negative/,
    );
  });

  it('rejects a sha256 that is not 64 hex characters, normalizing case', () => {
    expect(() => parseCatalog(manifest([{ ...VALID_ENTRY, sha256: 'nope' }]))).toThrow(
      /"entries\[0\]\.sha256" must be a 64-character hex string/,
    );
    // Uppercase hex is accepted and normalized so hash comparisons are exact.
    const upper = HASH.toUpperCase();
    expect(parseCatalog(manifest([{ ...VALID_ENTRY, sha256: upper }]))[0].sha256).toBe(HASH);
  });

  it('rejects duplicate entry ids', () => {
    const other = { ...VALID_ENTRY, piece: 'Another piece', labelsetUrl: './labelsets/other.json' };
    expect(() => parseCatalog(manifest([VALID_ENTRY, other]))).toThrow(
      /duplicate id "goldberg-aria"/,
    );
  });
});

describe('resolveUrl', () => {
  it('resolves a relative labelset URL against the catalog URL', () => {
    expect(resolveUrl('https://example.org/library.json', './labelsets/x.json')).toBe(
      'https://example.org/labelsets/x.json',
    );
  });

  it('leaves an absolute URL untouched', () => {
    expect(resolveUrl('https://example.org/library.json', 'https://cdn.example.org/a.mp3')).toBe(
      'https://cdn.example.org/a.mp3',
    );
  });
});
