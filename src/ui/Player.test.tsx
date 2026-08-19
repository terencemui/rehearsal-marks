import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../storage';
import type { MockController } from '../test/controller-fixture';
import { mockController } from '../test/controller-fixture';
import { projectRecord } from '../test/project-fixture';
import { closeTestStorages, testStorage } from '../test/storage-fixture';
import { Player } from './Player';

afterEach(closeTestStorages);

/** Renders a loaded player whose load result matches the record's duration. */
async function renderLoadedPlayer(controller: MockController = mockController()) {
  const storage = await testStorage();
  const record = projectRecord();
  // Match the record's own duration so the load triggers no autosave write.
  controller.load = vi.fn(async () => ({ mode: 'waveform' as const, duration: 123.456 }));
  const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
  const view = render(
    <Player
      autosave={autosave}
      peaks={{ peaks: [[0, 1]], duration: 123.456 }}
      controller={controller}
      onExit={vi.fn()}
    />,
  );
  await screen.findByRole('button', { name: 'Play' });
  return { ...view, controller, storage, autosave };
}

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
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(
      <Player autosave={autosave} peaks={peaks} controller={controller} onExit={vi.fn()} />,
    );

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
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} peaks={null} controller={controller} onExit={vi.fn()} />);

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
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    const { unmount } = render(
      <Player autosave={autosave} peaks={null} controller={controller} onExit={vi.fn()} />,
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
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} peaks={null} controller={controller} onExit={vi.fn()} />);

    expect(await screen.findByText(/timeline still works/)).toBeInTheDocument();
    storage.close();
  });

  it('returns to the Projects screen from the header button', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const storage = await testStorage();
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    render(<Player autosave={autosave} peaks={null} controller={mockController()} onExit={onExit} />);

    await user.click(await screen.findByRole('button', { name: 'Projects' }));

    expect(onExit).toHaveBeenCalledTimes(1);
    storage.close();
  });

  it('does not write the record over sub-millisecond duration noise', async () => {
    const storage = await testStorage();
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    // The media element reports the record's duration plus measurement noise:
    // past the debounce window, nothing may have been scheduled.
    const controller = mockController({
      load: vi.fn(async () => ({ mode: 'waveform' as const, duration: 123.4560004 })),
    });

    render(
      <Player
        autosave={autosave}
        peaks={{ peaks: [[0, 1]], duration: 123.456 }}
        controller={controller}
        onExit={vi.fn()}
      />,
    );
    await screen.findByRole('button', { name: 'Play' });
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(await storage.projects.get(record.id)).toBeUndefined();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    storage.close();
  });
});

describe('Player playback controls', () => {
  it('toggles playback from the visible control and reflects playing state', async () => {
    const user = userEvent.setup();
    const { controller } = await renderLoadedPlayer();

    const play = screen.getByRole('button', { name: 'Play' });
    expect(play).toHaveAttribute('aria-pressed', 'false');

    await user.click(play);
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);

    act(() => controller.emitPlayback({ playing: true }));
    const pause = screen.getByRole('button', { name: 'Pause' });
    expect(pause).toHaveAttribute('aria-pressed', 'true');

    await user.click(pause);
    expect(controller.togglePlay).toHaveBeenCalledTimes(2);
  });

  it('toggles with Space, except while a control has focus', async () => {
    const user = userEvent.setup();
    const { controller } = await renderLoadedPlayer();

    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);

    // The play button owns Space while focused — its native activation is the
    // one toggle; the window handler must not double it. (Two tabs: the
    // Projects button sits first in the header.)
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(2);

    // Focus in the volume slider: Space does nothing at all.
    await user.tab();
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveFocus();
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(2);
  });

  it('drives the controller volume and shows controller volume changes', async () => {
    const { controller } = await renderLoadedPlayer();
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toHaveValue('1');

    fireEvent.change(slider, { target: { value: '0.4' } });
    expect(controller.setVolume).toHaveBeenCalledWith(0.4);

    act(() => controller.emitPlayback({ volume: 0.6 }));
    expect(slider).toHaveValue('0.6');
  });

  it('moves the playhead indicator with playback time', async () => {
    const { controller, container } = await renderLoadedPlayer();
    const playhead = container.querySelector('.player-playhead') as HTMLElement;
    expect(playhead).not.toBeNull();
    expect(playhead.style.left).toBe('0%');

    act(() => controller.emitPlayback({ currentTime: 5, duration: 10 }));
    expect(playhead.style.left).toBe('50%');

    // A playhead past the end (seeks are clamped by the controller, but the
    // view still guards) pins to the right edge instead of overflowing.
    act(() => controller.emitPlayback({ currentTime: 15 }));
    expect(playhead.style.left).toBe('100%');
  });
});
