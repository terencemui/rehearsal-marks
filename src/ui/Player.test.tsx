import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadResult } from '../audio';
import { YouTubePlaybackError } from '../audio/errors';
import { canonicalYouTubeUrl } from '../domain';
import { createAutosave } from '../storage';
import type { PlayerMode } from '../storage';
import { mockController } from '../test/controller-fixture';
import { youtubeLoad } from '../test/load-fixture';
import { marker } from '../test/marker-fixture';
import { projectRecord } from '../test/project-fixture';
import { closeTestStorages, testStorage } from '../test/storage-fixture';
import { Player } from './Player';

afterEach(closeTestStorages);

/**
 * Renders a loaded player whose load result matches the record's duration —
 * the same render the marking tests use, surfaced with the autosave handle
 * for the transport tests that only need the controller and the view.
 */
async function renderLoadedPlayer() {
  const { autosave, ...rest } = await renderMarkingPlayer();
  return { ...rest, autosave };
}

describe('Player', () => {
  it('loads the canonical URL through the controller and shows the project name', async () => {
    const storage = await testStorage();
    // Load reports the record's own duration, so no autosave mutation is
    // triggered and the status line reads Saved.
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 123.456 })),
    });
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();

    // The canonical URL derived from the stored video ID is the whole input
    // to the seam; the container the controller renders into is the player's
    // ruler element.
    expect(controller.load).toHaveBeenCalledTimes(1);
    const options = youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]);
    expect(options.url).toBe(canonicalYouTubeUrl(record.videoId));
    expect(options.container).toBeInstanceOf(HTMLDivElement);
    expect(document.body.contains(options.container)).toBe(true);

    // The loaded player shows the YouTube precision note under the timeline.
    expect(await screen.findByText(/Playing from YouTube/)).toBeInTheDocument();
    storage.close();
  });

  it('frames the page: a nav bar with only Projects, and a title band above the split', async () => {
    const storage = await testStorage();
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    render(<Player autosave={autosave} controller={mockController()} onExit={vi.fn()} />);

    // The nav bar carries a single Projects control — no back arrow, no
    // title, no save status (T37).
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('button', { name: 'Projects' })).toBeInTheDocument();
    expect(within(nav).getAllByRole('button')).toHaveLength(1);
    expect(within(nav).queryByRole('heading')).not.toBeInTheDocument();
    expect(within(nav).queryByRole('status')).not.toBeInTheDocument();

    // The project name renders in its own band above the recording.
    expect(screen.getByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    storage.close();
  });

  it('renders the YouTube precision note once the load settles', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 5 })),
    });
    const record = projectRecord({ duration: 5 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);

    expect(await screen.findByText(/Playing from YouTube/)).toBeInTheDocument();
    storage.close();
  });

  it('persists the media duration learned from the load', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 42 })),
    });
    const record = projectRecord({ duration: 0 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    const { unmount } = render(
      <Player autosave={autosave} controller={controller} onExit={vi.fn()} />,
    );
    await screen.findByText(/Playing from YouTube/);
    unmount();

    await waitFor(async () => {
      const stored = await storage.projects.get(record.id);
      expect(stored!.duration).toBe(42);
    });
    expect(controller.destroy).toHaveBeenCalled();
    storage.close();
  });

  it('shows the failure card when loading rejects', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => {
        throw new Error('media element failed');
      }),
    });
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);

    // A rejected load is a dead source, not a ruler fallback: the card must
    // return rather than leaving live-looking controls over an embed that
    // failed again.
    const card = await screen.findByRole('alert');
    expect(card).toHaveTextContent(/couldn’t be played/i);
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    // The precision note would be a lie beside the failure card.
    expect(screen.queryByText(/Playing from YouTube/)).not.toBeInTheDocument();
    storage.close();
  });

  it('returns to the Projects screen from the nav button', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const storage = await testStorage();
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    render(<Player autosave={autosave} controller={mockController()} onExit={onExit} />);

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
      load: vi.fn(async () => ({ duration: 123.4560004 })),
    });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: 'Play' });
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(await storage.projects.get(record.id)).toBeUndefined();
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
    // Projects button sits first in the nav.)
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(2);

    // Focus on a mode button: its native Space activation is the one mode
    // switch — the window handler must not double-toggle playback on top.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Playback' })).toHaveFocus();
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Playback' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Label' })).toHaveFocus();
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
    // The playhead is a percentage of the recording — anchored at time zero.
    expect(playhead.style.left).toBe('0%');

    act(() => controller.emitPlayback({ currentTime: 5, duration: 10 }));
    // 5 s of a 10 s recording is halfway across the strip.
    expect(playhead.style.left).toBe('50%');

    // A playhead past the end (seeks are clamped by the controller, but the
    // view still guards) pins to the recording's end instead of overflowing.
    act(() => controller.emitPlayback({ currentTime: 15 }));
    expect(playhead.style.left).toBe('100%');
  });
});

/* T18 modes. The record's persisted playerMode is the player's initial
posture — a bare link arrives in Label mode, a project with community labels
in Playback — and the segmented control persists each switch. */

/** Renders a player whose record persisted Playback as the last-used mode. */
function renderPlaybackPlayer(record = projectRecord({ playerMode: 'playback' })) {
  return renderMarkingPlayer(record);
}

describe('Player modes', () => {
  it('opens a project in its persisted Label mode', async () => {
    const { container } = await renderMarkingPlayer();

    expect(screen.getByRole('button', { name: 'Label' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Playback' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Add marker' })).toBeInTheDocument();
    expect(flags(container)).toHaveLength(2);
  });

  it('opens a project whose record persisted Playback mode read-only', async () => {
    const { container } = await renderPlaybackPlayer();

    expect(screen.getByRole('button', { name: 'Playback' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Label' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();
    expect(flags(container)).toHaveLength(2);
  });

  it('applies the first-open default — marks in hand, no persisted mode: Playback', async () => {
    // Records saved before the playerMode field existed read back without it;
    // a project with marks is immediately practiceable, so its first-open
    // posture is Playback.
    const { container } = await renderMarkingPlayer(
      projectRecord({ playerMode: undefined as unknown as PlayerMode }),
    );

    expect(screen.getByRole('button', { name: 'Playback' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();
    expect(flags(container)).toHaveLength(2);
  });

  it('applies the first-open default — empty timeline, no persisted mode: Label', async () => {
    // The case the persisted-mode check alone got wrong: an empty project has
    // nothing to practise against, so read-only would hide the marking tools
    // that are the only thing to do with it.
    const { container } = await renderMarkingPlayer(
      projectRecord({ playerMode: undefined as unknown as PlayerMode, markers: [] }),
    );

    expect(screen.getByRole('button', { name: 'Label' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Add marker' })).toBeInTheDocument();
    expect(flags(container)).toHaveLength(0);
  });

  it('switches postures from the segmented control without touching playback', async () => {
    const user = userEvent.setup();
    const { controller } = await renderMarkingPlayer();
    act(() => controller.emitPlayback({ playing: true }));

    await user.click(screen.getByRole('button', { name: 'Playback' }));

    expect(screen.getByRole('button', { name: 'Playback' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.getPlaybackState().playing).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Label' }));
    expect(screen.getByRole('button', { name: 'Add marker' })).toBeInTheDocument();
  });

  it('persists the last-used mode with the record', async () => {
    const user = userEvent.setup();
    const { storage, record, unmount } = await renderMarkingPlayer();

    await user.click(screen.getByRole('button', { name: 'Playback' }));
    unmount();

    await waitFor(async () => {
      const stored = await storage.projects.get(record.id);
      expect(stored!.playerMode).toBe('playback');
    });
  });

  it('keeps every navigation tool working in Playback mode', async () => {
    const user = userEvent.setup();
    const { controller } = await renderPlaybackPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowRight}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    await user.keyboard('b');
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenLastCalledWith(10); // wraps from 20

    const slider = screen.getByRole('slider', { name: 'Volume' });
    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(controller.setVolume).toHaveBeenCalledWith(0.5);
  });

  it('leaves every editing tool behind in Playback mode', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderPlaybackPlayer();
    stubRulerBounds(container, 200);
    act(() => controller.emitPlayback({ currentTime: 15 }));

    await user.keyboard('m');
    expect(flags(container)).toHaveLength(2); // M adds nothing here

    // A click on the strip seeks — it never drops a marker while practicing.
    fireEvent.click(container.querySelector('.player-timeline-strip .rm-ruler') as HTMLElement, {
      clientX: 100,
    });
    expect(flags(container)).toHaveLength(2); // click adds nothing
    expect(controller.seek).toHaveBeenLastCalledWith((100 / 200) * RECORD_SECONDS);

    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(flags(container)).toHaveLength(2); // no selection to delete

    // The player still owns Alt+arrows — the browser Back stays blocked —
    // but without a selection there is nothing to nudge.
    expect(fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true })).toBe(false);
    expect(flags(container)[0].style.left).toBe(`${(10 / RECORD_SECONDS) * 100}%`);

    // A flag click jumps but never selects.
    fireEvent.click(flags(container)[1]);
    expect(controller.seek).toHaveBeenLastCalledWith(20);
    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(flags(container)[1]).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps a Label-mode selection hidden in Playback and restores it on return', async () => {
    const user = userEvent.setup();
    const { container } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // select A, inspector opens
    expect(screen.getByRole('region', { name: 'Marker A' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Playback' }));

    // The selection neither shows nor acts while practicing.
    expect(screen.queryByRole('region', { name: 'Marker A' })).not.toBeInTheDocument();
    expect(flags(container)[0]).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(flags(container)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Label' }));

    // The posture switch is not a deselect: the same marker is still there.
    expect(screen.getByRole('region', { name: 'Marker A' })).toBeInTheDocument();
  });

  it('unsticks shortcuts when a mode switch closes the focused inspector field', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderMarkingPlayer();
    fireEvent.click(flags(container)[0]); // select A, inspector opens
    await user.click(screen.getByLabelText('Time'));

    await user.click(screen.getByRole('button', { name: 'Playback' }));

    // The field left with the inspector; Playback-mode keys work from the
    // button now — no dead suppression follows the closed input.
    await user.keyboard('b');
    expect(controller.seek).toHaveBeenLastCalledWith(20);
  });

  it('lets M join the letter jumps in Playback mode', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderPlaybackPlayer(
      projectRecord({
        playerMode: 'playback',
        markers: Array.from({ length: 13 }, (_, i) => marker(`m${i}`, i + 1)), // labels A–M
      }),
    );
    act(() => controller.emitPlayback({ currentTime: 50 }));

    await user.keyboard('m');

    // No marker added — the playhead jumped to the marker labeled M.
    expect(flags(container)).toHaveLength(13);
    expect(controller.seek).toHaveBeenCalledTimes(1);
    expect(controller.seek).toHaveBeenLastCalledWith(13);
  });
});

/* T06 marking. The fixture record carries markers at 10s (m1) and 20s (m2). */

/** The recording's duration — flags and x→time math divide by it. */
const RECORD_SECONDS = 123.456;

/**
 * Renders a player whose playback duration matches the record. The strip is
 * not geometry-mocked: jsdom reports no layout, so its measured width never
 * lands and the flags render without the edge-overhang correction — the one
 * test that needs a width mocks it for itself.
 */
async function renderMarkingPlayer(record = projectRecord()) {
  const controller = mockController();
  const storage = await testStorage();
  controller.load = vi.fn(async () => ({ duration: RECORD_SECONDS }));
  // Settle the mount duration before the strip draws its seek surface.
  controller.emitPlayback({ duration: RECORD_SECONDS });
  const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
  const view = render(
    <Player autosave={autosave} controller={controller} onExit={vi.fn()} />,
  );
  await screen.findByRole('button', { name: 'Play' });
  return { ...view, controller, storage, record, autosave };
}

/** The marker flag buttons, in DOM order (which is time order). */
function flags(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.player-flag'));
}

/** A strip-sized DOMRect — jsdom has no layout, so tests own the geometry. */
function stripRect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 96,
    width,
    height: 96,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Gives the strip's seek surface a fixed box so clicks land at known ratios. */
function stubRulerBounds(container: HTMLElement, width: number): void {
  const ruler = container.querySelector('.player-timeline-strip .rm-ruler') as HTMLElement;
  Object.defineProperty(ruler, 'getBoundingClientRect', {
    value: () => stripRect(width),
  });
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
      <Player autosave={autosave} controller={controller} onExit={vi.fn()} />,
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

/* T38. The recording's clock is a single full-width strip below the split —
never a zoomed, scrolling timeline. Marker positions and the playhead are
percentages of the recording, so the strip is always exactly the content width
and never needs a scroll shell or reveal-on-jump: the fit-to-viewport zoom
machinery (pixels-per-second, content-width fit, scroll anchoring) is retired.
The one geometry the strip still owns is its measured width, kept solely to
pull a flag at time zero back on screen. */

describe('Player timeline strip (T38)', () => {
  it('moves the timeline out of the video column into a full-width strip below the split', async () => {
    const { container } = await renderMarkingPlayer();

    const split = container.querySelector('.player-practice-split') as HTMLElement;
    const strip = container.querySelector('.player-timeline-strip') as HTMLElement;

    // The strip is the split's own sibling, below it — a block spanning the
    // rail's content width, not one of the split's panes.
    expect(split.nextElementSibling).toBe(strip);

    // The video column keeps only the recording's mount — no flags, no
    // playhead, no seek surface of its own.
    const videoColumn = split.querySelector('.player-video-column') as HTMLElement;
    expect(videoColumn.querySelector('.player-ruler')).not.toBeNull();
    expect(videoColumn.querySelector('.player-flag')).toBeNull();
    expect(videoColumn.querySelector('.player-playhead')).toBeNull();

    // The strip carries the seek surface, the flags, and the playhead.
    expect(strip.querySelector('.rm-ruler')).not.toBeNull();
    expect(strip.querySelectorAll('.player-flag')).toHaveLength(2);
    expect(strip.querySelector('.player-playhead')).not.toBeNull();
  });

  it('draws its seek surface from the shared ruler module, ticks included', async () => {
    const { container } = await renderMarkingPlayer();
    const strip = container.querySelector('.player-timeline-strip') as HTMLElement;

    // The surface is the shared ruler-drawing module's `.rm-ruler` — role and
    // aria contract intact, its numbered ticks drawn. The ticks are hidden by
    // player.css (`.player-timeline-strip .rm-ruler-tick { display: none }`),
    // since students navigate by rehearsal marks, not clock time; the drawing
    // module itself is untouched. (jsdom applies no CSS, so the hiding rule is
    // asserted where it lives — the stylesheet.)
    const ruler = strip.querySelector('.rm-ruler') as HTMLElement;
    expect(ruler.getAttribute('role')).toBe('slider');
    expect(ruler.getAttribute('aria-label')).toBe('Recording timeline');
    expect(strip.querySelectorAll('.rm-ruler-tick').length).toBeGreaterThan(1);
  });

  it('sizes by percentages only — no pixel offsets, no inline widths', async () => {
    const { container } = await renderMarkingPlayer();

    // The seek surface spans the strip with no pixel sizing of its own. The
    // flag overlay's inline width is set only once the strip is actually
    // measured; jsdom measures no layout, so it stays unset here.
    expect((container.querySelector('.player-timeline-surface') as HTMLElement).style.width).toBe(
      '',
    );
    expect((container.querySelector('.player-markers') as HTMLElement).style.width).toBe('');
    // The playhead is a percentage of the recording too.
    expect((container.querySelector('.player-playhead') as HTMLElement).style.left).toMatch(/%$/);
  });

  it('seeks anywhere on the strip, and a flag click jumps without selecting in Playback', async () => {
    const { container, controller } = await renderPlaybackPlayer();
    stubRulerBounds(container, 200);

    // Clicking empty strip space seeks to the clicked ratio of the recording.
    fireEvent.click(container.querySelector('.player-timeline-strip .rm-ruler') as HTMLElement, {
      clientX: 50,
    });
    expect(controller.seek).toHaveBeenLastCalledWith((50 / 200) * RECORD_SECONDS);

    // A flag click jumps to its marker — and never selects in Playback mode.
    fireEvent.click(flags(container)[1]);
    expect(controller.seek).toHaveBeenLastCalledWith(20);
    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(flags(container)[1]).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps a flag at time zero on screen — the edge overhang is pulled inward', async () => {
    // jsdom measures no strip width, so the correction never lands in most
    // tests; this one gives the strip a real width to see it work.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(stripRect(800));
    try {
      const { container } = await renderMarkingPlayer(
        projectRecord({ markers: [marker('m0', 0), marker('m1', 10)] }),
      );

      // A flag centered on the strip's left edge would hang half its chip off
      // screen, where nothing can reach it; it is pulled inward instead.
      expect(flags(container)[0].style.transform).toBe('translateX(calc(-50% + 16px))');
      // A marker deep in the recording centers normally — no correction.
      expect(flags(container)[1].style.transform).toBe('');
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('retires the zoom machinery: no scroll shell, no content-width fit, no reveal-on-jump', async () => {
    const { container } = await renderMarkingPlayer();

    // The player renders no scroll shell and sizes no timeline to a fitted
    // content width.
    expect(container.querySelector('.player-ruler-shell')).toBeNull();
    expect((container.querySelector('.player-ruler') as HTMLElement).style.width).toBe('');

    // A jump reveals nothing by scrolling — the strip is never scrolled.
    fireEvent.click(flags(container)[1]);
    expect((container.querySelector('.player-timeline-strip') as HTMLElement).scrollLeft).toBe(0);
  });

  it('renders the markers even when playback has failed', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({
        duration: 0,
        error: new YouTubePlaybackError(150),
      })),
    });
    // The dead embed publishes the record's stored length before failing —
    // exactly what the YouTube backend's failure paths do — so the strip
    // renders on the last honest number the app has.
    controller.emitPlayback({ duration: RECORD_SECONDS });
    const record = projectRecord({ playerMode: 'label', duration: RECORD_SECONDS });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    const { container } = render(
      <Player autosave={autosave} controller={controller} onExit={vi.fn()} />,
    );
    await screen.findByRole('alert');

    // The failure card names the problem; the strip still renders the marks on
    // the stored-duration timeline.
    const strip = container.querySelector('.player-timeline-strip') as HTMLElement;
    expect(strip.querySelectorAll('.player-flag')).toHaveLength(2);
    expect(flags(container)[0].style.left).toBe(`${(10 / RECORD_SECONDS) * 100}%`);
    storage.close();
  });
});

describe('Player — YouTube projects', () => {
  const CANONICAL = canonicalYouTubeUrl(projectRecord().videoId);

  /** A loaded YouTube session: ruler-only by construction, no zoom. */
  async function renderYouTubePlayer(duration = 200) {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration })),
    });
    // Settle the mount duration before the strip draws its seek surface.
    controller.emitPlayback({ duration });
    const record = projectRecord({ name: 'Brahms — Intermezzo', duration });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    const view = render(
      <Player autosave={autosave} controller={controller} onExit={vi.fn()} />,
    );
    // Settle the load before handing the view back: the ruler note only
    // renders once the load has settled.
    await screen.findByText(/Playing from YouTube/);
    return { ...view, controller, storage, autosave };
  }

  it('plays the canonical URL through the YouTube arm of the seam', async () => {
    const { controller, storage } = await renderYouTubePlayer();

    const options = youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]);
    // No blob and no peaks exist on this path — the URL is the whole input.
    expect(options.url).toBe(CANONICAL);
    expect(options.container).toHaveClass('player-ruler');
    storage.close();
  });

  it('states playback precision honestly on the ruler note', async () => {
    const { storage } = await renderYouTubePlayer();

    const note = await screen.findByText(/Playing from YouTube/);
    // The coarse clock and its consequence for clock-taken marks…
    expect(note).toHaveTextContent(/coarse/i);
    expect(note).toHaveTextContent(/quarter second/i);
    // …and the part that stays exact, so the caveat is scoped, not blanket.
    expect(note).toHaveTextContent(/Typed times and nudges stay exact/i);
    expect(note).not.toHaveTextContent(/timeline still works/);
    storage.close();
  });

  it('shows the browsable-but-muted error card when the video cannot play', async () => {
    const storage = await testStorage();
    // The audio layer's failure channel: the embed reported it cannot play
    // (private, removed, region-blocked, embed-disabled, or no API script).
    const controller = mockController({
      load: vi.fn(async () => ({
        duration: 0,
        error: new YouTubePlaybackError(150),
      })),
    });
    const record = projectRecord({ playerMode: 'label', duration: 0 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);

    // The card names the problem, the video, and the way out — the URL and an
    // "Open on YouTube" link, so a deleted video is explained, not silent.
    const card = await screen.findByRole('alert');
    expect(card).toHaveTextContent(/couldn’t be played/i);
    const link = within(card).getByRole('link', { name: CANONICAL });
    expect(link).toHaveAttribute('href', CANONICAL);
    // The precision note would be a lie here — nothing is playing at all.
    expect(screen.queryByText(/Playing from YouTube/)).not.toBeInTheDocument();
    // And the transport must not promise what no click can deliver.
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    // The marking tools are muted too — a mark from a dead clock is noise.
    expect(screen.getByRole('button', { name: 'Add marker' })).toBeDisabled();
    storage.close();
  });

  it('retries the load from the error card and clears it on success', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const load = vi
      .fn<() => Promise<LoadResult>>()
      .mockResolvedValueOnce({ duration: 0, error: new YouTubePlaybackError(150) })
      .mockResolvedValueOnce({ duration: 604.2 });
    const controller = mockController({ load });
    const record = projectRecord({ duration: 604.2 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    // The retry re-runs the load; a temporary outage recovers without
    // recreating the project.
    expect(load).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Playing from YouTube/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    storage.close();
  });

  it('cannot add marks while the video cannot play — not by button, not by M', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({
        duration: 604.2,
        error: new YouTubePlaybackError(150),
      })),
    });
    const record = projectRecord({ playerMode: 'label', duration: 604.2 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);
    await screen.findByRole('alert');

    await user.keyboard('m');

    // M fell through to the letter jump (no marker named M) — the record's
    // two fixture marks are untouched, nothing was added.
    expect(autosave.get().markers).toHaveLength(2);
    storage.close();
  });

  it('tells an empty Label-mode project that no community labels loaded', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2 })),
    });
    const record = projectRecord({ playerMode: 'label', markers: [], duration: 604.2 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);

    // An empty Label mode is never a mystery: the missing labels are named —
    // in the same note that carries the precision caveat, never a second
    // stacked paragraph.
    const note = await screen.findByText(/no community labels loaded/i);
    expect(note).toHaveTextContent(/quarter second/i);
    storage.close();
  });

  it('keeps the no-labels note to the empty Label-mode case', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2 })),
    });
    // Marks in hand: Playback mode, nothing to explain.
    const record = projectRecord({ playerMode: 'playback', duration: 604.2 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);

    await screen.findByText(/Playing from YouTube/);
    expect(screen.queryByText(/no community labels/i)).not.toBeInTheDocument();
    storage.close();
  });

  it('gives the timeline the full content width instead of zooming the embed off-screen', async () => {
    const { container, storage } = await renderYouTubePlayer(200);

    // The strip is the split's own sibling — a block that spans the rail's
    // content width — and nothing inside it is sized in pixels. A zoomed
    // timeline would stretch the video (it sits in the split above) off-
    // screen; there is no fitted width to grow.
    const split = container.querySelector('.player-practice-split') as HTMLElement;
    const strip = container.querySelector('.player-timeline-strip') as HTMLElement;
    expect(split.nextElementSibling).toBe(strip);
    expect((container.querySelector('.player-ruler') as HTMLElement).style.width).toBe('');

    storage.close();
  });

  it('leaves ctrl+scroll to the browser — there is no zoom to gesture at', async () => {
    const { container, storage } = await renderYouTubePlayer(200);
    const strip = container.querySelector('.player-timeline-strip') as HTMLElement;

    const wheel = new WheelEvent('wheel', {
      deltaY: -300,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      strip.dispatchEvent(wheel);
    });

    // The strip has no wheel handler: nothing was resized and nothing was
    // preventDefault'd, so the page keeps its own zoom over the embed.
    expect((container.querySelector('.player-ruler') as HTMLElement).style.width).toBe('');
    expect(wheel.defaultPrevented).toBe(false);
    storage.close();
  });

  it('drives play/pause, seek, and volume through the same transport', async () => {
    const user = userEvent.setup();
    const { controller, storage } = await renderYouTubePlayer(200);
    const play = await screen.findByRole('button', { name: 'Play' });

    await user.click(play);
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);

    act(() => controller.emitPlayback({ playing: true }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    // Keyboard navigation is unchanged by the source: → seeks +5 s.
    await user.keyboard('{ArrowRight}');
    expect(controller.seek).toHaveBeenCalledWith(5);

    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '0.4' } });
    expect(controller.setVolume).toHaveBeenCalledWith(0.4);
    storage.close();
  });

  it('persists the duration the embed reports, so the list and ruler stay honest', async () => {
    // A project is created with duration 0 — only the embed knows the real
    // length, and it arrives with the load result.
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372.5 })),
    });
    const record = projectRecord({ duration: 0 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} onExit={vi.fn()} />);
    await screen.findByText(/Playing from YouTube/);

    await waitFor(() => expect(autosave.get().duration).toBe(372.5));
    storage.close();
  });

  describe('the practice split view (T27)', () => {
    const readout = () => screen.getByRole('region', { name: 'Practice readout' });

    it('splits the view: the readout sits beside the recording', async () => {
      const { storage } = await renderYouTubePlayer();

      const split = document.querySelector('.player-practice-split') as HTMLElement;
      // The recording and the readout are the split's two panes; the timeline
      // is the strip below the split, not one of its columns.
      expect(split.querySelector('.player-video-column .player-ruler')).not.toBeNull();
      expect(split.querySelector('.player-timeline-strip')).toBeNull();
      expect(within(split).getByRole('region', { name: 'Practice readout' })).toBeInTheDocument();
      storage.close();
    });

    it('reads Start, then the passed and next markers, following seeks', async () => {
      const { controller, storage } = await renderYouTubePlayer();

      // The mock's store starts at its 10s default; the real controller
      // resets the store to the load's duration — mirror it so seeks clamp
      // on the same boundary production does.
      act(() => controller.emitPlayback({ duration: 200 }));

      // Before the first mark (markers at 10s and 20s) the left slot is Start.
      expect(within(readout()).getByText('Start')).toBeInTheDocument();

      act(() => controller.seek(15));
      expect(within(readout()).getByText('A')).toBeInTheDocument();
      expect(within(readout()).getByText('B')).toBeInTheDocument();
      expect(within(readout()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0.5');
      // The metro console reads in whole seconds, not twitching milliseconds.
      expect(within(readout()).getByText('00:10')).toBeInTheDocument();
      expect(within(readout()).getByText('00:20')).toBeInTheDocument();

      act(() => controller.seek(25));
      expect(within(readout()).getByText('B')).toBeInTheDocument();
      expect(within(readout()).getByText('End')).toBeInTheDocument();
      storage.close();
    });

    it('confines the flags and playhead to the timeline strip', async () => {
      const { storage } = await renderYouTubePlayer();

      // The overlays belong to the timeline, never the recording's column.
      const videoColumn = document.querySelector('.player-video-column') as HTMLElement;
      const strip = document.querySelector('.player-timeline-strip') as HTMLElement;
      expect(videoColumn.querySelector('.player-flag')).toBeNull();
      expect(videoColumn.querySelector('.player-playhead')).toBeNull();
      expect(strip.querySelector('.player-flag')).not.toBeNull();
      expect(strip.querySelector('.player-playhead')).not.toBeNull();
      storage.close();
    });
  });
});
