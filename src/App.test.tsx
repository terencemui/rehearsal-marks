import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecodeError } from './audio';
import { StorageError } from './storage';
import type { Storage } from './storage';
import { mockController } from './test/controller-fixture';
import { closeTestStorages, testStorage } from './test/storage-fixture';
import App from './App';

/** Renders the app on a fresh fake-indexeddb database with a mocked seam. */
async function renderApp(controller = mockController(), storage?: Storage) {
  const opened = storage ?? (await testStorage());
  const view = render(<App controllerFactory={() => controller} storage={opened} />);
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
