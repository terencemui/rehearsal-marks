import { describe, expect, it } from 'vitest';
import { parseProjectFile } from '../domain';
import { projectRecord, youtubeProjectRecord } from '../test/project-fixture';
import type { ProjectRecord } from '../storage';
import { exportLabelSetJson, exportProjectJson, exportProjectZip, sanitizeDownloadName } from './export';
import { readZipEntries } from './zip';

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
    expect(parsed.project).toEqual({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      source: 'upload',
    });
    expect(parsed.markers).toHaveLength(2);
  });
});

describe('exportProjectJson', () => {
  it('exports a YouTube project as bare project JSON carrying the video identity', () => {
    const record = youtubeProjectRecord({
      audioMeta: {
        sha256: '',
        duration: 604.2,
        mimeType: '',
        filename: 'A performance',
        sizeBytes: 0,
        source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        license: '',
        attribution: '',
      },
    });

    const parsed = JSON.parse(exportProjectJson(record)) as Record<string, unknown>;

    // The same shape as the label-set format — the file doubles as the
    // community contribution format — with the source discriminator.
    expect(parsed.schemaVersion).toBe(1);
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

  it('matches the label-set export for an upload record (one serialization, two names)', () => {
    const record = projectRecord();

    expect(exportProjectJson(record)).toBe(exportLabelSetJson(record));
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
