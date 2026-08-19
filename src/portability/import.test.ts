import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../storage';
import type { ProjectRecord } from '../storage';
import { projectRecord } from '../test/project-fixture';
import { exportLabelSetJson, exportProjectZip } from './export';
import { importLabelSet, importProjectZip, uniqueProjectName } from './import';
import { PROJECT_JSON_PATH } from './zip';

/**
 * A record whose stored sha256 is the real hash of its audio — a zip built
 * from it passes import's integrity check, the way real app exports do.
 */
async function hashableRecord(overrides: Partial<ProjectRecord> = {}): Promise<ProjectRecord> {
  const record = projectRecord(overrides);
  return { ...record, audioMeta: { ...record.audioMeta, sha256: await sha256(record.audio) } };
}

/** Imports a zip with the given workspace names and a captured save. */
async function importZip(zip: Blob, existingNames: string[] = []) {
  const save = vi.fn(async () => {});
  const outcome = await importProjectZip(zip, { existingNames, save, now: () => 42_000 });
  return { outcome, save };
}

describe('importProjectZip', () => {
  it('imports a zip as a brand-new project, never reusing the file’s identity', async () => {
    const record = await hashableRecord();
    const zip = await exportProjectZip(record);

    const { outcome, save } = await importZip(zip);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const saved = outcome.project;
    expect(saved.id).not.toBe(record.id); // a fresh identity every time
    expect(saved.name).toBe(record.name);
    expect(saved.createdAt).toBe(42_000);
    expect(saved.updatedAt).toBe(42_000);
    expect(saved.markers).toEqual(record.markers);
    expect(saved.audioMeta).toEqual(record.audioMeta);
    expect(new Uint8Array(await saved.audio.arrayBuffer())).toEqual(
      new Uint8Array(await record.audio.arrayBuffer()),
    );
    expect(save).toHaveBeenCalledWith(saved);
  });

  it('never overwrites: importing the same zip twice yields two distinct projects', async () => {
    const record = await hashableRecord();
    const zip = await exportProjectZip(record);

    const first = await importZip(zip);
    const second = await importZip(zip);

    expect(first.outcome.ok).toBe(true);
    expect(second.outcome.ok).toBe(true);
    if (!first.outcome.ok || !second.outcome.ok) return;
    expect(first.outcome.project.id).not.toBe(second.outcome.project.id);
    expect(first.outcome.project.id).not.toBe(record.id);
  });

  it('tolerates unknown fields and extra zip entries', async () => {
    const record = await hashableRecord();
    const json = JSON.parse(exportLabelSetJson(record)) as Record<string, unknown>;
    json.futureTopLevel = true;
    (json.project as Record<string, unknown>).color = 'blue';
    const zip = new Blob([
      zipSync({
        [PROJECT_JSON_PATH]: strToU8(JSON.stringify(json)),
        [record.audioMeta.filename]: new Uint8Array(await record.audio.arrayBuffer()),
        '__MACOSX/._junk': strToU8('detritus'),
      }),
    ]);

    const { outcome } = await importZip(zip);

    expect(outcome.ok).toBe(true);
  });

  it('rejects a zip whose audio no longer matches its project file', async () => {
    // The stored sha256 is not the audio's real hash — the imported audio is
    // verified against the file's claim and the mismatch is surfaced.
    const record = projectRecord();
    const zip = await exportProjectZip(record);

    const { outcome, save } = await importZip(zip);

    expect(outcome).toEqual({
      ok: false,
      guidance: "The audio in this zip doesn’t match its project file — the file is corrupted.",
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a zip missing its audio entry, naming the expected file', async () => {
    const record = await hashableRecord();
    const zip = new Blob([
      zipSync({ [PROJECT_JSON_PATH]: strToU8(exportLabelSetJson(record)) }),
    ]);

    const { outcome } = await importZip(zip);

    expect(outcome).toEqual({
      ok: false,
      guidance: 'This zip is missing its audio file "brahms.mp3".',
    });
  });

  it('rejects a zip missing project.json', async () => {
    const record = await hashableRecord();
    const zip = new Blob([
      zipSync({ 'just-audio.mp3': new Uint8Array(await record.audio.arrayBuffer()) }),
    ]);

    const { outcome } = await importZip(zip);

    expect(outcome).toEqual({
      ok: false,
      guidance: 'This zip has no project.json — it isn’t a Rehearsal Marks export.',
    });
  });

  it('rejects a zip from a future schema version with the update-the-app explanation', async () => {
    const record = await hashableRecord();
    const json = JSON.parse(exportLabelSetJson(record)) as Record<string, unknown>;
    json.schemaVersion = 2;
    const zip = new Blob([
      zipSync({
        [PROJECT_JSON_PATH]: strToU8(JSON.stringify(json)),
        [record.audioMeta.filename]: new Uint8Array(await record.audio.arrayBuffer()),
      }),
    ]);

    const { outcome } = await importZip(zip);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toContain('schema version 2, but this app supports version 1');
  });

  it('rejects a malformed project.json inside an otherwise valid zip', async () => {
    const zip = new Blob([zipSync({ [PROJECT_JSON_PATH]: strToU8('{not json') })]);

    const { outcome } = await importZip(zip);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toContain('not valid JSON');
  });

  it('rejects bytes that are not a zip at all', async () => {
    const { outcome } = await importZip(new Blob([new Uint8Array([1, 2, 3])]));

    expect(outcome).toEqual({
      ok: false,
      guidance: 'This file isn’t a valid project zip.',
    });
  });

  it('propagates a failed save to the caller', async () => {
    const record = await hashableRecord();
    const zip = await exportProjectZip(record);

    await expect(
      importProjectZip(zip, {
        existingNames: [],
        save: async () => {
          throw new Error('quota exceeded');
        },
      }),
    ).rejects.toThrow('quota exceeded');
  });
});

describe('importLabelSet', () => {
  it('accepts a label set whose recording identity matches and returns its markers', async () => {
    const record = await hashableRecord();
    const json = exportLabelSetJson(record);

    const outcome = importLabelSet(json, record.audioMeta.sha256);

    expect(outcome).toEqual({ ok: true, markers: record.markers });
  });

  it('rejects a label set made for a different recording with the explanation', () => {
    const record = projectRecord();
    const json = exportLabelSetJson(record);

    const outcome = importLabelSet(json, 'f'.repeat(64));

    expect(outcome).toEqual({
      ok: false,
      guidance:
        'This label set was made for a different recording — timestamps only line up on ' +
        'the recording they were made for, so it can’t be applied here.',
    });
  });

  it('rejects a label set from a future schema version with the update-the-app explanation', () => {
    const record = projectRecord();
    const json = JSON.parse(exportLabelSetJson(record)) as Record<string, unknown>;
    json.schemaVersion = 2;

    const outcome = importLabelSet(JSON.stringify(json), record.audioMeta.sha256);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toContain('schema version 2, but this app supports version 1');
  });

  it('rejects text that is not a project file at all', () => {
    const outcome = importLabelSet('{}', 'f'.repeat(64));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toContain('"schemaVersion"');
  });
});

describe('uniqueProjectName', () => {
  it('keeps a free name untouched', () => {
    expect(uniqueProjectName([], 'Brahms')).toBe('Brahms');
    expect(uniqueProjectName(['Mozart'], 'Brahms')).toBe('Brahms');
  });

  it('appends a numeric suffix until the name is free', () => {
    expect(uniqueProjectName(['Brahms'], 'Brahms')).toBe('Brahms (2)');
    expect(uniqueProjectName(['Brahms', 'Brahms (2)'], 'Brahms')).toBe('Brahms (3)');
    expect(uniqueProjectName(['Brahms', 'Brahms (2)', 'Brahms (3)'], 'Brahms')).toBe('Brahms (4)');
  });
});

describe('serializeProjectFile round-trip through the zip', () => {
  it('keeps every marker field intact through zip export and import', async () => {
    const record = await hashableRecord({
      markers: [
        { id: 'm1', time: 30.5, aliases: ['Recap'], createdAt: 1 },
        { id: 'm2', time: 10, aliases: [], createdAt: 2 },
        { id: 'm3', time: 20.25, aliases: ['Coda'], createdAt: 3 },
      ],
    });
    const zip = await exportProjectZip(record);

    const { outcome } = await importZip(zip);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Import returns markers in time order with aliases trimmed by the
    // domain's own validation — ids, times, aliases, and createdAt all
    // survive; only the (re-derived) labels are absent.
    expect(outcome.project.markers).toEqual([
      { id: 'm2', time: 10, aliases: [], createdAt: 2 },
      { id: 'm3', time: 20.25, aliases: ['Coda'], createdAt: 3 },
      { id: 'm1', time: 30.5, aliases: ['Recap'], createdAt: 1 },
    ]);
  });
});
