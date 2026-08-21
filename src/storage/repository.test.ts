import { describe, expect, it, vi } from 'vitest';
import { projectRecord, uploadAudio, youtubeProjectRecord } from '../test/project-fixture';
import { StorageError } from './errors';
import { createStorage } from './repository';

const testStorage = () => createStorage({ name: `repo-test-${crypto.randomUUID()}` });

/**
 * Expected stored size for the summary-test records below, computed by hand:
 * the 4-byte audio blob plus the UTF-8 byte length of the serialized name
 * (the 5-character "Older"/"Newer"), audioMeta, and markers — 281 bytes.
 * Hardcoded deliberately — it pins the estimate's definition, so a change to
 * what counts as "stored" fails this test.
 */
const FIXTURE_STORED_SIZE = 285;

async function blobBytes(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

describe('project repository', () => {
  it('round-trips a project: audio blob, markers, and audioMeta intact', async () => {
    const storage = await testStorage();
    const record = projectRecord({
      markers: [
        { id: 'm1', time: 10, aliases: ['Recap'], createdAt: 111 },
        { id: 'm2', time: 222.35, aliases: [], createdAt: 222 },
      ],
    });

    await storage.projects.save(record);
    const loaded = await storage.projects.get(record.id);

    expect(loaded).not.toBeUndefined();
    expect(loaded!.id).toBe(record.id);
    expect(loaded!.name).toBe(record.name);
    expect(loaded!.createdAt).toBe(record.createdAt);
    expect(loaded!.updatedAt).toBe(record.updatedAt);
    expect(loaded!.markers).toEqual(record.markers);
    expect(loaded!.audioMeta).toEqual(record.audioMeta);
    expect(loaded!.source).toBe('upload');
    expect(loaded!.playerMode).toBe('label');
    expect(await blobBytes(uploadAudio(loaded!))).toEqual(await blobBytes(uploadAudio(record)));
    expect(uploadAudio(loaded!).type).toBe('audio/mpeg');
    storage.close();
  });

  it('round-trips a YouTube project: null audio, the source discriminator, and the player mode', async () => {
    const storage = await testStorage();
    const record = youtubeProjectRecord({ name: 'Chopin Ballade No. 1' });

    await storage.projects.save(record);
    const loaded = await storage.projects.get(record.id);

    expect(loaded).not.toBeUndefined();
    expect(loaded!.name).toBe('Chopin Ballade No. 1');
    expect(loaded!.source).toBe('youtube');
    expect(loaded!.audio).toBeNull();
    expect(loaded!.playerMode).toBe('playback');
    expect(loaded!.markers).toEqual(record.markers);
    expect(loaded!.audioMeta).toEqual(record.audioMeta);
    storage.close();
  });

  it('returns undefined for an unknown project', async () => {
    const storage = await testStorage();
    expect(await storage.projects.get('missing')).toBeUndefined();
    storage.close();
  });

  it('lists summaries with name, duration, marker count, size, last-modified — newest first', async () => {
    const storage = await testStorage();
    const older = projectRecord({ id: 'a', name: 'Older', updatedAt: 1_000 });
    const newer = projectRecord({ id: 'b', name: 'Newer', updatedAt: 2_000 });

    await storage.projects.save(older);
    await storage.projects.save(newer);

    const summaries = await storage.projects.list();
    expect(summaries.map((s) => s.id)).toEqual(['b', 'a']);
    expect(summaries[0]).toEqual({
      id: 'b',
      name: 'Newer',
      duration: 123.456,
      markerCount: 2,
      sizeBytes: FIXTURE_STORED_SIZE,
      updatedAt: 2_000,
      source: 'upload',
      audioUrl: '',
      sha256: 'abc123',
    });
    expect(summaries[1].sizeBytes).toBe(FIXTURE_STORED_SIZE);
    storage.close();
  });

  it('summarizes a YouTube project at its data-only size — null audio adds no bytes', async () => {
    const storage = await testStorage();
    await storage.projects.save(projectRecord({ id: 'upload', name: 'Chopin Ballade' }));
    await storage.projects.save(youtubeProjectRecord({ id: 'youtube', name: 'Chopin Ballade' }));

    const summaries = await storage.projects.list();
    const upload = summaries.find((s) => s.id === 'upload')!;
    const youtube = summaries.find((s) => s.id === 'youtube')!;

    // Same name, audioMeta, and markers — the only stored difference is the
    // recording itself, so the null-audio estimate is exactly 4 bytes less.
    expect(youtube.sizeBytes).toBe(upload.sizeBytes - 4);
    storage.close();
  });

  it('removes a project, and removing an unknown id is a no-op', async () => {
    const storage = await testStorage();
    await storage.projects.save(projectRecord());

    await storage.projects.remove('project-1');
    expect(await storage.projects.get('project-1')).toBeUndefined();
    await expect(storage.projects.remove('never-existed')).resolves.toBeUndefined();
    storage.close();
  });

  it('persists across connections to the same database', async () => {
    const name = `repo-test-${crypto.randomUUID()}`;
    const first = await createStorage({ name });
    await first.projects.save(projectRecord());
    first.close();

    const second = await createStorage({ name });
    expect((await second.projects.get('project-1'))?.name).toBe('Brahms Op. 118 No. 2');
    second.close();
  });

  it('surfaces QuotaExceededError as a storage-full StorageError', async () => {
    const storage = await testStorage();
    // fake-indexeddb cannot provoke QuotaExceededError; throwing it from `put`
    // is the only way to exercise the quota path at the storage seam.
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

    const error = await storage.projects.save(projectRecord()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).code).toBe('storage-full');
    expect((error as StorageError).message).toMatch(/export/i);

    putSpy.mockRestore();
    storage.close();
  });

  it('leaves non-quota failures untouched', async () => {
    const storage = await testStorage();
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(() => {
        throw new TypeError('boom');
      });

    const error = await storage.projects.save(projectRecord()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(StorageError);

    putSpy.mockRestore();
    storage.close();
  });
});
