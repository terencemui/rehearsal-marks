import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockController } from '../test/controller-fixture';
import { projectRecord } from '../test/project-fixture';
import { closeTestStorages, testStorage } from '../test/storage-fixture';
import { Player } from './Player';

afterEach(closeTestStorages);

describe('Player', () => {
  it('loads the recording through the controller and shows the project name', async () => {
    const storage = await testStorage();
    // Load reports the record's own duration, so no autosave mutation is
    // triggered and the status line reads Saved.
    const controller = mockController({
      load: vi.fn(async () => ({ mode: 'waveform' as const, duration: 123.456 })),
    });
    const record = projectRecord();
    const peaks = { peaks: [[0, 1]], duration: 123.456 };

    render(<Player record={record} peaks={peaks} controller={controller} storage={storage} />);

    expect(screen.getByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');

    // The blob and the pre-decoded peaks go to the seam; the container the
    // controller renders into is the player's waveform element.
    expect(controller.load).toHaveBeenCalledTimes(1);
    const options = vi.mocked(controller.load).mock.calls[0][0];
    expect(options.blob).toBe(record.audio);
    expect(options.peaks).toBe(peaks);
    expect(options.container).toBeInstanceOf(HTMLDivElement);
    expect(document.body.contains(options.container)).toBe(true);

    // No degraded-view note in waveform mode.
    expect(screen.queryByText(/timeline still works/)).not.toBeInTheDocument();
    storage.close();
  });

  it('renders the ruler-only note when decoding failed', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ mode: 'ruler' as const, duration: 5 })),
    });

    render(<Player record={projectRecord()} peaks={null} controller={controller} storage={storage} />);

    expect(await screen.findByText(/timeline still works/)).toBeInTheDocument();
    expect(vi.mocked(controller.load).mock.calls[0][0].peaks).toBeNull();
    storage.close();
  });

  it('persists the media duration learned in ruler mode', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ mode: 'ruler' as const, duration: 42 })),
    });
    const record = projectRecord({ audioMeta: { ...projectRecord().audioMeta, duration: 0 } });

    const { unmount } = render(
      <Player record={record} peaks={null} controller={controller} storage={storage} />,
    );
    await screen.findByText(/timeline still works/);
    unmount();

    await waitFor(async () => {
      const stored = await storage.projects.get(record.id);
      expect(stored!.audioMeta.duration).toBe(42);
    });
    expect(controller.destroy).toHaveBeenCalled();
    storage.close();
  });

  it('degrades to the ruler note without crashing when loading rejects', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => {
        throw new Error('media element failed');
      }),
    });

    render(<Player record={projectRecord()} peaks={null} controller={controller} storage={storage} />);

    expect(await screen.findByText(/timeline still works/)).toBeInTheDocument();
    storage.close();
  });
});
