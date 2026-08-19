import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProjectFile } from '../domain';
import { parseCatalog } from './catalog';

/** The repo-root-relative path of the shipped manifest, as a file URL. */
const catalogUrl = pathToFileURL(resolve(process.cwd(), 'library/library.json'));

/**
 * The shipped library data, checked like a consumer would check it: the
 * manifest parses, every entry has its label set file, and the label set
 * carries the catalog's recording identity. This is the guard that keeps a
 * bad catalog row or a mismatched labelset out of a PR — the same rules the
 * app enforces at load time.
 */
describe('the shipped library catalog', () => {
  it('parses, and every entry has a matching label set with at least one marker', () => {
    const entries = parseCatalog(readFileSync(catalogUrl, 'utf8'));

    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      const labelsetUrl = new URL(entry.labelsetUrl, catalogUrl);
      const labelset = parseProjectFile(readFileSync(labelsetUrl, 'utf8'));

      // Recording identity: the hard check that makes this label set
      // applicable to exactly the recording the catalog promises.
      expect(labelset.audioMeta.sha256.toLowerCase()).toBe(entry.sha256);
      expect(labelset.audioMeta.license).toBe(entry.license);
      // A library recording with no marks teaches nothing — the whole point
      // of an entry is the contributed marks.
      expect(labelset.markers.length).toBeGreaterThan(0);
    }
  });

  it('keeps entry ids unique — the cache key and the labelset filename depend on it', () => {
    const entries = parseCatalog(readFileSync(catalogUrl, 'utf8'));

    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });
});
