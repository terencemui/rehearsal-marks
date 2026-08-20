import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../storage';
import type { ProjectRecord } from '../storage';
import { projectRecord, uploadAudio, youtubeProjectRecord } from '../test/project-fixture';
import { exportLabelSetJson, exportProjectJson, exportProjectZip } from './export';
import { importLabelSet, importProjectJson, importProjectZip, uniqueProjectName } from './import';
import { PROJECT_JSON_PATH } from './zip';

const CANONICAL_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

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

/** A YouTube project file exactly as the app exports one. */
function youtubeProjectFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    project: {
      id: 'file-1',
      name: 'Brahms on YouTube',
      createdAt: 5,
      updatedAt: 6,
      source: 'youtube',
    },
    // Written in time order, as the app's own serializer does.
    markers: [
      { id: 'm2', time: 10, aliases: [], createdAt: 2 },
      { id: 'm1', time: 30, aliases: ['Recap'], createdAt: 1 },
    ],
    audioMeta: {
      sha256: '',
      duration: 600,
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

/** Imports a bare JSON file with the given workspace names and a captured save. */
async function importJson(text: string, existingNames: string[] = []) {
  const save = vi.fn(async () => {});
  const outcome = await importProjectJson(text, { existingNames, save, now: () => 42_000 });
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

  it('rejects a zip whose project file is marked YouTube — that export is a bare JSON', async () => {
    const file = JSON.parse(youtubeProjectFile()) as Record<string, unknown>;
    const zip = new Blob([zipSync({ [PROJECT_JSON_PATH]: strToU8(JSON.stringify(file)) })]);

    const { outcome, save } = await importZip(zip);

    expect(outcome).toEqual({
      ok: false,
      guidance:
        'This zip contains a YouTube project file. YouTube projects carry no audio — they export as a single JSON file, not a zip.',
    });
    expect(save).not.toHaveBeenCalled();
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

describe('importProjectJson', () => {
  it('imports a YouTube-marked file as a brand-new YouTube project — fresh identity, no audio', async () => {
    const { outcome, save } = await importJson(youtubeProjectFile());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const saved = outcome.project;
    expect(saved.id).not.toBe('file-1'); // a fresh identity — the file's id is never reused
    expect(saved.name).toBe('Brahms on YouTube');
    expect(saved.createdAt).toBe(42_000);
    expect(saved.updatedAt).toBe(42_000);
    expect(saved.source).toBe('youtube');
    expect(saved.audio).toBeNull();
    // The file's identity fields carry through: the canonical URL is the
    // recording identity, duration the soft check, filename the title.
    expect(saved.audioMeta).toEqual({
      sha256: '',
      duration: 600,
      mimeType: '',
      filename: 'Brahms Intermezzo',
      sizeBytes: 0,
      source: CANONICAL_URL,
      license: '',
      attribution: '',
    });
    // Markers arrive in time order, aliases validated by the domain's own
    // rules — exactly as the zip path delivers them.
    expect(saved.markers).toEqual([
      { id: 'm2', time: 10, aliases: [], createdAt: 2 },
      { id: 'm1', time: 30, aliases: ['Recap'], createdAt: 1 },
    ]);
    // Arrived with marks — the first-open posture is Playback, ready to practise.
    expect(saved.playerMode).toBe('playback');
    expect(save).toHaveBeenCalledWith(saved);
  });

  it('never validates sha256 — a YouTube file imports even when its sha256 claim lies', async () => {
    const file = JSON.parse(youtubeProjectFile()) as { audioMeta: Record<string, unknown> };
    file.audioMeta.sha256 = 'f'.repeat(64); // there is no audio to hash, so the claim is ignored

    const { outcome } = await importJson(JSON.stringify(file));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.audioMeta.sha256).toBe(''); // normalized, never trusted
  });

  it('stores the canonical URL whatever link form the file carries', async () => {
    const file = JSON.parse(youtubeProjectFile()) as { audioMeta: Record<string, unknown> };
    file.audioMeta.source = 'https://youtu.be/dQw4w9WgXcQ'; // an accepted form, not the canonical one

    const { outcome } = await importJson(JSON.stringify(file));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.audioMeta.source).toBe(CANONICAL_URL);
  });

  it('never overwrites: importing the same file twice yields two distinct projects', async () => {
    const first = await importJson(youtubeProjectFile());
    const second = await importJson(youtubeProjectFile());

    expect(first.outcome.ok).toBe(true);
    expect(second.outcome.ok).toBe(true);
    if (!first.outcome.ok || !second.outcome.ok) return;
    expect(first.outcome.project.id).not.toBe(second.outcome.project.id);
    expect(first.outcome.project.id).not.toBe('file-1');
  });

  it('names a collision-free project against the workspace, as the zip path does', async () => {
    const { outcome } = await importJson(youtubeProjectFile(), ['Brahms on YouTube']);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.name).toBe('Brahms on YouTube (2)');
  });

  it('rejects an upload-marked file — a bare JSON has no audio to become a project', async () => {
    const file = JSON.parse(youtubeProjectFile()) as { project: Record<string, unknown> };
    file.project.source = 'upload';

    const { outcome, save } = await importJson(JSON.stringify(file));

    expect(outcome).toEqual({
      ok: false,
      guidance:
        'This file has no audio to import as a project — apply it as a label set to the recording it was made for instead.',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('treats a file with no discriminator as upload-shaped', async () => {
    const file = JSON.parse(youtubeProjectFile()) as { project: Record<string, unknown> };
    delete file.project.source;

    const { outcome, save } = await importJson(JSON.stringify(file));

    expect(outcome.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects text that is not a project file at all', async () => {
    const { outcome } = await importJson('{not json');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toContain('not valid JSON');
  });

  it('propagates a failed save to the caller', async () => {
    await expect(
      importProjectJson(youtubeProjectFile(), {
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

  it('rejects a YouTube-marked label set — label-set application is uploads-only', () => {
    const outcome = importLabelSet(youtubeProjectFile(), 'a'.repeat(64));

    expect(outcome).toEqual({
      ok: false,
      guidance:
        'This label set was made for a YouTube video — label sets apply only to uploaded ' +
        'recordings, so it can’t be applied to a project.',
    });
  });

  it('rejects applying any label set to a YouTube project — there is no hash to gate against', () => {
    const record = projectRecord();
    const json = exportLabelSetJson(record);

    const outcome = importLabelSet(json, '');

    expect(outcome).toEqual({
      ok: false,
      guidance:
        'Label sets apply only to uploaded recordings — a YouTube project has no recording ' +
        'hash to match one against, so it can’t be applied here.',
    });
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

describe('YouTube round-trip through the bare JSON', () => {
  it('export then import preserves source, canonical URL, duration, and markers', async () => {
    const record = youtubeProjectRecord({
      audioMeta: {
        sha256: '',
        duration: 300.5,
        mimeType: '',
        filename: 'Brahms Intermezzo',
        sizeBytes: 0,
        source: CANONICAL_URL,
        license: '',
        attribution: '',
      },
      markers: [
        { id: 'm1', time: 30, aliases: ['Recap'], createdAt: 1 },
        { id: 'm2', time: 10, aliases: [], createdAt: 2 },
      ],
    });

    const { outcome } = await importJson(exportProjectJson(record));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const imported = outcome.project;
    expect(imported.id).not.toBe(record.id);
    expect(imported.name).toBe(record.name);
    expect(imported.source).toBe('youtube');
    expect(imported.audio).toBeNull();
    expect(imported.audioMeta).toEqual(record.audioMeta);
    expect(imported.markers).toEqual([
      { id: 'm2', time: 10, aliases: [], createdAt: 2 },
      { id: 'm1', time: 30, aliases: ['Recap'], createdAt: 1 },
    ]);
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
