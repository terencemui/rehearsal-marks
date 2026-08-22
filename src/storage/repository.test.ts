import { describe, expect, it, vi } from 'vitest';
import { projectRecord } from '../test/project-fixture';
import { StorageError } from './errors';
import { createStorage } from './repository';

const testStorage = () => createStorage({ name: `repo-test-${crypto.randomUUID()}` });

describe('project repository', () => {
  it('round-trips a project: identity, markers, and the player mode intact', async () => {
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
    expect(loaded!.videoId).toBe(record.videoId);
    expect(loaded!.duration).toBe(record.duration);
    expect(loaded!.markers).toEqual(record.markers);
    expect(loaded!.playerMode).toBe('label');
    storage.close();
  });

  it('returns undefined for an unknown project', async () => {
    const storage = await testStorage();
    expect(await storage.projects.get('missing')).toBeUndefined();
    storage.close();
  });

  it('lists summaries with name, duration, marker count, and last-modified — newest first', async () => {
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
      updatedAt: 2_000,
    });
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

  it('turns a quota failure into a generic error — no storage-full code', async () => {
    const storage = await testStorage();
    // fake-indexeddb cannot provoke QuotaExceededError; throwing it from `put`
    // is the only way to exercise the quota path at the storage seam.
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

    const error = await storage.projects.save(projectRecord()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(StorageError);

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
