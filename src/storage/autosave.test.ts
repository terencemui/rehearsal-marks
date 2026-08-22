import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectRecord } from '../test/project-fixture';
import { createAutosave } from './autosave';
import type { Autosave, SaveStatus } from './autosave';
import { StorageError } from './errors';
import type { ProjectRecord } from './records';
import { createStorage } from './repository';

/** An autosave whose writes land in a real fake-indexeddb database. */
async function integrationAutosave(
  record: ProjectRecord = projectRecord(),
): Promise<{ autosave: Autosave; name: string }> {
  const name = `autosave-test-${crypto.randomUUID()}`;
  const storage = await createStorage({ name });
  const autosave = createAutosave(record, {
    save: (next) => storage.projects.save(next),
  });
  return { autosave, name };
}

describe('createAutosave', () => {
  beforeEach(() => {
    // Fake only setTimeout — fake-indexeddb's transactions run on microtasks,
    // which the default fake-timer set would also freeze.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a mutation in memory immediately and stamps updatedAt', async () => {
    const save = vi.fn<(record: ProjectRecord) => Promise<void>>(async () => undefined);
    const autosave = createAutosave(projectRecord({ updatedAt: 1 }), { save });

    const next = autosave.mutate((current) => ({ ...current, name: 'Renamed' }));

    expect(next.name).toBe('Renamed');
    expect(next.updatedAt).toBeGreaterThan(1);
    expect(autosave.get().name).toBe('Renamed');
    expect(save).not.toHaveBeenCalled();
  });

  it('debounces rapid mutations into a single save of the final state', async () => {
    const save = vi.fn<(record: ProjectRecord) => Promise<void>>(async () => undefined);
    const autosave = createAutosave(projectRecord(), { save });

    autosave.mutate((c) => ({ ...c, name: 'First' }));
    await vi.advanceTimersByTimeAsync(300);
    autosave.mutate((c) => ({ ...c, name: 'Second' }));
    await vi.advanceTimersByTimeAsync(300);
    autosave.mutate((c) => ({ ...c, name: 'Third' }));
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].name).toBe('Third');
  });

  it('walks idle → dirty → saving → saved across a save', async () => {
    const save = vi.fn<(record: ProjectRecord) => Promise<void>>(async () => undefined);
    const autosave = createAutosave(projectRecord(), { save });
    const seen: SaveStatus[] = [];
    autosave.subscribe((status) => seen.push(status));

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(seen).toEqual(['dirty', 'saving', 'saved']);
    expect(autosave.status()).toBe('saved');
  });

  it('flush saves immediately and cancels the pending debounce', async () => {
    const save = vi.fn<(record: ProjectRecord) => Promise<void>>(async () => undefined);
    const autosave = createAutosave(projectRecord(), { save });

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await autosave.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.status()).toBe('saved');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('re-saves when a mutation lands while a save is in flight', async () => {
    const save = vi.fn<(record: ProjectRecord) => Promise<void>>(async () => undefined);
    let releaseFirstSave: () => void = () => undefined;
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstSave = () => resolve();
        }),
    );
    const autosave = createAutosave(projectRecord(), { save });

    autosave.mutate((c) => ({ ...c, name: 'Before save' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);

    // Mutated while the first write is still in flight.
    autosave.mutate((c) => ({ ...c, name: 'During save' }));
    releaseFirstSave();
    await vi.advanceTimersByTimeAsync(500);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].name).toBe('During save');
    expect(autosave.status()).toBe('saved');
  });

  it('surfaces a quota failure as storage-full, then recovers on the next save', async () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    const save = vi.fn<(record: ProjectRecord) => Promise<void>>(async () => {
      throw quotaError;
    });
    const autosave = createAutosave(projectRecord(), { save });
    const seen: SaveStatus[] = [];
    autosave.subscribe((status) => seen.push(status));

    autosave.mutate((c) => ({ ...c, name: 'Too big' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(seen).toEqual(['dirty', 'saving', 'storage-full']);
    expect(autosave.status()).toBe('storage-full');
    expect(autosave.error()).toBeInstanceOf(StorageError);
    expect((autosave.error() as StorageError).code).toBe('storage-full');

    // The user freed space; the next mutation must retry and succeed.
    save.mockImplementation(async () => undefined);
    autosave.mutate((c) => ({ ...c, name: 'Fits now' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(autosave.status()).toBe('saved');
    expect(seen.at(-1)).toBe('saved');
  });

  it('reports non-quota write failures as error', async () => {
    const save = vi.fn<(record: ProjectRecord) => Promise<void>>(async () => {
      throw new Error('disk gone');
    });
    const autosave = createAutosave(projectRecord(), { save });

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(autosave.status()).toBe('error');
    expect(autosave.error()).toBeInstanceOf(Error);
  });

  it('dispose cancels a pending save and silences listeners', async () => {
    const save = vi.fn<(record: ProjectRecord) => Promise<void>>(async () => undefined);
    const autosave = createAutosave(projectRecord(), { save });
    const seen: SaveStatus[] = [];
    const unsubscribe = autosave.subscribe((status) => seen.push(status));

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    unsubscribe();
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(save).not.toHaveBeenCalled();
    expect(seen).toEqual(['dirty']);
  });

  it('flush rejects with the quota failure instead of hanging', async () => {
    const save = vi.fn<(record: ProjectRecord) => Promise<void>>(async () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    const autosave = createAutosave(projectRecord(), { save });

    autosave.mutate((c) => ({ ...c, name: 'Too big' }));
    await expect(autosave.flush()).rejects.toMatchObject({ code: 'storage-full' });
    expect(autosave.status()).toBe('storage-full');
  });

  it('persists through the real repository', async () => {
    const { autosave, name } = await integrationAutosave();

    autosave.mutate((c) => ({
      ...c,
      markers: [...c.markers, { id: 'm3', time: 30, aliases: [], createdAt: 0 }],
    }));
    await autosave.flush();

    const storage = await createStorage({ name });
    const loaded = await storage.projects.get('project-1');
    expect(loaded!.markers.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    storage.close();
  });
});
