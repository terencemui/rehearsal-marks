import { describe, expect, it, vi } from 'vitest';
import { parseProjectFile, serializeProjectFile } from '../domain';
import type { ProjectFileData } from '../domain';
import type { LibraryEntryRecord } from '../storage';
import type { CatalogEntry } from './catalog';
import { LibraryError } from './errors';
import { downloadAndCache, fetchLabelset, seededProjectId, seedProject } from './load';

const HASH = 'a'.repeat(64);

const ENTRY: CatalogEntry = {
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

/** A valid label set carrying the entry's recording identity. */
function labelset(): ProjectFileData {
  return parseProjectFile(
    serializeProjectFile({
      project: { id: 'lib-1', name: 'Library piece', createdAt: 0, updatedAt: 0, source: 'upload' },
      markers: [
        { id: 'm1', time: 10, aliases: ['Recap'], createdAt: 111 },
        { id: 'm2', time: 222.35, aliases: [], createdAt: 222 },
      ],
      audioMeta: {
        sha256: HASH,
        duration: 230.4,
        mimeType: 'audio/mpeg',
        filename: 'goldberg-aria.mp3',
        sizeBytes: 2_000_000,
        source: 'https://example.org/audio/goldberg-aria.mp3',
        license: 'CC0',
        attribution: 'Kimiko Ishizaka, via the Open Goldberg Variations',
      },
    }),
  );
}

const AUDIO = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' });

describe('fetchLabelset', () => {
  it('fetches and parses the label set, returning its markers and identity', async () => {
    const fetchText = vi.fn(async () => serializeProjectFile(labelset()));

    const result = await fetchLabelset(ENTRY, fetchText);

    expect(fetchText).toHaveBeenCalledWith('./labelsets/goldberg-aria.json');
    expect(result.markers.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.audioMeta.license).toBe('CC0');
  });

  it('rejects a label set whose sha256 does not match the catalog', async () => {
    const mismatched = labelset();
    mismatched.audioMeta.sha256 = 'b'.repeat(64);
    const fetchText = vi.fn(async () => serializeProjectFile(mismatched));

    const promise = fetchLabelset(ENTRY, fetchText);

    await expect(promise).rejects.toMatchObject({
      name: 'LibraryError',
      code: 'labelset-mismatch',
    });
    await expect(promise).rejects.toThrow(/Goldberg/);
  });

  it('rejects a malformed label set as an invalid-labelset LibraryError', async () => {
    const fetchText = vi.fn(async () => 'not json');

    await expect(fetchLabelset(ENTRY, fetchText)).rejects.toMatchObject({
      name: 'LibraryError',
      code: 'invalid-labelset',
    });
  });

  it('rejects a label set from a newer schema version as invalid-labelset', async () => {
    const future = JSON.parse(serializeProjectFile(labelset())) as Record<string, unknown>;
    future.schemaVersion = 99;
    const fetchText = vi.fn(async () => JSON.stringify(future));

    await expect(fetchLabelset(ENTRY, fetchText)).rejects.toMatchObject({
      name: 'LibraryError',
      code: 'invalid-labelset',
    });
  });
});

describe('downloadAndCache', () => {
  it('downloads, verifies sha256, caches audio + label set, and returns the blob', async () => {
    const sha256 = vi.fn(async () => HASH);
    const saveCache = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const now = () => 123_456;

    const result = await downloadAndCache(ENTRY, labelset(), {
      fetchAudio: vi.fn(async () => AUDIO),
      sha256,
      saveCache,
      now,
    });

    expect(result).toBe(AUDIO);
    expect(sha256).toHaveBeenCalledWith(AUDIO);
    const saved = saveCache.mock.calls[0][0] as LibraryEntryRecord;
    expect(saved.id).toBe('goldberg-aria');
    expect(saved.audio).toBe(AUDIO);
    expect(saved.labelset.markers).toHaveLength(2);
    expect(saved.cachedAt).toBe(123_456);
  });

  it('rejects audio that fails sha256 verification without caching it', async () => {
    const saveCache = vi.fn(async () => {});

    await expect(
      downloadAndCache(ENTRY, labelset(), {
        fetchAudio: vi.fn(async () => AUDIO),
        sha256: vi.fn(async () => 'b'.repeat(64)),
        saveCache,
      }),
    ).rejects.toMatchObject({ name: 'LibraryError', code: 'audio-mismatch' });
    expect(saveCache).not.toHaveBeenCalled();
  });

  it('propagates a failed download unchanged — nothing is cached', async () => {
    const saveCache = vi.fn(async () => {});
    const boom = new Error('network down');

    await expect(
      downloadAndCache(ENTRY, labelset(), {
        fetchAudio: vi.fn(async () => {
          throw boom;
        }),
        sha256: vi.fn(),
        saveCache,
      }),
    ).rejects.toBe(boom);
    expect(saveCache).not.toHaveBeenCalled();
  });
});

describe('seedProject', () => {
  it('seeds a new editable project from the label set, source set to the entry audio', () => {
    const record = seedProject(ENTRY, labelset(), AUDIO, 123_456);

    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.name).toBe('Goldberg Variations, BWV 988 — Aria');
    expect(record.createdAt).toBe(123_456);
    expect(record.updatedAt).toBe(123_456);
    expect(record.audio).toBe(AUDIO);
    // Seeded projects are upload-shaped records that open in Playback mode.
    expect(record.source).toBe('upload');
    expect(record.playerMode).toBe('playback');
    expect(record.markers.map((m) => m.id)).toEqual(['m1', 'm2']);
    // The catalog is authoritative for identity: its hash and audio URL win,
    // the label set carries the rest of the recording's facts.
    expect(record.audioMeta.sha256).toBe(HASH);
    expect(record.audioMeta.source).toBe('https://example.org/audio/goldberg-aria.mp3');
    expect(record.audioMeta.license).toBe('CC0');
    expect(record.audioMeta.attribution).toBe('Kimiko Ishizaka, via the Open Goldberg Variations');
  });

  it('seeds an independent project each time — ids never repeat', () => {
    expect(seedProject(ENTRY, labelset(), AUDIO, 0).id).not.toBe(
      seedProject(ENTRY, labelset(), AUDIO, 0).id,
    );
  });
});

describe('seededProjectId', () => {
  it('finds the seeded project by the recording sha256 — the stable join', () => {
    expect(
      seededProjectId(
        [
          { id: 'p1', source: '', sha256: 'b'.repeat(64) },
          // Same recording, different URL: a catalog redeploy moved the audio.
          {
            id: 'p2',
            source: 'https://elsewhere.example.org/aria.mp3',
            sha256: HASH,
          },
        ],
        ENTRY,
      ),
    ).toBe('p2');
  });

  it('falls back to the audio source for records without a matching hash', () => {
    expect(
      seededProjectId(
        [
          { id: 'p1', source: '', sha256: '' },
          { id: 'p2', source: 'https://example.org/audio/goldberg-aria.mp3', sha256: '' },
        ],
        ENTRY,
      ),
    ).toBe('p2');
  });

  it('returns undefined when no project was seeded from the entry', () => {
    expect(seededProjectId([{ id: 'p1', source: '', sha256: 'b'.repeat(64) }], ENTRY)).toBeUndefined();
  });
});

describe('LibraryError', () => {
  it('carries a stable code alongside the message', () => {
    const error = new LibraryError('nope', 'fetch-failed');
    expect(error.name).toBe('LibraryError');
    expect(error.code).toBe('fetch-failed');
  });
});
