import { describe, expect, it, vi } from 'vitest';
import { DecodeError } from '../audio';
import { createStorage } from '../storage';
import type { PeakData } from '../audio';
import type { ProjectRecord } from '../storage';
import { uploadAudio } from '../test/project-fixture';
import { createProjectFromUpload, projectNameFromFile, uploadRejection } from './upload';
import type { UploadDependencies } from './upload';

function mp3File(name = 'brahms-op118.mp3'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'audio/mpeg' });
}

const fakePeaks: PeakData = { peaks: [[0, 1]], duration: 123.45 };

/** Pipeline dependencies writing into a fresh fake-indexeddb database. */
async function dependencies(overrides: Partial<UploadDependencies> = {}) {
  const dbName = `upload-test-${crypto.randomUUID()}`;
  const storage = await createStorage({ name: dbName });
  return {
    storage,
    deps: {
      extractPeaks: vi.fn<(blob: Blob) => Promise<PeakData>>(async () => fakePeaks),
      save: (record: ProjectRecord) => storage.projects.save(record),
      now: () => 1_700_000_000_000,
      ...overrides,
    },
  };
}

describe('uploadRejection', () => {
  it('accepts MP3 and M4A by extension, case-insensitively', () => {
    expect(uploadRejection({ name: 'brahms.mp3', type: 'audio/mpeg' })).toBeNull();
    expect(uploadRejection({ name: 'brahms.MP3', type: '' })).toBeNull();
    expect(uploadRejection({ name: 'brahms.m4a', type: 'audio/mp4' })).toBeNull();
    expect(uploadRejection({ name: 'brahms.M4A', type: '' })).toBeNull();
  });

  it('falls back to the MIME type for extensionless files', () => {
    expect(uploadRejection({ name: 'recording', type: 'audio/mpeg' })).toBeNull();
    expect(uploadRejection({ name: 'recording', type: 'audio/x-m4a' })).toBeNull();
  });

  it('judges a present extension by name, so an audio MIME type cannot smuggle a video through', () => {
    expect(uploadRejection({ name: 'recording.mp4', type: 'audio/mp4' })).not.toBeNull();
    expect(uploadRejection({ name: 'recording.bin', type: 'audio/x-m4a' })).not.toBeNull();
    expect(uploadRejection({ name: 'recording.wav', type: 'audio/mpeg' })).toMatch(/WAV/);
  });

  it('rejects WAV with friendly conversion guidance', () => {
    const guidance = uploadRejection({ name: 'brahms.wav', type: 'audio/wav' })!;
    expect(guidance).toMatch(/WAV/);
    expect(guidance).toMatch(/convert/i);
    expect(guidance).toMatch(/MP3|M4A/);
  });

  it('rejects FLAC with friendly conversion guidance', () => {
    const guidance = uploadRejection({ name: 'brahms.flac', type: 'audio/flac' })!;
    expect(guidance).toMatch(/FLAC/);
    expect(guidance).toMatch(/convert/i);
  });

  it('rejects anything else', () => {
    expect(uploadRejection({ name: 'brahms.ogg', type: 'audio/ogg' })).toMatch(/MP3|M4A/);
    expect(uploadRejection({ name: 'score.pdf', type: 'application/pdf' })).not.toBeNull();
  });
});

describe('projectNameFromFile', () => {
  it('names the project after the file minus its extension', () => {
    expect(projectNameFromFile('brahms-op118.mp3')).toBe('brahms-op118');
    expect(projectNameFromFile('brahms.op118.M4A')).toBe('brahms.op118');
    expect(projectNameFromFile('no-extension')).toBe('no-extension');
  });

  it('falls back to the full name when only an extension is given', () => {
    expect(projectNameFromFile('.mp3')).toBe('.mp3');
  });
});

describe('createProjectFromUpload', () => {
  it('creates and persists a project named after the file with recording identity', async () => {
    const { storage, deps } = await dependencies();

    const outcome = await createProjectFromUpload(mp3File(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { project, peaks } = outcome;
    expect(project.name).toBe('brahms-op118');
    expect(project.markers).toEqual([]);
    expect(project.source).toBe('upload');
    expect(project.playerMode).toBe('label');
    expect(project.audioMeta).toMatchObject({
      duration: 123.45,
      mimeType: 'audio/mpeg',
      filename: 'brahms-op118.mp3',
      sizeBytes: 4,
      source: '',
      license: '',
      attribution: '',
    });
    // sha256 is computed once at import, from the actual file bytes.
    expect(project.audioMeta.sha256).toBe(
      '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
    );
    expect(peaks).toEqual(fakePeaks);

    // IndexedDB stores files as blobs; the round-trip returns a Blob with the
    // same bytes and type — and the record stays upload-shaped end to end.
    const stored = await storage.projects.get(project.id);
    expect(stored!.source).toBe('upload');
    expect(stored!.playerMode).toBe('label');
    const storedAudio = uploadAudio(stored!);
    expect(storedAudio).toBeInstanceOf(Blob);
    expect(storedAudio.size).toBe(4);
    expect(storedAudio.type).toBe('audio/mpeg');
    expect({ ...stored!, audio: undefined }).toEqual({ ...project, audio: undefined });
    storage.close();
  });

  it('still creates the project when decoding fails — without peaks', async () => {
    const { storage, deps } = await dependencies({
      extractPeaks: vi.fn(async () => {
        throw new DecodeError(new Error('not audio'));
      }),
    });

    const outcome = await createProjectFromUpload(mp3File(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.peaks).toBeNull();
    expect(outcome.project.audioMeta.duration).toBe(0);
    expect(await storage.projects.get(outcome.project.id)).toBeDefined();
    storage.close();
  });

  it('rejects an unsupported format with guidance and stores nothing', async () => {
    const { storage, deps } = await dependencies();
    const wav = new File([new Uint8Array([1, 2])], 'brahms.wav', { type: 'audio/wav' });

    const outcome = await createProjectFromUpload(wav, deps);

    expect(outcome).toEqual({ ok: false, guidance: expect.stringContaining('WAV') });
    expect(deps.extractPeaks).not.toHaveBeenCalled();
    expect(await storage.projects.list()).toEqual([]);
    storage.close();
  });

  it('propagates unexpected extraction failures', async () => {
    const { storage, deps } = await dependencies({
      extractPeaks: vi.fn(async () => {
        throw new Error('out of memory');
      }),
    });

    await expect(createProjectFromUpload(mp3File(), deps)).rejects.toThrow('out of memory');
    expect(await storage.projects.list()).toEqual([]);
    storage.close();
  });

  it('propagates storage failures', async () => {
    const { deps } = await dependencies();
    // Translation to StorageError is the repository's job (covered in T03);
    // the pipeline just propagates whatever save rejects with.
    await expect(
      createProjectFromUpload(mp3File(), {
        ...deps,
        save: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
  });
});
