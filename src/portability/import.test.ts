import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../storage';
import type { ProjectRecord } from '../storage';
import { projectRecord, uploadAudio, youtubeProjectRecord } from '../test/project-fixture';
import { exportLabelSetJson, exportProjectJson, exportProjectZip } from './export';
import { importLabelSet, importProjectJson, importProjectZip, uniqueProjectName } from './import';
import { PROJECT_JSON_PATH } from './zip';

/** An upload-shaped record whose audio is known non-null. */
type UploadRecord = ProjectRecord & { audio: Blob };

/**
 * A record whose stored sha256 is the real hash of its audio — a zip built
 * from it passes import's integrity check, the way real app exports do.
 */
async function hashableRecord(overrides: Partial<ProjectRecord> = {}): Promise<UploadRecord> {
  const record = projectRecord(overrides);
  const audio = uploadAudio(record);
  return { ...record, audio, audioMeta: { ...record.audioMeta, sha256: await sha256(audio) } };
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
    expect(saved.source).toBe('upload');
    expect(saved.playerMode).toBe('label');
    expect(new Uint8Array(await uploadAudio(saved).arrayBuffer())).toEqual(
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

describe('importProjectJson', () => {
  /** A YouTube project with the canonical URL as its recording identity. */
  function youtubeRecord(): ProjectRecord {
    return youtubeProjectRecord({
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
  }

  /** The record's exported JSON — the community contribution format. */
  function youtubeJson(): string {
    return exportProjectJson(youtubeRecord());
  }

  async function importJson(json: string, existingNames: string[] = []) {
    const save = vi.fn(async () => {});
    const outcome = await importProjectJson(new Blob([json], { type: 'application/json' }), {
      existingNames,
      save,
      now: () => 42_000,
    });
    return { outcome, save };
  }

  it('imports a YouTube-marked file as a fresh full project, skipping sha256 validation', async () => {
    const record = youtubeRecord();
    const { outcome, save } = await importJson(youtubeJson());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const project = outcome.project;
    expect(project.id).not.toBe(record.id); // a fresh identity every time
    expect(project.name).toBe(record.name);
    expect(project.createdAt).toBe(42_000);
    expect(project.updatedAt).toBe(42_000);
    // The project points at the video, holds no audio, and copies the marks.
    expect(project.source).toBe('youtube');
    expect(project.audio).toBeNull();
    expect(project.audioMeta).toEqual(record.audioMeta);
    expect(project.markers).toEqual(record.markers);
    // Marks arrived with the file, so the source's own default applies:
    // immediately practiceable projects open in Playback.
    expect(project.playerMode).toBe('playback');
    expect(save).toHaveBeenCalledWith(project);
  });

  it('round-trips: an exported YouTube project imports as a project pointing at the same video', async () => {
    const { outcome } = await importJson(youtubeJson());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.audioMeta.source).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('imports a YouTube file with no marks in Label mode (the otherwise case)', async () => {
    const record = youtubeRecord();
    const json = exportProjectJson({ ...record, markers: [] });

    const { outcome } = await importJson(json);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.playerMode).toBe('label');
  });

  it('never overwrites an existing project name', async () => {
    const { outcome } = await importJson(youtubeJson(), ['Brahms Op. 118 No. 2']);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.name).toBe('Brahms Op. 118 No. 2 (2)');
  });

  it('rejects a file whose URL is not a YouTube link, even when marked youtube', async () => {
    const record = youtubeProjectRecord();
    const parsed = JSON.parse(exportProjectJson(record)) as Record<string, unknown>;
    (parsed.audioMeta as Record<string, unknown>).source = 'https://example.com/not-youtube';

    const { outcome, save } = await importJson(JSON.stringify(parsed));

    expect(outcome.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a label-set JSON for an uploaded recording with its own guidance', async () => {
    const record = projectRecord();
    const { outcome, save } = await importJson(exportLabelSetJson(record));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toContain('Import labels');
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects text that is not a project file', async () => {
    const { outcome } = await importJson('{not json');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toContain('not valid JSON');
  });

  it('propagates a failed save to the caller', async () => {
    await expect(
      importProjectJson(new Blob([youtubeJson()]), {
        existingNames: [],
        save: async () => {
          throw new Error('quota exceeded');
        },
      }),
    ).rejects.toThrow('quota exceeded');
  });
});

describe('importLabelSet and YouTube projects', () => {
  it('rejects a YouTube-marked file — label sets apply only to uploaded recordings', () => {
    const json = exportProjectJson(
      youtubeProjectRecord({
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
      }),
    );

    const outcome = importLabelSet(json, 'f'.repeat(64));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toContain('YouTube');
  });
});
