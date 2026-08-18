import { describe, expect, it, vi } from 'vitest';
import { parseProjectFile, serializeProjectFile } from '../domain';
import type { Marker, ProjectFileData } from '../domain';
import { projectRecord } from '../test/project-fixture';
import { StorageError } from './errors';
import { createStorage } from './repository';

const testStorage = () => createStorage({ name: `repo-test-${crypto.randomUUID()}` });

/** A parsed label set with full recording identity — the library's trust anchor. */
function labelset(markers: Marker[] = []): ProjectFileData {
  return parseProjectFile(
    serializeProjectFile({
      project: { id: 'lib-1', name: 'Library piece', createdAt: 0, updatedAt: 0 },
      markers,
      audioMeta: {
        sha256: 'lib-hash',
        duration: 60,
        mimeType: 'audio/mpeg',
        filename: 'piece.mp3',
        sizeBytes: 2,
        source: 'https://example.org/piece.mp3',
        license: 'CC0',
        attribution: 'Someone',
      },
    }),
  );
}

/**
 * Expected stored size for the fixture record, computed by hand: the 4-byte
 * audio blob plus the UTF-8 byte length of the serialized name, audioMeta,
 * and markers (281 bytes). Hardcoded deliberately — it pins the estimate's
 * definition, so a change to what counts as "stored" fails this test.
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
    expect(await blobBytes(loaded!.audio)).toEqual(await blobBytes(record.audio));
    expect(loaded!.audio.type).toBe('audio/mpeg');
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
    });
    expect(summaries[1].sizeBytes).toBe(FIXTURE_STORED_SIZE);
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

describe('library-cache repository', () => {
  it('round-trips a cached entry: audio blob and label set intact', async () => {
    const storage = await testStorage();
    const entryLabelset = labelset([{ id: 'm1', time: 10, aliases: [], createdAt: 0 }]);
    const entry = {
      id: 'entry-1',
      audio: new Blob([new Uint8Array([9, 9])], { type: 'audio/mpeg' }),
      labelset: entryLabelset,
      cachedAt: 1_700_000_000_000,
    };

    await storage.library.save(entry);
    const loaded = await storage.library.get('entry-1');

    expect(loaded!.cachedAt).toBe(entry.cachedAt);
    expect(loaded!.labelset).toEqual(entry.labelset);
    expect(await blobBytes(loaded!.audio)).toEqual([9, 9]);
    storage.close();
  });

  it('lists summaries with size and cached time, newest first', async () => {
    const storage = await testStorage();
    const ls = labelset();
    await storage.library.save({
      id: 'old',
      audio: new Blob([new Uint8Array([1])]),
      labelset: ls,
      cachedAt: 1_000,
    });
    await storage.library.save({
      id: 'new',
      audio: new Blob([new Uint8Array([2])]),
      labelset: ls,
      cachedAt: 2_000,
    });

    expect(await storage.library.list()).toEqual([
      { id: 'new', sizeBytes: 1, cachedAt: 2_000 },
      { id: 'old', sizeBytes: 1, cachedAt: 1_000 },
    ]);
    storage.close();
  });

  it('evicts one entry without touching projects', async () => {
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    const ls = labelset();
    await storage.library.save({ id: 'keep', audio: new Blob([new Uint8Array([1])]), labelset: ls, cachedAt: 1 });
    await storage.library.save({ id: 'drop', audio: new Blob([new Uint8Array([1])]), labelset: ls, cachedAt: 2 });

    await storage.library.evict('drop');

    expect(await storage.library.get('drop')).toBeUndefined();
    expect(await storage.library.get('keep')).not.toBeUndefined();
    expect(await storage.projects.get('project-1')).not.toBeUndefined();
    storage.close();
  });

  it('evicts the whole cache without touching projects', async () => {
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    const ls = labelset();
    await storage.library.save({ id: 'e1', audio: new Blob([new Uint8Array([1])]), labelset: ls, cachedAt: 1 });
    await storage.library.save({ id: 'e2', audio: new Blob([new Uint8Array([1])]), labelset: ls, cachedAt: 2 });

    await storage.library.evictAll();

    expect(await storage.library.list()).toEqual([]);
    expect(await storage.projects.get('project-1')).not.toBeUndefined();
    storage.close();
  });
});
