import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockController } from '../test/controller-fixture';
import { mockController } from '../test/controller-fixture';
import { projectRecord } from '../test/project-fixture';
import { closeTestStorages, testStorage } from '../test/storage-fixture';
import { Player } from './Player';

afterEach(closeTestStorages);

/** Renders a loaded player whose load result matches the record's duration. */
async function renderLoadedPlayer(controller: MockController = mockController()) {
  const storage = await testStorage();
  // Match the record's own duration so the load triggers no autosave write.
  controller.load = vi.fn(async () => ({ mode: 'waveform' as const, duration: 123.456 }));
  const view = render(
    <Player
      record={projectRecord()}
      peaks={{ peaks: [[0, 1]], duration: 123.456 }}
      controller={controller}
      storage={storage}
    />,
  );
  await screen.findByRole('button', { name: 'Play' });
  return { ...view, controller, storage };
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
    // one toggle; the window handler must not double it.
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
    expect(playhead.style.left).toBe('0%');

    act(() => controller.emitPlayback({ currentTime: 5, duration: 10 }));
    expect(playhead.style.left).toBe('50%');

    // A playhead past the end (seeks are clamped by the controller, but the
    // view still guards) pins to the right edge instead of overflowing.
    act(() => controller.emitPlayback({ currentTime: 15 }));
    expect(playhead.style.left).toBe('100%');
  });
});

/* T06 marking. The fixture record carries markers at 10s (m1) and 20s (m2). */

/** The recording's duration — flags and x→time math divide by it. */
const RECORD_SECONDS = 123.456;

/** Renders a player whose playback duration matches the record. */
async function renderMarkingPlayer() {
  const controller = mockController();
  const storage = await testStorage();
  controller.load = vi.fn(async () => ({ mode: 'waveform' as const, duration: RECORD_SECONDS }));
  const record = projectRecord();
  const view = render(
    <Player
      record={record}
      peaks={{ peaks: [[0, 1]], duration: RECORD_SECONDS }}
      controller={controller}
      storage={storage}
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

/** Gives the waveform surface a predictable geometry for x→time mapping. */
function mockWaveformRect(container: HTMLElement, width: number): void {
  const waveform = container.querySelector('.player-waveform') as HTMLElement;
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
  vi.spyOn(waveform, 'getBoundingClientRect').mockReturnValue(bounds as DOMRect);
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
    mockWaveformRect(container, 100);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;

    fireEvent.doubleClick(shell, { clientX: 25 });

    const markerFlags = flags(container);
    // 25% of the recording (30.864s) lands after both existing markers.
    expect(markerFlags.map((flag) => flag.textContent)).toEqual(['A', 'B', 'C']);
    expect(markerFlags[2].style.left).toBe('25%');
  });

  it('does not add a marker when double-clicking a flag', async () => {
    const { container } = await renderMarkingPlayer();

    fireEvent.doubleClick(flags(container)[0]);

    expect(flags(container)).toHaveLength(2);
  });

  it('adds a marker on long-press; a tap or a drag adds nothing', async () => {
    const { container, controller } = await renderMarkingPlayer();
    mockWaveformRect(container, 100);
    const shell = container.querySelector('.player-waveform-shell') as HTMLElement;
    const waveform = container.querySelector('.player-waveform') as HTMLElement;
    // The seek surface the trailing click must never reach (wavesurfer or the
    // ruler listens just like this).
    const surfaceClick = vi.fn();
    waveform.addEventListener('click', surfaceClick);

    vi.useFakeTimers();
    try {
      fireEvent.touchStart(shell, { touches: [{ clientX: 50, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      const markerFlags = flags(container);
      expect(markerFlags).toHaveLength(3);
      expect(markerFlags[2].style.left).toBe('50%');

      // The long-press's trailing click is consumed in the capture phase
      // before it reaches the seek surface below.
      fireEvent.touchEnd(shell);
      fireEvent.click(waveform);
      expect(surfaceClick).not.toHaveBeenCalled();
      expect(controller.seek).not.toHaveBeenCalled();

      // A tap (start → end, no hold) adds nothing, and its click seeks.
      fireEvent.touchStart(shell, { touches: [{ clientX: 40, clientY: 10 }] });
      fireEvent.touchEnd(shell);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(flags(container)).toHaveLength(3);
      fireEvent.click(waveform);
      expect(surfaceClick).toHaveBeenCalledTimes(1);

      // A drag (movement beyond the slop) is not a long-press.
      fireEvent.touchStart(shell, { touches: [{ clientX: 60, clientY: 10 }] });
      fireEvent.touchMove(shell, { touches: [{ clientX: 90, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(flags(container)).toHaveLength(3);

      // A long-press whose trailing click never arrives (the touch ends off
      // the surface) must not swallow a later genuine click: the suppression
      // expires on its own.
      fireEvent.touchStart(shell, { touches: [{ clientX: 70, clientY: 10 }] });
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

    fireEvent.click(flags(container)[1]); // B at 20s

    expect(controller.seek).toHaveBeenCalledWith(20);
    expect(screen.getByRole('region', { name: 'Marker B' })).toBeInTheDocument();
    expect(flags(container)[1]).toHaveAttribute('aria-pressed', 'true');
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
