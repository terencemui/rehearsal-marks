import { describe, expect, it } from 'vitest';
import { parseProjectFile } from '../domain';
import type { AudioMeta } from '../domain';
import { projectRecord, youtubeProjectRecord } from '../test/project-fixture';
import type { ProjectRecord } from '../storage';
import { exportLabelSetJson, exportProjectJson, exportProjectZip, sanitizeDownloadName } from './export';
import { readZipEntries } from './zip';

const CANONICAL_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** A YouTube project exactly as the creation pipeline stores one. */
function youtubeRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return youtubeProjectRecord({
    audioMeta: {
      sha256: '',
      duration: 542.25,
      mimeType: '',
      filename: 'Brahms Intermezzo',
      sizeBytes: 0,
      source: CANONICAL_URL,
      license: '',
      attribution: '',
    },
    ...overrides,
  });
}

describe('exportProjectZip', () => {
  it('zips project.json and the audio, and the data parses back identically', async () => {
    const record = projectRecord();

    const zip = await exportProjectZip(record);
    const entries = await readZipEntries(zip);

    expect([...entries.keys()].sort()).toEqual(['brahms.mp3', 'project.json']);
    expect([...entries.get(record.audioMeta.filename)!]).toEqual([1, 2, 3, 4]);
    const parsed = parseProjectFile(new TextDecoder().decode(entries.get('project.json')!));
    expect(parsed.project).toEqual({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      source: 'upload',
    });
    expect(parsed.markers).toEqual(record.markers);
    expect(parsed.audioMeta).toEqual(record.audioMeta);
  });
});

describe('exportLabelSetJson', () => {
  it('carries the recording identity a community review needs to audit the set', () => {
    const record: ProjectRecord = {
      ...projectRecord(),
      audioMeta: {
        sha256: 'd'.repeat(64),
        duration: 234.5,
        mimeType: 'audio/mpeg',
        filename: 'mozart-k466-iii.mp3',
        sizeBytes: 10_000_000,
        source: 'https://example.com/k466',
        license: 'CC0',
        attribution: 'Example Ensemble',
      },
    };

    const parsed = JSON.parse(exportLabelSetJson(record)) as Record<string, unknown>;

    // sha256, duration, source, license, attribution — the label-set-only
    // export is the community contribution format, so identity is mandatory.
    expect(parsed.audioMeta).toEqual(record.audioMeta);
    // The raw file omits the discriminator for uploads — absent means upload.
    expect(parsed.project).toEqual({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
    expect(parsed.markers).toHaveLength(2);
  });
});

describe('exportProjectJson', () => {
  it('serializes a YouTube project as bare JSON with its source, canonical URL, duration, and markers', () => {
    const record = youtubeRecord();

    const parsed = JSON.parse(exportProjectJson(record)) as Record<string, unknown>;

    expect(parsed.project).toEqual({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      source: 'youtube',
    });
    expect(parsed.audioMeta).toEqual(record.audioMeta);
    expect(parsed.markers).toHaveLength(2);
  });

  it('empties the identity fields a YouTube project does not apply, whatever the record carries', () => {
    const record = youtubeRecord({
      audioMeta: {
        ...youtubeRecord().audioMeta,
        sha256: 's'.repeat(64),
        mimeType: 'audio/mpeg',
        sizeBytes: 9_999,
        license: 'CC0',
        attribution: 'Someone',
      },
    });

    const parsed = JSON.parse(exportProjectJson(record)) as { audioMeta: AudioMeta };

    // There is no audio to hash or describe — the file carries only what
    // applies: the canonical URL, the known duration, and the title.
    expect(parsed.audioMeta).toEqual({
      sha256: '',
      duration: 542.25,
      mimeType: '',
      filename: 'Brahms Intermezzo',
      sizeBytes: 0,
      source: CANONICAL_URL,
      license: '',
      attribution: '',
    });
  });

  it('is the same file as the label-set export — it doubles as the community contribution format', () => {
    const record = youtubeRecord();

    expect(exportProjectJson(record)).toBe(exportLabelSetJson(record));
  });

  it('throws for an uploaded record — that export is a zip, and bare JSON would silently drop the audio', () => {
    expect(() => exportProjectJson(projectRecord())).toThrow(
      'An uploaded project has audio to bundle — its export is the zip, not bare JSON.',
    );
  });
});

describe('sanitizeDownloadName', () => {
  it('keeps ordinary names untouched', () => {
    expect(sanitizeDownloadName('Brahms Op. 118 No. 2')).toBe('Brahms Op. 118 No. 2');
  });

  it('replaces path-hostile characters and control characters with spaces', () => {
    expect(sanitizeDownloadName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(sanitizeDownloadName('tab\tname')).toBe('tab name');
  });

  it('strips trailing dots (a Windows host would refuse the download)', () => {
    expect(sanitizeDownloadName('ends with dots...')).toBe('ends with dots');
  });

  it('falls back to "project" when nothing usable remains', () => {
    expect(sanitizeDownloadName('   ')).toBe('project');
    expect(sanitizeDownloadName('?')).toBe('project');
  });

  it('falls back to "project" for Windows device names (CON.zip would route to the console)', () => {
    expect(sanitizeDownloadName('CON')).toBe('project');
    expect(sanitizeDownloadName('nul')).toBe('project');
    expect(sanitizeDownloadName('com3')).toBe('project');
    expect(sanitizeDownloadName('LPT1.txt')).toBe('project');
    // An ordinary dotted name whose first segment is not a device name passes.
    expect(sanitizeDownloadName('Brahms Op. 118 No. 2')).toBe('Brahms Op. 118 No. 2');
  });
});
