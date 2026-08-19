import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecodeError } from './audio';
import type { PeakData } from './audio';
import { exportProjectZip } from './portability';
import { createStorage, sha256, StorageError } from './storage';
import type { Storage } from './storage';
import { mockController } from './test/controller-fixture';
import { projectRecord } from './test/project-fixture';
import { closeTestStorages, testStorage } from './test/storage-fixture';
import App from './App';

/** Renders the app on a fresh fake-indexeddb database with a mocked seam. */
async function renderApp(
  controller = mockController(),
  storage?: Storage,
  download?: (blob: Blob, filename: string) => void,
) {
  const opened = storage ?? (await testStorage());
  const view = render(<App controllerFactory={() => controller} storage={opened} download={download} />);
  return { ...view, storage: opened, controller };
}

function mp3File(name = 'brahms-op118.mp3'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'audio/mpeg' });
}

afterEach(closeTestStorages);

describe('App upload flow', () => {
  it('drops the user straight into the player, named after the file and persisted', async () => {
    const user = userEvent.setup();
    const { container, storage, controller } = await renderApp();

    await user.upload(container.querySelector('input[type="file"]')!, mp3File());

    expect(await screen.findByRole('heading', { name: 'brahms-op118' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rehearsal Marks' })).not.toBeInTheDocument();

    const projects = await storage.projects.list();
    expect(projects.map((p) => p.name)).toEqual(['brahms-op118']);
    expect(projects[0].duration).toBe(10);
    const stored = await storage.projects.get(projects[0].id);
    expect(stored!.audioMeta.filename).toBe('brahms-op118.mp3');

    // The player rendered the waveform through the seam with the same blob.
    const loadOptions = vi.mocked(controller.load).mock.calls[0][0];
    expect(loadOptions.blob).toBeInstanceOf(Blob);
    expect(loadOptions.peaks).toEqual({ peaks: [[0, 1]], duration: 10 });
  });

  it('accepts an M4A the same way', async () => {
    const user = userEvent.setup();
    const { container, storage } = await renderApp();
    const m4a = new File([new Uint8Array([5, 6])], 'mozart-k265.m4a', { type: 'audio/mp4' });

    await user.upload(container.querySelector('input[type="file"]')!, m4a);

    expect(await screen.findByRole('heading', { name: 'mozart-k265' })).toBeInTheDocument();
    expect((await storage.projects.list()).map((p) => p.name)).toEqual(['mozart-k265']);
  });

  it('rejects WAV with conversion guidance and stores nothing', async () => {
    // `applyAccept: false` — the accept attribute is a hint only; real
    // browsers can't enforce it (drag-drop, mobile), so the app's own
    // validation is what must reject. This test exercises that guard.
    const user = userEvent.setup({ applyAccept: false });
    const { container, storage, controller } = await renderApp();
    const wav = new File([new Uint8Array([1, 2])], 'brahms.wav', { type: 'audio/wav' });

    await user.upload(container.querySelector('input[type="file"]')!, wav);

    expect(await screen.findByRole('alert')).toHaveTextContent(/WAV.*convert/i);
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(controller.extractPeaks).not.toHaveBeenCalled();
    expect(await storage.projects.list()).toEqual([]);
  });

  it('degrades to ruler-only mode when decoding fails, without losing the project', async () => {
    const user = userEvent.setup();
    const controller = mockController({
      extractPeaks: vi.fn(async () => {
        throw new DecodeError(new Error('not audio'));
      }),
      load: vi.fn(async () => ({ mode: 'ruler' as const, duration: 8 })),
    });
    const { container, storage } = await renderApp(controller);

    await user.upload(container.querySelector('input[type="file"]')!, mp3File());

    expect(await screen.findByRole('heading', { name: 'brahms-op118' })).toBeInTheDocument();
    expect(await screen.findByText(/timeline still works/)).toBeInTheDocument();
    expect(await storage.projects.list()).toHaveLength(1);
  });

  it('tells the user honestly when the first save runs out of storage', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    // The repository translates quota failures; simulate its translated error.
    const fullStorage: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async () => {
          throw new StorageError('Browser storage is full.', 'storage-full');
        },
      },
    };
    const { container } = await renderApp(mockController(), fullStorage);

    await user.upload(container.querySelector('input[type="file"]')!, mp3File());

    expect(await screen.findByRole('alert')).toHaveTextContent(/storage is full/i);
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(await storage.projects.list()).toEqual([]);
  });
});

describe('App Projects workspace', () => {
  it('lists stored projects with name, duration, marker count, and size on start', async () => {
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    await renderApp(mockController(), storage);

    expect(await screen.findByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
    // The stored-size estimate for the fixture: 4-byte audio + 296 serialized.
    expect(screen.getByText(/2:03\.456 · 2 markers · 300 B/)).toBeInTheDocument();
    expect(screen.getByText(/Total used: 300 B/)).toBeInTheDocument();
  });

  it('shows the empty state with both first-run paths', async () => {
    const user = userEvent.setup();
    const { storage } = await renderApp();

    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browse the library' }));
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByText(/later update/)).toBeInTheDocument();

    storage.close();
  });

  it('reopens a project with its audio and markers intact', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const record = projectRecord();
    await storage.projects.save(record);
    const controller = mockController({
      load: vi.fn(async () => ({ mode: 'waveform' as const, duration: 123.456 })),
    });
    await renderApp(controller, storage);

    await user.click(await screen.findByRole('button', { name: /Brahms/ }));

    // The player opened on the stored record: the same audio bytes re-decode
    // to peaks, and the stored markers come with the record.
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    const extractOptions = vi.mocked(controller.extractPeaks).mock.calls[0][0];
    expect(new Uint8Array(await extractOptions.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    const loadOptions = vi.mocked(controller.load).mock.calls[0][0];
    expect(new Uint8Array(await loadOptions.blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(await storage.projects.get(record.id)).toEqual(
      expect.objectContaining({ markers: record.markers }),
    );
  });

  it('returns to the workspace from the player and lists the new project', async () => {
    const user = userEvent.setup();
    const { container, storage } = await renderApp();

    await user.upload(container.querySelector('input[type="file"]')!, mp3File());
    await screen.findByRole('heading', { name: 'brahms-op118' });

    await user.click(screen.getByRole('button', { name: 'Projects' }));

    expect(await screen.findByText('brahms-op118')).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(await storage.projects.list()).toHaveLength(1);
  });

  it('renames inline, persists, and moves the renamed project to the top', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord({ id: 'older', name: 'Older', updatedAt: 1_000 }));
    await storage.projects.save(projectRecord({ id: 'newer', name: 'Newer', updatedAt: 2_000 }));
    await renderApp(mockController(), storage);
    await screen.findByText('Newer');

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Newer')).toBeInTheDocument();

    await user.click(within(rows[1]).getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'Brahms 2{enter}');

    await screen.findByText('Brahms 2');
    const stored = await storage.projects.get('older');
    expect(stored!.name).toBe('Brahms 2');
    expect(stored!.updatedAt).toBeGreaterThan(2_000);
    // The rename re-stamps updatedAt, so the renamed row is now newest.
    const reordered = screen.getAllByRole('listitem');
    expect(within(reordered[0]).getByText('Brahms 2')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('deletes after confirmation and empties the workspace', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    await renderApp(mockController(), storage);
    await screen.findByText('Brahms Op. 118 No. 2');

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(
      screen.getByText('Delete “Brahms Op. 118 No. 2”? This cannot be undone.'),
    ).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(await storage.projects.list()).toEqual([]);
  });

  it('shows the storage-full state when a rename hits a full store', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    const fullStorage: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async () => {
          throw new StorageError('Browser storage is full.', 'storage-full');
        },
      },
    };
    await renderApp(mockController(), fullStorage);
    await screen.findByText('Brahms Op. 118 No. 2');

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'New Name{enter}');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Storage full — free up space to keep saving.',
    );
  });

  it('persists projects across a page reload', async () => {
    const name = `reload-${crypto.randomUUID()}`;
    const first = await createStorage({ name });
    await first.projects.save(projectRecord());
    first.close();

    // A reload: a fresh App opens a fresh connection to the same database.
    const reopened = await createStorage({ name });
    await renderApp(mockController(), reopened);
    expect(await screen.findByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
    reopened.close();
  });

  it('switches between the workspace tabs', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('tab', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
  });

  it('drops an in-flight open when the user switches tabs, releasing the controller', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    let resolvePeaks!: (peaks: PeakData) => void;
    const controller = mockController({
      extractPeaks: vi.fn(
        () =>
          new Promise<PeakData>((resolve) => {
            resolvePeaks = resolve;
          }),
      ),
      load: vi.fn(async () => ({ mode: 'waveform' as const, duration: 123.456 })),
    });
    await renderApp(controller, storage);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.click(screen.getByRole('button', { name: /Brahms/ }));
    await user.click(screen.getByRole('tab', { name: 'Library' }));
    await act(async () => {
      resolvePeaks({ peaks: [[0, 1]], duration: 10 });
    });

    // The player must not yank the user off the tab they navigated to.
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Brahms Op. 118 No. 2' })).not.toBeInTheDocument();
    expect(controller.destroy).toHaveBeenCalled();
  });

  it('reuses decoded peaks when reopening the same project', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    const controller = mockController({
      load: vi.fn(async () => ({ mode: 'waveform' as const, duration: 123.456 })),
    });
    await renderApp(controller, storage);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.click(screen.getByRole('button', { name: /Brahms/ }));
    await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' });
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await screen.findByRole('tablist');
    await user.click(screen.getByRole('button', { name: /Brahms/ }));
    await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' });

    expect(controller.extractPeaks).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed final save on exit instead of claiming Saved', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    let saves = 0;
    // The upload's first save succeeds; every later save hits a full store.
    const flaky: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async (record) => {
          saves += 1;
          if (saves > 1) throw new StorageError('Browser storage is full.', 'storage-full');
          await storage.projects.save(record);
        },
      },
    };
    const controller = mockController({
      // A different duration guarantees the player schedules a write.
      load: vi.fn(async () => ({ mode: 'waveform' as const, duration: 42 })),
    });
    const { container } = await renderApp(controller, flaky);
    await user.upload(container.querySelector('input[type="file"]')!, mp3File());
    await screen.findByRole('heading', { name: 'brahms-op118' });
    // Wait for the debounced write to fail inside the player first.
    await screen.findByText('Storage full — free up space to keep saving.');

    await user.click(screen.getByRole('button', { name: 'Projects' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Storage full — free up space to keep saving.',
    );
  });

  it('reports a failed delete as its own notice, not as a save error', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    const broken: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        remove: async () => {
          throw new Error('IndexedDB unavailable');
        },
      },
    };
    await renderApp(mockController(), broken);
    await screen.findByText('Brahms Op. 118 No. 2');

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong deleting the project.',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(await storage.projects.list()).toHaveLength(1);
  });
});

describe('App export and import', () => {
  /** The app's three file inputs, in document order: upload, zip import, label import. */
  function fileInputs(container: HTMLElement): HTMLInputElement[] {
    return [...container.querySelectorAll('input[type="file"]')] as HTMLInputElement[];
  }

  /** Captures downloads instead of handing them to the browser. */
  function captureDownloads() {
    const downloads: Array<{ blob: Blob; filename: string }> = [];
    return {
      downloads,
      download: vi.fn((blob: Blob, filename: string) => downloads.push({ blob, filename })),
    };
  }

  it('round-trips a project end-to-end: export the zip, import it back as a new project', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    // The stored sha256 must be the audio's real hash for the import's
    // integrity check to pass — exactly what the upload path computes.
    const record = projectRecord();
    record.audioMeta.sha256 = await sha256(record.audio);
    await storage.projects.save(record);
    const { downloads, download } = captureDownloads();
    const { container } = await renderApp(mockController(), storage, download);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(downloads[0].filename).toBe('Brahms Op. 118 No. 2.zip');

    // Import the very zip that was just exported.
    const zip = new File(
      [await downloads[0].blob.arrayBuffer()],
      'Brahms Op. 118 No. 2.zip',
      { type: 'application/zip' },
    );
    await user.upload(fileInputs(container)[1], zip);

    // The workspace now holds both: the original and a fresh import with a
    // suffixed name — import created, it never overwrote.
    await screen.findByText('Brahms Op. 118 No. 2 (2)');
    const projects = await storage.projects.list();
    expect(projects).toHaveLength(2);
    const importedSummary = projects.find((p) => p.id !== record.id)!;
    expect(importedSummary.name).toBe('Brahms Op. 118 No. 2 (2)');
    const stored = await storage.projects.get(importedSummary.id);
    expect(stored!.audioMeta.sha256).toBe(record.audioMeta.sha256);
    expect(stored!.markers).toEqual(record.markers);
    expect(new Uint8Array(await stored!.audio.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('clears a stale failure line when a later zip import succeeds', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const record = projectRecord();
    record.audioMeta.sha256 = await sha256(record.audio);
    await storage.projects.save(record);
    let saves = 0;
    // The rename's save fails; the zip import's save (the next one) succeeds.
    const flaky: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async (next) => {
          saves += 1;
          if (saves === 1) throw new StorageError('Browser storage is full.', 'storage-full');
          await storage.projects.save(next);
        },
      },
    };
    const { container } = await renderApp(mockController(), flaky);
    await screen.findByText('Brahms Op. 118 No. 2');

    // A rename hits the full store and leaves the failure line up.
    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'New Name{enter}');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Storage full — free up space to keep saving.',
    );

    // A zip import then succeeds — the failure line must clear.
    const zip = await exportProjectZip(record);
    const file = new File([await zip.arrayBuffer()], 'brahms.zip', { type: 'application/zip' });
    await user.upload(fileInputs(container)[1], file);

    await screen.findByText('Brahms Op. 118 No. 2 (2)');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('exports a label set that applies to its own recording and is refused by another', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const brahms = projectRecord();
    brahms.audioMeta.sha256 = await sha256(brahms.audio);
    const mozart = projectRecord({
      id: 'mozart',
      name: 'Mozart K. 466',
      audio: new Blob([new Uint8Array([9, 9, 9])], { type: 'audio/mpeg' }),
    });
    mozart.audioMeta = { ...mozart.audioMeta, sha256: await sha256(mozart.audio) };
    await storage.projects.save(brahms);
    await storage.projects.save(mozart);
    const { downloads, download } = captureDownloads();
    const { container } = await renderApp(mockController(), storage, download);
    await screen.findByText('Brahms Op. 118 No. 2');

    const brahmsRow = screen.getByText('Brahms Op. 118 No. 2').closest('li')!;
    await user.click(within(brahmsRow).getByRole('button', { name: 'Export labels' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(downloads[0].filename).toBe('Brahms Op. 118 No. 2.labels.json');
    const labelsFile = new File(
      [await downloads[0].blob.arrayBuffer()],
      'labels.json',
      { type: 'application/json' },
    );

    // Applying it to a project on a different recording is refused, with the
    // explanation — and the project is left untouched.
    const mozartRow = screen.getByText('Mozart K. 466').closest('li')!;
    await user.click(within(mozartRow).getByRole('button', { name: 'Import labels' }));
    await user.click(within(mozartRow).getByRole('button', { name: 'Replace' }));
    await user.upload(fileInputs(container)[2], labelsFile);
    expect(await screen.findByRole('alert')).toHaveTextContent('made for a different recording');
    expect((await storage.projects.get('mozart'))!.markers).toEqual(mozart.markers);

    // On its own recording it applies: the alert clears and the markers land.
    await user.click(within(brahmsRow).getByRole('button', { name: 'Import labels' }));
    await user.click(within(brahmsRow).getByRole('button', { name: 'Replace' }));
    await user.upload(fileInputs(container)[2], labelsFile);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    expect((await storage.projects.get('project-1'))!.markers).toEqual(brahms.markers);
  });

  it('explains when the imported file is not a project zip at all', async () => {
    const user = userEvent.setup();
    const { container } = await renderApp();

    await user.upload(
      fileInputs(container)[1],
      new File(['not a zip'], 'fake.zip', { type: 'application/zip' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t a valid project zip');
  });
});
