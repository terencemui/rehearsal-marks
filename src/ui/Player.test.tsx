import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadResult } from '../audio';
import { createAutosave } from '../storage';
import type { MockController } from '../test/controller-fixture';
import { mockController } from '../test/controller-fixture';
import { uploadLoad } from '../test/load-fixture';
import { marker } from '../test/marker-fixture';
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
    const options = uploadLoad(vi.mocked(controller.load).mock.calls[0][0]);
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
    const options = uploadLoad(vi.mocked(controller.load).mock.calls[0][0]);
    expect(options.peaks).toBeNull();
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

    // Focus on another button: Space does nothing at all.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add marker' })).toHaveFocus();
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
    expect(playhead.style.left).toBe('0px');

    act(() => controller.emitPlayback({ currentTime: 5, duration: 10 }));
    // 5 s at the default 8 px/s floor.
    expect(playhead.style.left).toBe('40px');

    // A playhead past the end (seeks are clamped by the controller, but the
    // view still guards) pins to the recording's end instead of overflowing.
    act(() => controller.emitPlayback({ currentTime: 15 }));
    expect(playhead.style.left).toBe('80px');
  });
});

/* T06 marking. The fixture record carries markers at 10s (m1) and 20s (m2). */

/** The recording's duration — flags and x→time math divide by it. */
const RECORD_SECONDS = 123.456;

/** Renders a player whose playback duration matches the record. */
async function renderMarkingPlayer(record = projectRecord()) {
  const controller = mockController();
  const storage = await testStorage();
  controller.load = vi.fn(async () => ({ mode: 'waveform' as const, duration: RECORD_SECONDS }));
  const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
  const view = render(
    <Player
      autosave={autosave}
      peaks={{ peaks: [[0, 1]], duration: RECORD_SECONDS }}
      controller={controller}
      onExit={vi.fn()}
    />,
  );
  await screen.findByRole('button', { name: 'Play' });
  act(() => controller.emitPlayback({ duration: RECORD_SECONDS }));
  return { ...view, controller, storage, record };
}

/** The marker flag buttons, in DOM order (which is time order). */
function flags(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.player-flag'));
}

/** Gives the shell (the scrollable viewport) a predictable geometry. */
function mockShellRect(container: HTMLElement, width: number): void {
  const shell = container.querySelector('.player-waveform-shell') as HTMLElement;
  const bounds = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 96,
    width,
    height: 96,
    toJSON: () => ({}),
  };
  vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(bounds as DOMRect);
}

describe('Player marking — adding', () => {
  it('drops a marker at the playhead with M, mid-playback, without pausing', async () => {
    const user = userEvent.setup();
    const { container, controller, storage, record, unmount } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 7.5, playing: true }));

    await user.keyboard('m');

    const markerFlags = flags(container);
    // 7.5s < 10s, so the new marker takes A and the others shift up.
    expect(markerFlags.map((flag) => flag.textContent)).toEqual(['A', 'B', 'C']);
    expect(markerFlags[0].style.left).toBe(`${(7.5 / RECORD_SECONDS) * 100}%`);
    // Marking never touches playback.
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.getPlaybackState().playing).toBe(true);

    // The mutation persists with every other one.
    unmount();
    await waitFor(async () => {
      const stored = await storage.projects.get(record.id);
      expect(stored!.markers).toHaveLength(3);
      expect(stored!.markers.some((marker) => marker.time === 7.5)).toBe(true);
    });
  });

  it('adds at the playhead from the visible Add marker button', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 7.5 }));

    await user.click(screen.getByRole('button', { name: 'Add marker' }));

    const markerFlags = flags(container);
    expect(markerFlags.map((flag) => flag.textContent)).toEqual(['A', 'B', 'C']);
    expect(markerFlags[0].style.left).toBe(`${(7.5 / RECORD_SECONDS) * 100}%`);
    expect(controller.togglePlay).not.toHaveBeenCalled();
  });

  it('suppresses marking shortcuts while a text field has focus', async () => {
    const user = userEvent.setup();
    const { container } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // select A, open the inspector

    await user.click(screen.getByLabelText('Time'));
    await user.keyboard('m{Delete}');

    expect(flags(container)).toHaveLength(2);
    expect(screen.queryByText(/deleted/)).not.toBeInTheDocument();
  });

  it('adds a marker at the double-clicked position', async () => {
    const { container } = await renderMarkingPlayer();
    mockShellRect(container, 800);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;

    fireEvent.doubleClick(shell, { clientX: 200 });

    const markerFlags = flags(container);
    // 200 px at the default 8 px/s floor is exactly 25 s — after both
    // existing markers, so the new one takes C.
    expect(markerFlags.map((flag) => flag.textContent)).toEqual(['A', 'B', 'C']);
    expect(markerFlags[2].style.left).toBe(`${(25 / RECORD_SECONDS) * 100}%`);
  });

  it('does not add a marker when double-clicking a flag', async () => {
    const { container } = await renderMarkingPlayer();

    fireEvent.doubleClick(flags(container)[0]);

    expect(flags(container)).toHaveLength(2);
  });

  it('adds a marker on long-press; a tap or a drag adds nothing', async () => {
    const { container, controller } = await renderMarkingPlayer();
    mockShellRect(container, 800);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;
    const waveform = container.querySelector('.player-waveform') as HTMLElement;
    // The seek surface the trailing click must never reach (wavesurfer or the
    // ruler listens just like this).
    const surfaceClick = vi.fn();
    waveform.addEventListener('click', surfaceClick);

    vi.useFakeTimers();
    try {
      fireEvent.touchStart(shell, { touches: [{ clientX: 400, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      const markerFlags = flags(container);
      // 400 px at the 8 px/s floor is 50 s — after both existing markers.
      expect(markerFlags).toHaveLength(3);
      expect(markerFlags[2].style.left).toBe(`${(50 / RECORD_SECONDS) * 100}%`);

      // The long-press's trailing click is consumed in the capture phase
      // before it reaches the seek surface below.
      fireEvent.touchEnd(shell);
      fireEvent.click(waveform);
      expect(surfaceClick).not.toHaveBeenCalled();
      expect(controller.seek).not.toHaveBeenCalled();

      // A tap (start → end, no hold) adds nothing, and its click seeks.
      fireEvent.touchStart(shell, { touches: [{ clientX: 320, clientY: 10 }] });
      fireEvent.touchEnd(shell);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(flags(container)).toHaveLength(3);
      fireEvent.click(waveform);
      expect(surfaceClick).toHaveBeenCalledTimes(1);

      // A drag (movement beyond the slop) is not a long-press.
      fireEvent.touchStart(shell, { touches: [{ clientX: 480, clientY: 10 }] });
      fireEvent.touchMove(shell, { touches: [{ clientX: 720, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(flags(container)).toHaveLength(3);

      // A long-press whose trailing click never arrives (the touch ends off
      // the surface) must not swallow a later genuine click: the suppression
      // expires on its own.
      fireEvent.touchStart(shell, { touches: [{ clientX: 560, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.touchEnd(shell); // no click follows
      expect(flags(container)).toHaveLength(4);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      fireEvent.click(waveform);
      expect(surfaceClick).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Player marking — flags and selection', () => {
  it('renders derived labels at their time positions', async () => {
    const { container } = await renderMarkingPlayer();

    const markerFlags = flags(container);
    expect(markerFlags.map((flag) => flag.textContent)).toEqual(['A', 'B']);
    expect(markerFlags[0].style.left).toBe(`${(10 / RECORD_SECONDS) * 100}%`);
    expect(markerFlags[1].style.left).toBe(`${(20 / RECORD_SECONDS) * 100}%`);
  });

  it('selects a marker and jumps to it when its flag is clicked', async () => {
    const { container, controller } = await renderMarkingPlayer();
    mockShellRect(container, 200);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;

    fireEvent.click(flags(container)[1]); // B at 20s

    expect(controller.seek).toHaveBeenCalledWith(20);
    expect(screen.getByRole('region', { name: 'Marker B' })).toBeInTheDocument();
    expect(flags(container)[1]).toHaveAttribute('aria-pressed', 'true');
    // The jump scrolls the marker into view, centered in the 200 px
    // viewport: 20 s × 8 px/s = 160 px of content, centered → 60.
    expect(shell.scrollLeft).toBe(60);

    // Jumping to a marker before the scroll (A at 10 s wants 80 − 100 = −20)
    // pins to the content start instead of scrolling past it.
    fireEvent.click(flags(container)[0]);
    expect(shell.scrollLeft).toBe(0);
  });

  it('deselects with Escape', async () => {
    const user = userEvent.setup();
    const { container } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Marker A' })).not.toBeInTheDocument();
  });
});

describe('Player marking — delete and undo', () => {
  // These three tests use fake timers (the five-second window). Interactions
  // go through synchronous fireEvent on purpose: userEvent's async wrapper
  // polls with real timers and deadlocks under vitest fake timers.
  it('deletes the selected marker with Delete and offers a 5-second undo', async () => {
    const { container } = await renderMarkingPlayer();
    vi.useFakeTimers();
    try {
      fireEvent.click(flags(container)[1]); // B
      fireEvent.keyDown(document.body, { key: 'Delete' });

      expect(flags(container).map((flag) => flag.textContent)).toEqual(['A']);
      expect(screen.getByText('Marker B deleted.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
      // No confirmation dialog — the toast is the entire safety net.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByText('Marker B deleted.')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes with Backspace too', async () => {
    const { container } = await renderMarkingPlayer();
    vi.useFakeTimers();
    try {
      fireEvent.click(flags(container)[0]); // A
      fireEvent.keyDown(document.body, { key: 'Backspace' });

      // The surviving marker re-derives its label — dense, no holes.
      expect(flags(container).map((flag) => flag.textContent)).toEqual(['A']);
      expect(screen.getByText('Marker A deleted.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the deleted marker with Undo', async () => {
    const { container } = await renderMarkingPlayer();
    vi.useFakeTimers();
    try {
      fireEvent.click(flags(container)[1]); // B at 20s
      fireEvent.keyDown(document.body, { key: 'Delete' });
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      const markerFlags = flags(container);
      expect(markerFlags.map((flag) => flag.textContent)).toEqual(['A', 'B']);
      expect(markerFlags[1].style.left).toBe(`${(20 / RECORD_SECONDS) * 100}%`);
      expect(screen.queryByText(/deleted/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes from the inspector button and re-derives labels densely', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();

    act(() => controller.emitPlayback({ currentTime: 15 }));
    await user.keyboard('m'); // A@10s, B@15s, C@20s
    expect(flags(container).map((flag) => flag.textContent)).toEqual(['A', 'B', 'C']);

    fireEvent.click(flags(container)[2]); // C
    await user.click(screen.getByRole('button', { name: 'Delete marker' }));

    expect(flags(container).map((flag) => flag.textContent)).toEqual(['A', 'B']);
    // The toast names the deleted marker by its then-current label.
    expect(screen.getByText('Marker C deleted.')).toBeInTheDocument();
  });
});

describe('Player marking — adjusting', () => {
  it('nudges the selected marker with the ±0.1s and ±1s buttons', async () => {
    const user = userEvent.setup();
    const { container } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // A at 10s

    await user.click(screen.getByRole('button', { name: '+0.1s' }));
    expect(screen.getByDisplayValue('00:10.100')).toBeInTheDocument();
    expect(flags(container)[0].style.left).toBe(`${(10.1 / RECORD_SECONDS) * 100}%`);

    await user.click(screen.getByRole('button', { name: '-1s' }));
    expect(screen.getByDisplayValue('00:09.100')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+1s' }));
    expect(screen.getByDisplayValue('00:10.100')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '-0.1s' }));
    expect(screen.getByDisplayValue('00:10.000')).toBeInTheDocument();
  });

  it('clamps nudges at the start of the recording', async () => {
    const user = userEvent.setup();
    const { container } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // A at 10s

    for (let i = 0; i < 11; i++) {
      await user.click(screen.getByRole('button', { name: '-1s' }));
    }

    expect(screen.getByDisplayValue('00:00.000')).toBeInTheDocument();
    expect(flags(container)[0].style.left).toBe('0%');
  });

  it('nudges the selected marker ±0.1s with Alt+arrows', async () => {
    const user = userEvent.setup();
    const { container } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // A at 10s

    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(screen.getByDisplayValue('00:10.100')).toBeInTheDocument();

    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}{Alt>}{ArrowLeft}{/Alt}');
    expect(screen.getByDisplayValue('00:09.900')).toBeInTheDocument();
  });

  it('blocks the browser Back on Alt+arrows even without a selection', async () => {
    const { container } = await renderMarkingPlayer();

    // dispatchEvent returns false when the handler called preventDefault —
    // Alt+← must never navigate the app away, selection or not.
    expect(fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true })).toBe(false);
    expect(flags(container)).toHaveLength(2);
  });

  it('commits lenient time input and displays mm:ss.mmm / h:mm:ss.mmm', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // A

    // A sub-hour recording displays mm:ss.mmm.
    act(() => controller.emitPlayback({ duration: 400 }));
    const timeInput = screen.getByLabelText('Time');
    await user.clear(timeInput);
    await user.type(timeInput, '5 10{Enter}');
    expect(screen.getByDisplayValue('05:10.000')).toBeInTheDocument();
    // The moved marker now ranks second — past its neighbor at 20s.
    expect(flags(container)[1].style.left).toBe(`${(310 / 400) * 100}%`);

    // An hour-plus recording displays h:mm:ss.mmm.
    act(() => controller.emitPlayback({ duration: 4000 }));
    await user.clear(timeInput);
    await user.type(timeInput, '1:05:10.5{Enter}');
    expect(screen.getByDisplayValue('1:05:10.500')).toBeInTheDocument();
  });

  it('rejects an invalid time and leaves the marker alone', async () => {
    const user = userEvent.setup();
    const { container } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // A at 10s

    const timeInput = screen.getByLabelText('Time');
    await user.clear(timeInput);
    await user.type(timeInput, 'abc{Enter}');

    expect(screen.getByText(/Invalid time/)).toBeInTheDocument();
    expect(timeInput).toHaveValue('abc');
    expect(flags(container)[0].style.left).toBe(`${(10 / RECORD_SECONDS) * 100}%`);

    // Fixing the entry clears the error.
    await user.clear(timeInput);
    await user.type(timeInput, '5{Enter}');
    expect(screen.getByDisplayValue('00:05.000')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid time/)).not.toBeInTheDocument();
  });

  it('attaches an alias that follows its marker through re-time and re-label', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // A at 10s

    const aliasInput = screen.getByLabelText('Aliases');
    await user.click(aliasInput);
    await user.type(aliasInput, 'Recap{Enter}');
    expect(screen.getByDisplayValue('Recap')).toBeInTheDocument();
    expect(flags(container)[0]).toHaveAttribute('title', 'A — Recap');

    // Re-time: the alias stays on its marker.
    await user.click(screen.getByRole('button', { name: '+0.1s' }));
    expect(screen.getByDisplayValue('Recap')).toBeInTheDocument();

    // Re-label: an earlier marker takes A; the aliased marker becomes B and
    // keeps the alias.
    fireEvent.blur(aliasInput);
    act(() => controller.emitPlayback({ currentTime: 5 }));
    await user.keyboard('m');

    const markerFlags = flags(container);
    expect(markerFlags.map((flag) => flag.textContent)).toEqual(['A', 'B', 'C']);
    expect(markerFlags[1]).toHaveAttribute('title', 'B — Recap');
  });

  it('enforces alias uniqueness and length in the inspector', async () => {
    const user = userEvent.setup();
    const { container } = await renderMarkingPlayer();

    // A gets the alias "Recap" first.
    fireEvent.click(flags(container)[0]);
    const aliasInput = screen.getByLabelText('Aliases');
    await user.click(aliasInput);
    await user.type(aliasInput, 'Recap{Enter}');
    fireEvent.blur(aliasInput);

    // B tries the same name (case-insensitive): rejected with the domain's
    // message, and the marker keeps no alias.
    fireEvent.click(flags(container)[1]);
    const aliasB = screen.getByLabelText('Aliases');
    await user.click(aliasB);
    await user.type(aliasB, 'recap{Enter}');
    expect(screen.getByText(/already used/)).toBeInTheDocument();
    expect(flags(container)[1]).toHaveAttribute('title', 'B');

    // A 17-character alias is rejected for length.
    await user.clear(aliasB);
    await user.type(aliasB, `${'x'.repeat(17)}{Enter}`);
    expect(screen.getByText(/at most 16/)).toBeInTheDocument();
  });

  it('re-labels when a marker moves past its neighbor', async () => {
    const user = userEvent.setup();
    const { container } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // A at 10s

    for (let i = 0; i < 11; i++) {
      await user.click(screen.getByRole('button', { name: '+1s' }));
    }

    // The marker now sits at 21s — past its neighbor — and selection follows
    // it through the re-label.
    const markerFlags = flags(container);
    expect(markerFlags.map((flag) => flag.textContent)).toEqual(['A', 'B']);
    expect(markerFlags[1]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Marker B' })).toBeInTheDocument();
  });
});

/* T07 navigation. The fixture record's markers sit at 10s (A) and 20s (B). */

/** The flags with aria-pressed — selection must never follow a jump. */
function selectedFlags(container: HTMLElement): HTMLElement[] {
  return flags(container).filter((flag) => flag.getAttribute('aria-pressed') === 'true');
}

describe('Player navigation — arrow jumps', () => {
  it('jumps ↓ to the next marker, ↑ back, wrapping at both ends', async () => {
    const user = userEvent.setup();
    const { controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    // The mock publishes each seek's landing like the real controller, so
    // the next keypress anchors where the playhead actually is.
    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    // From B the next marker is A again — the wrap.
    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenLastCalledWith(10);

    await user.keyboard('{ArrowUp}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);
  });

  it('wraps up from before the first marker to the last', async () => {
    const user = userEvent.setup();
    const { controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 0 }));

    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenLastCalledWith(10);

    await user.keyboard('{ArrowUp}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);
  });

  it('walks past a marker the seek landed a frame short of', async () => {
    const user = userEvent.setup();
    const { controller } = await renderMarkingPlayer();
    // A frame-snapped landing: ↓ sought 20, the media settled at 19.977.
    act(() => controller.emitPlayback({ currentTime: 19.977 }));

    await user.keyboard('{ArrowDown}');

    // The walk continues instead of re-jumping to the marker just left.
    expect(controller.seek).toHaveBeenLastCalledWith(10); // wrap, only B exists
  });

  it('keeps playing across a jump and never selects', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 15, playing: true }));

    await user.keyboard('{ArrowDown}');

    // The jump seeks only; the mock's seek would have published a pause.
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.getPlaybackState().playing).toBe(true);
    // Jumping never selects: no inspector, no pressed flag.
    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(selectedFlags(container)).toHaveLength(0);
  });

  it('anchors the jump at the live playhead, not the trailing store value', async () => {
    const user = userEvent.setup();
    const { controller } = await renderMarkingPlayer(
      projectRecord({ markers: [marker('m1', 10), marker('m2', 20), marker('m3', 30)] }),
    );
    // The store last published 19.9; the media element is actually at 20.15.
    act(() => controller.emitPlayback({ currentTime: 19.9 }));
    controller.getCurrentTime = () => 20.15;

    await user.keyboard('{ArrowDown}');

    // Anchored on the live 20.15, the next marker is C@30 — a store-anchored
    // jump would backtrack onto B@20, which the user already passed.
    expect(controller.seek).toHaveBeenLastCalledWith(30);
  });

  it('does nothing when there are no markers, leaving the keys to the browser', async () => {
    const { controller } = await renderMarkingPlayer(projectRecord({ markers: [] }));
    act(() => controller.emitPlayback({ currentTime: 5 }));

    // Not prevented — with nothing to jump to, arrow scrolling must survive.
    expect(fireEvent.keyDown(document.body, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'ArrowUp' })).toBe(true);
    expect(controller.seek).not.toHaveBeenCalled();
  });
});

describe('Player navigation — letter jumps', () => {
  it('jumps straight to a marker by its letter, case-insensitively, without selecting', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();

    await user.keyboard('b');
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    await user.keyboard('{Shift>}b{/Shift}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(selectedFlags(container)).toHaveLength(0);
  });

  it('blocks the default on a letter that has a marker and leaves the rest alone', async () => {
    const { controller } = await renderMarkingPlayer();

    // dispatchEvent returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(document.body, { key: 'a' })).toBe(false);
    expect(controller.seek).toHaveBeenLastCalledWith(10);

    // No marker D — untouched, so the browser default is allowed to run.
    expect(fireEvent.keyDown(document.body, { key: 'd' })).toBe(true);
    expect(controller.seek).toHaveBeenCalledTimes(1);
  });

  it('keeps M reserved for adding, not jumping', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    await user.keyboard('m');

    expect(flags(container).map((flag) => flag.textContent)).toEqual(['A', 'B', 'C']);
    expect(controller.seek).not.toHaveBeenCalled();
  });
});

describe('Player navigation — seeking', () => {
  it('seeks ∓5s with plain ←/→ and blocks the page scroll', async () => {
    const user = userEvent.setup();
    const { controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 17.5 }));

    await user.keyboard('{ArrowLeft}');
    expect(controller.seek).toHaveBeenLastCalledWith(12.5);

    await user.keyboard('{ArrowRight}');
    expect(controller.seek).toHaveBeenLastCalledWith(17.5);

    // dispatchEvent returns false when the handler called preventDefault —
    // the arrows must never scroll the page instead of seeking.
    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight' })).toBe(false);
  });

  it('seeks while playing without pausing', async () => {
    const user = userEvent.setup();
    const { controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 30, playing: true }));

    await user.keyboard('{ArrowLeft}');

    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.getPlaybackState().playing).toBe(true);
  });

  it('leaves Alt+arrows to the marker nudge, not the seek', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // select A at 10s
    act(() => controller.emitPlayback({ currentTime: 40 }));

    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    // The selected marker moved by 0.1s; the playhead did not seek ∓5s.
    expect(flags(container)[0].style.left).toBe(`${(9.9 / RECORD_SECONDS) * 100}%`);
    expect(controller.seek).toHaveBeenCalledTimes(1); // the flag click only
  });
});

describe('Player navigation — focus and gating', () => {
  it('acts once per press, ignoring the OS key-repeat', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenCalledTimes(1);

    // A held key repeats the event; repeats must not storm seeks or adds.
    fireEvent.keyDown(document.body, { key: 'ArrowDown', repeat: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true });
    fireEvent.keyDown(document.body, { key: 'm', repeat: true });
    expect(controller.seek).toHaveBeenCalledTimes(1);
    expect(flags(container)).toHaveLength(2);
  });

  it('leaves Shift+arrows to the browser', async () => {
    const { controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'ArrowDown', shiftKey: true })).toBe(true);
    expect(controller.seek).not.toHaveBeenCalled();
  });

  it('ignores shortcuts before the recording loads', async () => {
    const user = userEvent.setup();
    const controller = mockController();
    controller.load = vi.fn(() => new Promise<LoadResult>(() => {})); // never resolves
    const storage = await testStorage();
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    render(
      <Player
        autosave={autosave}
        peaks={{ peaks: [[0, 1]], duration: RECORD_SECONDS }}
        controller={controller}
        onExit={vi.fn()}
      />,
    );
    await screen.findByRole('button', { name: 'Play' });

    await user.keyboard('{ArrowRight}{ArrowDown}b');

    expect(controller.seek).not.toHaveBeenCalled();
  });

  it('keeps Space meaning play/pause after a flag click', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();

    fireEvent.click(flags(container)[1]); // jump to B, select it
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    await user.keyboard(' ');

    // Space toggles playback; it does not re-activate the focused flag.
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
    expect(controller.seek).toHaveBeenCalledTimes(1);
  });
});

describe('Player navigation — suppression in text inputs', () => {
  it('suppresses arrows and letters while the time field has focus', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // select A — one seek for the jump
    expect(controller.seek).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText('Time'));
    await user.keyboard('{ArrowLeft}{ArrowRight}{ArrowDown}{ArrowUp}ab');

    // No seeks, no marker from M-style letters — the input owns every key.
    expect(controller.seek).toHaveBeenCalledTimes(1);
    expect(flags(container)).toHaveLength(2);
  });
});

/* T08 zoom. jsdom has no layout, so the shell's rect is 0 and the view opens
at the 8 px/s floor; mockShellRect gives the viewport a real width. */

describe('Player zoom', () => {
  it('opens at the 8 px/s floor: waveform and flags span 8 px per second', async () => {
    const { container } = await renderMarkingPlayer();
    const waveform = container.querySelector('.player-waveform') as HTMLElement;
    const overlay = container.querySelector('.player-markers') as HTMLElement;

    // 123.456 s × 8 px/s.
    expect(waveform.style.width).toBe('987.648px');
    expect(overlay.style.width).toBe('987.648px');
    // Flags keep their duration-relative percentages; the overlay's width
    // puts them at time × 8 px.
    expect(flags(container)[1].style.left).toBe(`${(20 / RECORD_SECONDS) * 100}%`);
  });

  it('zooms in with ctrl+scroll around the cursor, keeping the time under it fixed', async () => {
    const { container } = await renderMarkingPlayer();
    mockShellRect(container, 500);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;
    const waveform = container.querySelector('.player-waveform') as HTMLElement;

    fireEvent.wheel(shell, { ctrlKey: true, deltaY: -100, clientX: 100 });

    // One mouse notch (−100 px) is two zoom steps: 8 → 12.5 px/s.
    expect(waveform.style.width).toBe('1543.2px');
    // The cursor sat over (0 + 100) / 8 = 12.5 s; after zooming it sits over
    // 12.5 × 12.5 − 100 = 56.25 px of scroll.
    expect(shell.scrollLeft).toBe(56.25);
  });

  it('zooms with cmd+scroll too, and leaves plain scroll alone', async () => {
    const { container } = await renderMarkingPlayer();
    mockShellRect(container, 500);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;
    const waveform = container.querySelector('.player-waveform') as HTMLElement;

    fireEvent.wheel(shell, { metaKey: true, deltaY: -100, clientX: 100 });
    expect(waveform.style.width).toBe('1543.2px');

    fireEvent.wheel(shell, { deltaY: -100, clientX: 100 });
    // Plain scroll belongs to the page — not to the zoom.
    expect(waveform.style.width).toBe('1543.2px');
    expect(shell.scrollLeft).toBe(56.25);
  });

  it('never zooms out below the floor', async () => {
    const { container } = await renderMarkingPlayer();
    mockShellRect(container, 500);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;
    const waveform = container.querySelector('.player-waveform') as HTMLElement;

    fireEvent.wheel(shell, { ctrlKey: true, deltaY: 100, clientX: 100 });

    expect(waveform.style.width).toBe('987.648px');
    expect(shell.scrollLeft).toBe(0);
  });

  it('keeps double-click → time mapping exact under zoom and scroll', async () => {
    const { container } = await renderMarkingPlayer();
    mockShellRect(container, 500);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;

    // Two notches in at x=100: 8 → 12.5 px/s, anchored so the cursor's time
    // (12.5 s) stays put → scroll 56.25.
    fireEvent.wheel(shell, { ctrlKey: true, deltaY: -50, clientX: 100 });
    fireEvent.wheel(shell, { ctrlKey: true, deltaY: -50, clientX: 100 });
    expect(shell.scrollLeft).toBe(56.25);

    fireEvent.doubleClick(shell, { clientX: 200 });

    const markerFlags = flags(container);
    // (200 + 56.25) / 12.5 = 20.5 s — after both existing markers.
    expect(markerFlags.map((flag) => flag.textContent)).toEqual(['A', 'B', 'C']);
    expect(markerFlags[2].style.left).toBe(`${(20.5 / RECORD_SECONDS) * 100}%`);
  });

  it('pinches to zoom, anchored at the gesture midpoint', async () => {
    const { container } = await renderMarkingPlayer();
    mockShellRect(container, 500);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;
    const waveform = container.querySelector('.player-waveform') as HTMLElement;

    // Fingers 200 px apart around the midpoint x=200, spreading to 500 px:
    // a 2.5× zoom.
    fireEvent.touchStart(shell, {
      touches: [
        { clientX: 100, clientY: 10 },
        { clientX: 300, clientY: 10 },
      ],
    });
    fireEvent.touchMove(shell, {
      touches: [
        { clientX: 0, clientY: 10 },
        { clientX: 500, clientY: 10 },
      ],
    });

    expect(waveform.style.width).toBe(`${RECORD_SECONDS * 20}px`);
    // The midpoint's time stays put: (0 + 200) / 8 = 25 s → 25 × 20 − 200.
    expect(shell.scrollLeft).toBe(300);
  });

  it('a second finger cancels the pending long-press — a pinch is not a press', async () => {
    const { container } = await renderMarkingPlayer();
    mockShellRect(container, 800);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;

    vi.useFakeTimers();
    try {
      fireEvent.touchStart(shell, { touches: [{ clientX: 400, clientY: 10 }] });
      fireEvent.touchStart(shell, {
        touches: [
          { clientX: 400, clientY: 10 },
          { clientX: 500, clientY: 10 },
        ],
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(flags(container)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pinch whose fingers start nearly together anchors once they spread', async () => {
    const { container } = await renderMarkingPlayer();
    mockShellRect(container, 500);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;
    const waveform = container.querySelector('.player-waveform') as HTMLElement;

    // Fingers land 10 px apart — below the 20 px minimum for a trustworthy
    // anchor — so this start records nothing.
    fireEvent.touchStart(shell, {
      touches: [
        { clientX: 195, clientY: 10 },
        { clientX: 205, clientY: 10 },
      ],
    });
    fireEvent.touchMove(shell, {
      touches: [
        { clientX: 100, clientY: 10 },
        { clientX: 300, clientY: 10 },
      ],
    });
    // The spread to 200 px re-anchors here: its first move is a 1× zoom.
    expect(waveform.style.width).toBe('987.648px');
    expect(shell.scrollLeft).toBe(0);

    fireEvent.touchMove(shell, {
      touches: [
        { clientX: 0, clientY: 10 },
        { clientX: 500, clientY: 10 },
      ],
    });
    // 500 / 200 = 2.5×, anchored at the re-anchor's midpoint (200): the
    // 25 s under it stays put → 25 × 20 − 200 = 300.
    expect(waveform.style.width).toBe(`${RECORD_SECONDS * 20}px`);
    expect(shell.scrollLeft).toBe(300);
  });

  it('keeps zooming when a third finger joins the pinch', async () => {
    const { container } = await renderMarkingPlayer();
    mockShellRect(container, 500);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;
    const waveform = container.querySelector('.player-waveform') as HTMLElement;

    fireEvent.touchStart(shell, {
      touches: [
        { clientX: 100, clientY: 10 },
        { clientX: 300, clientY: 10 },
      ],
    });
    // An extra touch lands and moves — the pinch is left untouched.
    fireEvent.touchStart(shell, {
      touches: [
        { clientX: 100, clientY: 10 },
        { clientX: 300, clientY: 10 },
        { clientX: 400, clientY: 10 },
      ],
    });
    fireEvent.touchMove(shell, {
      touches: [
        { clientX: 100, clientY: 10 },
        { clientX: 300, clientY: 10 },
        { clientX: 400, clientY: 10 },
      ],
    });
    // The gesture continues when the extra finger lifts.
    fireEvent.touchMove(shell, {
      touches: [
        { clientX: 0, clientY: 10 },
        { clientX: 500, clientY: 10 },
      ],
    });

    expect(waveform.style.width).toBe(`${RECORD_SECONDS * 20}px`);
    expect(shell.scrollLeft).toBe(300);
  });

  it('scrolling away and adding at the playhead while paused reveals the new flag', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    mockShellRect(container, 200);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;

    act(() => controller.emitPlayback({ currentTime: 40 }));
    await user.keyboard('m');

    // 40 s × 8 px/s = 320 px; centered in the 200 px viewport → 220.
    expect(shell.scrollLeft).toBe(220);
    expect(flags(container)).toHaveLength(3);
  });

  it('opens fit-to-view when the recording fits above the floor', async () => {
    // A shell 1200 px wide holds the 30 s recording at 40 px/s — above the
    // 8 px/s floor — so the view opens fitted, not at the floor.
    const rect = {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 96,
      width: 1200,
      height: 96,
      toJSON: () => ({}),
    };
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect as DOMRect);
    const storage = await testStorage();
    // The store contract needs a stable snapshot — a fresh object per call
    // would make useSyncExternalStore re-render forever.
    const snapshot = { playing: false, currentTime: 0, duration: 30, volume: 1 };
    const controller = mockController({
      getPlaybackState: () => snapshot,
      load: vi.fn(async () => ({ mode: 'waveform' as const, duration: 30 })),
    });
    const record = projectRecord({
      audioMeta: { ...projectRecord().audioMeta, duration: 30 },
    });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    const { container } = render(
      <Player
        autosave={autosave}
        peaks={{ peaks: [[0, 1]], duration: 30 }}
        controller={controller}
        onExit={vi.fn()}
      />,
    );
    await screen.findByRole('button', { name: 'Play' });

    const waveform = container.querySelector('.player-waveform') as HTMLElement;
    expect(waveform.style.width).toBe('1200px'); // fit — 40 px/s × 30 s

    rectSpy.mockRestore();
    storage.close();
  });

  it('applies the zoomed width in ruler-only mode too', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ mode: 'ruler' as const, duration: 50 })),
    });
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    const { container } = render(
      <Player autosave={autosave} peaks={null} controller={controller} onExit={vi.fn()} />,
    );
    await screen.findByText(/timeline still works/);
    act(() => controller.emitPlayback({ duration: 50 }));

    const waveform = container.querySelector('.player-waveform') as HTMLElement;
    expect(waveform.style.width).toBe('400px'); // 50 s × 8 px/s
    storage.close();
  });
});
