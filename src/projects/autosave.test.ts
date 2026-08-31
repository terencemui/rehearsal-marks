import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverProject } from '../test/server-project-fixture';
import { createAutosave, createProjectSave, type Autosave, type SaveStatus } from './autosave';
import type { ProjectUpdate, ServerProject } from './types';

describe('createAutosave', () => {
  beforeEach(() => {
    // Fake only setTimeout — the save callback resolves on microtasks, which
    // the default fake-timer set would also freeze.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a mutation in memory immediately, without touching the server stamp', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async (record) => record);
    const autosave = createAutosave(serverProject({ updatedAt: 1_700_000_000_000 }), { save });

    const next = autosave.mutate((current) => ({ ...current, name: 'Renamed' }));

    expect(next.name).toBe('Renamed');
    // The server owns updated_at; a local mutation must not rewrite it.
    expect(next.updatedAt).toBe(1_700_000_000_000);
    expect(autosave.get().name).toBe('Renamed');
    expect(save).not.toHaveBeenCalled();
  });

  it('debounces rapid mutations into a single save of the final state', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async (record) => record);
    const autosave = createAutosave(serverProject(), { save });

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
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async (record) => record);
    const autosave = createAutosave(serverProject(), { save });
    const seen: SaveStatus[] = [];
    autosave.subscribe((status) => seen.push(status));

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(seen).toEqual(['dirty', 'saving', 'saved']);
    expect(autosave.status()).toBe('saved');
  });

  it('surfaces in its status a save that returned a published project to the queue', async () => {
    // The T49 review trigger returns an owner's edit of a published public
    // project to pending; the save line must say so (T52). The save callback
    // answers with the row the server holds after the write.
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async () =>
      serverProject({ publicationStatus: 'pending' }),
    );
    const autosave = createAutosave(serverProject(), { save });
    const seen: SaveStatus[] = [];
    autosave.subscribe((status) => seen.push(status));

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(seen).toEqual(['dirty', 'saving', 'saved-review']);
    expect(autosave.status()).toBe('saved-review');
  });

  it('keeps the review claim when the re-save after a demotion skips', async () => {
    // The rename's write returns the demoted row; the duration-only re-save
    // that lands behind it is skipped, and the skip must answer with the
    // server's last confirmed state, not the stale loaded record — otherwise
    // the save line reverts to plain "Saved" for a project the server just
    // returned to review (T52). The page wires exactly this: the real
    // createProjectSave over the API, under the controller's debounce.
    const saveProject = vi.fn<(id: string, update: ProjectUpdate) => Promise<ServerProject>>(
      async () => serverProject({ publicationStatus: 'pending' }),
    );
    let releaseFirstSave: () => void = () => undefined;
    saveProject.mockImplementationOnce(
      () =>
        new Promise<ServerProject>((resolve) => {
          releaseFirstSave = () => resolve(serverProject({ publicationStatus: 'pending' }));
        }),
    );
    const initial = serverProject();
    const autosave = createAutosave(initial, {
      save: createProjectSave({ saveProject }, initial),
    });
    const seen: SaveStatus[] = [];
    autosave.subscribe((status) => seen.push(status));

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(saveProject).toHaveBeenCalledTimes(1);

    // The player stamps the duration while the rename's write is in flight.
    autosave.mutate((c) => ({ ...c, duration: 456.789 }));
    releaseFirstSave();
    await vi.advanceTimersByTimeAsync(500);

    // The re-save is a skip — no second wire write — but its answer must still
    // carry the demotion, so the line's "back to review" claim survives.
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(autosave.status()).toBe('saved-review');
    expect(seen.at(-1)).toBe('saved-review');
  });

  it('keeps plain Saved when the server kept the edited project published — a trusted edit', async () => {
    // A trusted owner's edit stays published (the server's exception); a save
    // line claiming a return to review would lie about it.
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async () =>
      serverProject(),
    );
    const autosave = createAutosave(serverProject(), { save });

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(autosave.status()).toBe('saved');
  });

  it('does not claim a return to review for a project that was already pending', async () => {
    // A pending project stays pending on edit — nothing was "returned".
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async () =>
      serverProject({ publicationStatus: 'pending' }),
    );
    const autosave = createAutosave(serverProject({ publicationStatus: 'pending' }), { save });

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(autosave.status()).toBe('saved');
  });

  it('stays idle on a mutation the server cannot persist — no Saving flash for the in-memory stamp', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async (record) => record);
    const autosave = createAutosave(serverProject(), { save });
    const seen: SaveStatus[] = [];
    autosave.subscribe((status) => seen.push(status));

    // The player stamps the embed-reported duration; nothing persistable
    // changed, so the controller must not claim a save is happening.
    autosave.mutate((c) => ({ ...c, duration: 456.789 }));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(seen).toEqual([]);
    expect(autosave.status()).toBe('idle');
    expect(save).not.toHaveBeenCalled();
  });

  it('reconciles a revert that lands while a save is in flight', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async (record) => record);
    let releaseFirstSave: () => void = () => undefined;
    save.mockImplementationOnce(
      () =>
        new Promise<ServerProject>((resolve) => {
          releaseFirstSave = () => resolve(serverProject());
        }),
    );
    const autosave = createAutosave(serverProject(), { save });

    autosave.mutate((c) => ({ ...c, name: 'Interim' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);

    // The user reverts the rename while the first write is in flight: the
    // record returns to its loaded projection, but the in-flight save wrote
    // the interim name — the version bookkeeping must stay ahead so the
    // pending save's continuation re-runs and persists the revert.
    autosave.mutate((c) => ({ ...c, name: 'Brahms Op. 118 No. 2' }));
    releaseFirstSave();
    await vi.advanceTimersByTimeAsync(500);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].name).toBe('Brahms Op. 118 No. 2');
    expect(autosave.status()).toBe('saved');
  });

  it('flush saves immediately and cancels the pending debounce', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async (record) => record);
    const autosave = createAutosave(serverProject(), { save });

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await autosave.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.status()).toBe('saved');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('re-saves when a mutation lands while a save is in flight', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async (record) => record);
    let releaseFirstSave: () => void = () => undefined;
    save.mockImplementationOnce(
      () =>
        new Promise<ServerProject>((resolve) => {
          releaseFirstSave = () => resolve(serverProject());
        }),
    );
    const autosave = createAutosave(serverProject(), { save });

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

  it('surfaces a write failure as error, then recovers on the next save', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async () => {
      throw new Error('the server said no');
    });
    const autosave = createAutosave(serverProject(), { save });
    const seen: SaveStatus[] = [];
    autosave.subscribe((status) => seen.push(status));

    autosave.mutate((c) => ({ ...c, name: 'Too big' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(seen).toEqual(['dirty', 'saving', 'error']);
    expect(autosave.status()).toBe('error');
    expect(autosave.error()).toBeInstanceOf(Error);

    // The next mutation must retry and succeed.
    save.mockImplementation(async (record) => record);
    autosave.mutate((c) => ({ ...c, name: 'Fits now' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(autosave.status()).toBe('saved');
    expect(seen.at(-1)).toBe('saved');
  });

  it('reports a non-transportable write failure as error', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async () => {
      throw 'bare string';
    });
    const autosave = createAutosave(serverProject(), { save });

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(autosave.status()).toBe('error');
    expect(autosave.error()).toBeInstanceOf(Error);
    expect(autosave.error()?.message).toContain('bare string');
  });

  it('dispose cancels a pending save and silences listeners', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async (record) => record);
    const autosave = createAutosave(serverProject(), { save });
    const seen: SaveStatus[] = [];
    const unsubscribe = autosave.subscribe((status) => seen.push(status));

    autosave.mutate((c) => ({ ...c, name: 'Renamed' }));
    unsubscribe();
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(save).not.toHaveBeenCalled();
    expect(seen).toEqual(['dirty']);
  });

  it('flush rejects with the write failure instead of hanging', async () => {
    const save = vi.fn<(record: ServerProject) => Promise<ServerProject>>(async () => {
      throw new Error('the server said no');
    });
    const autosave = createAutosave(serverProject(), { save });

    autosave.mutate((c) => ({ ...c, name: 'Too big' }));
    await expect(autosave.flush()).rejects.toBeInstanceOf(Error);
    expect(autosave.status()).toBe('error');
  });
});

describe('createProjectSave', () => {
  it('skips the PATCH when only the in-memory duration changes — a no-op must not demote a published project', async () => {
    const saveProject = vi.fn<(id: string, update: ProjectUpdate) => Promise<ServerProject>>(
      async () => initial,
    );
    const initial = serverProject({ publicationStatus: 'published' });
    const save = createProjectSave({ saveProject }, initial);

    // The player stamps the embed-reported duration; the server cannot persist
    // it, so nothing should reach the transport.
    await save({ ...initial, duration: 456.789 });

    expect(saveProject).not.toHaveBeenCalled();
  });

  it('writes a real edit, then skips subsequent duration-only stamps', async () => {
    const saveProject = vi.fn<(id: string, update: ProjectUpdate) => Promise<ServerProject>>(
      async () => initial,
    );
    const initial = serverProject();
    const save = createProjectSave({ saveProject }, initial);

    const renamed = { ...initial, name: 'Renamed' };
    await save(renamed);
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject.mock.calls[0]).toEqual([
      'project-1',
      { name: 'Renamed', markers: initial.markers, movements: initial.movements },
    ]);

    // The rename is on the server now; the player's duration stamp must not
    // PATCH again.
    await save({ ...renamed, duration: 456.789 });
    expect(saveProject).toHaveBeenCalledTimes(1);
  });

  it('only carries the client-writable update grant — never identity or review fields', async () => {
    const saveProject = vi.fn<(id: string, update: ProjectUpdate) => Promise<ServerProject>>(
      async () => initial,
    );
    const initial = serverProject();
    const save = createProjectSave({ saveProject }, initial);

    await save({ ...initial, visibility: 'private', publicationStatus: 'pending' });

    expect(saveProject).toHaveBeenCalledTimes(0);
  });

  it('keeps a failed write different from the current record so the next save retries', async () => {
    const saveProject = vi.fn<(id: string, update: ProjectUpdate) => Promise<ServerProject>>(
      async () => {
        throw new Error('the server said no');
      },
    );
    const initial = serverProject();
    const save = createProjectSave({ saveProject }, initial);

    const renamed = { ...initial, name: 'Renamed' };
    await expect(save(renamed)).rejects.toBeInstanceOf(Error);
    expect(saveProject).toHaveBeenCalledTimes(1);

    // The save never landed, so the current record still differs from the
    // server's known state — a retry must PATCH again, not skip.
    saveProject.mockImplementation(async () => initial);
    await save(renamed);
    expect(saveProject).toHaveBeenCalledTimes(2);
  });

  it('starts from the loaded record: an unchanged project never reaches the transport', async () => {
    const saveProject = vi.fn<(id: string, update: ProjectUpdate) => Promise<ServerProject>>(
      async () => initial,
    );
    const initial = serverProject();
    const save = createProjectSave({ saveProject }, initial);

    // Load with zero mutations (e.g. the page's initial autosave flush) is a
    // no-op at the transport, even though the autosave runs its save callback.
    await save(initial);

    expect(saveProject).not.toHaveBeenCalled();
  });

  it('returns the row the server holds after a real write — the demotion rides on it', async () => {
    // The returned row is the truth the save line reads: an edit that the
    // review trigger demoted comes back pending, not the client's guess.
    const saveProject = vi.fn<(id: string, update: ProjectUpdate) => Promise<ServerProject>>(
      async () => serverProject({ publicationStatus: 'pending' }),
    );
    const initial = serverProject();
    const save = createProjectSave({ saveProject }, initial);

    const saved = await save({ ...initial, name: 'Renamed' });

    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saved.publicationStatus).toBe('pending');
  });

  it('returns the server-confirmed row when the save is skipped — nothing was written', async () => {
    const saveProject = vi.fn<(id: string, update: ProjectUpdate) => Promise<ServerProject>>(
      async () => initial,
    );
    const initial = serverProject();
    const save = createProjectSave({ saveProject }, initial);

    // The player's in-memory duration stamp changes nothing the server can
    // persist, so no write happens and no review return can have happened; the
    // answer is the row the server last confirmed (the loaded one).
    const result = await save({ ...initial, duration: 456.789 });

    expect(saveProject).not.toHaveBeenCalled();
    expect(result.publicationStatus).toBe('published');
  });

  it('returns the demoted row on a skip after a demoting save — the review claim survives', async () => {
    // The duration-only re-save that lands after a demoting write must not
    // resurrect the loaded publication status: the skipped save answers with
    // the row the server last confirmed (pending), so the save line keeps its
    // "back to review" claim (T52).
    const saveProject = vi.fn<(id: string, update: ProjectUpdate) => Promise<ServerProject>>(
      async () => serverProject({ publicationStatus: 'pending' }),
    );
    const initial = serverProject();
    const save = createProjectSave({ saveProject }, initial);

    const demoted = await save({ ...initial, name: 'Renamed' });
    expect(demoted.publicationStatus).toBe('pending');

    const result = await save({ ...initial, name: 'Renamed', duration: 456.789 });

    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(result.publicationStatus).toBe('pending');
  });
});

// The Autosave type import keeps the module's public surface checked.
export type { Autosave };
