import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadResult } from '../audio';
import { YouTubePlaybackError } from '../audio/errors';
import { canonicalYouTubeUrl } from '../domain';
import { createAutosave } from '../storage';
import { mockController } from '../test/controller-fixture';
import { youtubeLoad } from '../test/load-fixture';
import { marker } from '../test/marker-fixture';
import { projectRecord } from '../test/project-fixture';
import { closeTestStorages, testStorage } from '../test/storage-fixture';
import { waitForPlayerSettled } from '../test/settle-player';
import { Player } from './Player';
// jsdom computes no layout, so the layout facts are CSS text — the narrow
// viewport and console-row tests pin them by reading the stylesheet from disk
// (vitest stubs CSS imports, raw or not, to an empty string). The shared page
// rail moved to the shell stylesheet (T44), so the rail's fact is read there.
const playerCss = readFileSync('src/ui/player.css', 'utf8');
const appCss = readFileSync('src/ui/app.css', 'utf8');

afterEach(closeTestStorages);

/**
 * Renders a loaded player whose load result matches the record's duration —
 * the same render the marking tests use, surfaced with the autosave handle
 * for the tests that only need the controller and the view.
 */
async function renderLoadedPlayer(record = projectRecord()) {
  const { autosave, ...rest } = await renderSettledPlayer(record);
  return { ...rest, autosave };
}

describe('Player', () => {
  it('loads the canonical URL through the controller and shows the project name', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 123.456 })),
    });
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} />);

    expect(screen.getByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();

    expect(controller.load).toHaveBeenCalledTimes(1);
    const options = youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]);
    expect(options.url).toBe(canonicalYouTubeUrl(record.videoId));
    expect(options.container).toBeInstanceOf(HTMLDivElement);
    expect(document.body.contains(options.container)).toBe(true);
    storage.close();
  });

  it('carries no navigation of its own — the shell’s navbar is the only chrome (T45)', async () => {
    const storage = await testStorage();
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={mockController()} />);

    // The in-player Projects control and its nav bar are retired (T45):
    // navigation is the shell's — the persistent navbar frames the player, so
    // the player renders none of its own.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Projects' })).not.toBeInTheDocument();

    // The title band is still the player's — the record's name over the split.
    expect(screen.getByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    // Settle the async load inside act before the test ends.
    await waitForPlayerSettled();
    storage.close();
  });

  it('persists the media duration learned from the load', async () => {
    const storage = await testStorage();
    const controller = mockController({ load: vi.fn(async () => ({ duration: 42 })) });
    const record = projectRecord({ duration: 0 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    const { unmount } = render(<Player autosave={autosave} controller={controller} />);
    await waitForPlayerSettled();
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

    render(<Player autosave={autosave} controller={controller} />);

    const card = await screen.findByRole('alert');
    expect(card).toHaveTextContent(/couldn’t be played/i);
    // There is no transport left to disable, and no precision note to lie
    // beside the card.
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Playing from YouTube/)).not.toBeInTheDocument();
    storage.close();
  });

  it('does not write the record over sub-millisecond duration noise', async () => {
    const storage = await testStorage();
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    const controller = mockController({ load: vi.fn(async () => ({ duration: 123.4560004 })) });

    render(<Player autosave={autosave} controller={controller} />);
    await waitForPlayerSettled();
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(await storage.projects.get(record.id)).toBeUndefined();
    storage.close();
  });
});

describe('Player — playback-only (T39)', () => {
  it('renders no posture toggle, transport, Add marker, inspector, or undo', async () => {
    const { container } = await renderLoadedPlayer();

    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Playback' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Label' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Volume' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Marker [A-Z]/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete marker' })).not.toBeInTheDocument();
    // The flags themselves survive — they are the navigable map of the marks.
    expect(flags(container)).toHaveLength(2);
  });

  it('renders no save-status line and no explanatory note', async () => {
    await renderLoadedPlayer();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Playing from YouTube/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no community labels/i)).not.toBeInTheDocument();
  });

  it('moves the playhead indicator with playback time', async () => {
    const { controller, container } = await renderLoadedPlayer();
    const playhead = container.querySelector('.player-playhead') as HTMLElement;
    expect(playhead).not.toBeNull();
    expect(playhead.style.left).toBe('0%');

    act(() => controller.emitPlayback({ currentTime: 5, duration: 10 }));
    expect(playhead.style.left).toBe('50%');

    act(() => controller.emitPlayback({ currentTime: 15 }));
    expect(playhead.style.left).toBe('100%');
  });

  it('toggles with Space, except while a button has focus', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 0, error: new YouTubePlaybackError(150) })),
    });
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    const { unmount } = render(<Player autosave={autosave} controller={controller} />);
    await screen.findByRole('alert');

    // With focus on the body, Space is the player's play/pause.
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);

    // A focused button owns Space through native activation — the window
    // handler must not double-toggle playback on top. The failure card's Retry
    // is the player's only focus stop (the card's URL link precedes it).
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);

    unmount();
    storage.close();
  });
});

describe('Player — the practice console (T36)', () => {
  const readout = () => screen.getByRole('region', { name: 'Practice readout' });

  it('reads Start with the 00:00 timestamp before the first mark', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 4 }));

    const region = readout();
    expect(within(region).getByText('Start')).toBeInTheDocument();
    expect(within(region).getByText('00:00')).toBeInTheDocument();
    expect(within(region).getByText('A')).toBeInTheDocument();
    expect(within(region).getByText('00:10')).toBeInTheDocument();
  });

  it('shows the passed marker with letter and first alias, and the next marker', async () => {
    const { controller } = await renderLoadedPlayer(
      projectRecord({ markers: [marker('m1', 10, ['Recap']), marker('m2', 20)] }),
    );
    act(() => controller.emitPlayback({ currentTime: 15 }));

    const region = readout();
    expect(within(region).getByText('A — Recap')).toBeInTheDocument();
    expect(within(region).getByText('B')).toBeInTheDocument();
  });

  it('renders a bare label when the passed marker has no alias', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 25 }));

    const region = readout();
    expect(within(region).getByText('B')).toBeInTheDocument();
    expect(within(region).queryByText(/—/)).not.toBeInTheDocument();
  });

  it('reads End with the recording duration after the last mark', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 35, duration: 40 }));

    const region = readout();
    expect(within(region).getByText('End')).toBeInTheDocument();
    expect(within(region).getByText('00:40')).toBeInTheDocument();
  });

  it('drives the progress bar from the live playhead', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    const bar = within(readout()).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0.5');
    expect(bar.querySelector('.player-practice-bar-fill')).toHaveStyle({ width: '50%' });
  });

  it('keeps both timestamps under the bar, at its two ends', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    const region = readout();
    const times = region.querySelector('.player-practice-times');
    expect(times).not.toBeNull();
    expect(within(times as HTMLElement).getByText('00:10')).toBeInTheDocument();
    expect(within(times as HTMLElement).getByText('00:20')).toBeInTheDocument();
    expect(region.querySelector('.player-practice-bar')).not.toBeNull();
  });

  it('orders the head so each caption leads its value — the grid placement basis', async () => {
    // jsdom computes no grid, so this pins the source order the metro head's
    // row/column placement rests on — the nearest observable proxy for
    // "captions on one row, values on the next". The CSS realizes the layout.
    const { controller } = await renderLoadedPlayer(
      projectRecord({ markers: [marker('m1', 10, ['Recap']), marker('m2', 20)] }),
    );
    act(() => controller.emitPlayback({ currentTime: 15 }));

    const head = readout().querySelector('.player-practice-head');
    expect(
      Array.from((head as HTMLElement).children).map((element) => element.textContent),
    ).toEqual(['Current marker', 'A — Recap', 'Next', 'B']);
  });

  it('keeps the captions on one row and the values on the next — the grid-placement rules', () => {
    // The arrangement went through two revisions (a bottom-aligned flex row
    // was tried and dropped), and jsdom computes no grid — so pin the CSS
    // placements that realize it, exactly as the narrow-viewport test pins
    // the overflow guards. Captions share row 1, values row 2, the next
    // column hugging its content and flushing right.
    expect(playerCss).toMatch(
      /\.player-practice-head\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/,
    );
    expect(playerCss).toMatch(/\.player-practice-head\s*\{[^}]*grid-template-rows:\s*auto\s+auto;/);
    expect(playerCss).toMatch(/\.player-practice-label\s*\{[^}]*grid-row:\s*1;[^}]*grid-column:\s*1;/);
    expect(playerCss).toMatch(/\.player-practice-now\s*\{[^}]*grid-row:\s*2;[^}]*grid-column:\s*1;/);
    expect(playerCss).toMatch(/\.player-practice-next\s*\{[^}]*grid-row:\s*2;[^}]*grid-column:\s*2;/);
  });

  it('shows the anchor times in whole seconds, never milliseconds', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    const region = readout();
    expect(within(region).queryByText(/\.\d{3}/)).not.toBeInTheDocument();
  });
});

describe('Player navigation — arrow jumps', () => {
  it('jumps ↓ to the next marker, ↑ back, wrapping at both ends', async () => {
    const user = userEvent.setup();
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenLastCalledWith(10);

    await user.keyboard('{ArrowUp}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);
  });

  it('wraps up from before the first marker to the last', async () => {
    const user = userEvent.setup();
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 1 }));

    await user.keyboard('{ArrowUp}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);
  });

  it('walks past a marker the seek landed a frame short of', async () => {
    const user = userEvent.setup();
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 9.999 }));

    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);
  });

  it('keeps playing across a jump and never selects', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15, playing: true }));

    await user.keyboard('{ArrowDown}');

    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.getPlaybackState().playing).toBe(true);
    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(selectedFlags(container)).toHaveLength(0);
  });

  it('anchors the jump at the live playhead, not the trailing store value', async () => {
    const user = userEvent.setup();
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 14 }));
    act(() => controller.emitPlayback({ currentTime: 17 }));

    // The store has raced ahead of the audible position; a press at 16.9s
    // should still jump to B, the marker past the *live* playhead.
    act(() => controller.emitPlayback({ currentTime: 17.0001 }));
    act(() => controller.emitPlayback({ currentTime: 17 }));
    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);
  });

  it('does nothing when there are no markers, leaving the keys to the browser', async () => {
    const { controller } = await renderLoadedPlayer(projectRecord({ markers: [] }));
    act(() => controller.emitPlayback({ currentTime: 5 }));

    expect(fireEvent.keyDown(document.body, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'ArrowUp' })).toBe(true);
    expect(controller.seek).not.toHaveBeenCalled();
  });
});

describe('Player navigation — letter jumps', () => {
  it('jumps straight to a marker by its letter, case-insensitively, without ever selecting', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderLoadedPlayer();

    await user.keyboard('b');
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    await user.keyboard('{Shift>}b{/Shift}');
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(selectedFlags(container)).toHaveLength(0);
  });

  it('blocks the default on a letter that has a marker and leaves the rest alone', async () => {
    const { controller } = await renderLoadedPlayer();

    expect(fireEvent.keyDown(document.body, { key: 'a' })).toBe(false);
    expect(controller.seek).toHaveBeenLastCalledWith(10);

    expect(fireEvent.keyDown(document.body, { key: 'd' })).toBe(true);
    expect(controller.seek).toHaveBeenCalledTimes(1);
  });

  it('makes M just another letter jump — to the marker labelled M, never adding', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderLoadedPlayer(
      projectRecord({ markers: Array.from({ length: 13 }, (_, i) => marker(`m${i}`, i + 1)) }),
    );
    act(() => controller.emitPlayback({ currentTime: 50 }));

    await user.keyboard('m');

    // M jumps to the marker labelled M (the 13th, at 13s) — it no longer
    // creates a new mark, so the flag count is unchanged and one seek happened.
    expect(flags(container)).toHaveLength(13);
    expect(controller.seek).toHaveBeenCalledTimes(1);
    expect(controller.seek).toHaveBeenLastCalledWith(13);
  });
});

describe('Player navigation — seeking', () => {
  it('seeks ∓5s with plain ←/→ and blocks the page scroll', async () => {
    const user = userEvent.setup();
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 17.5 }));

    await user.keyboard('{ArrowLeft}');
    expect(controller.seek).toHaveBeenLastCalledWith(12.5);

    await user.keyboard('{ArrowRight}');
    expect(controller.seek).toHaveBeenLastCalledWith(17.5);

    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight' })).toBe(false);
  });

  it('seeks while playing without pausing', async () => {
    const user = userEvent.setup();
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 30, playing: true }));

    await user.keyboard('{ArrowLeft}');

    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.getPlaybackState().playing).toBe(true);
  });

  it('leaves Alt+arrows to the browser — Back works again', async () => {
    const { container, controller } = await renderLoadedPlayer();

    // The nudge is gone with the editing tools, so Alt+arrows are no longer
    // intercepted: Alt+← reverts to the browser's Back, an accepted
    // consequence of playback-only. dispatchEvent returns true when the
    // handler did not preventDefault.
    expect(fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true })).toBe(true);
    expect(controller.seek).not.toHaveBeenCalled();
    expect(flags(container)).toHaveLength(2);
  });
});

describe('Player navigation — focus and gating', () => {
  it('acts once per press, ignoring the OS key-repeat', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    await user.keyboard('{ArrowDown}');
    expect(controller.seek).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: 'ArrowDown', repeat: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true });
    fireEvent.keyDown(document.body, { key: 'm', repeat: true });
    expect(controller.seek).toHaveBeenCalledTimes(1);
    expect(flags(container)).toHaveLength(2);
  });

  it('leaves Shift+arrows to the browser', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'ArrowDown', shiftKey: true })).toBe(true);
    expect(controller.seek).not.toHaveBeenCalled();
  });

  it('ignores shortcuts before the recording settles', async () => {
    const user = userEvent.setup();
    const controller = mockController();
    controller.load = vi.fn(() => new Promise<LoadResult>(() => {})); // never resolves
    const storage = await testStorage();
    const record = projectRecord();
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    render(<Player autosave={autosave} controller={controller} />);

    // Space is gated with the rest — a press during load is not swallowed
    // against a dead embed (spec #74, story 37).
    await user.keyboard('{ArrowRight}{ArrowDown}b ');

    expect(controller.seek).not.toHaveBeenCalled();
    expect(controller.togglePlay).not.toHaveBeenCalled();
  });

  it('keeps Space meaning play/pause after a flag click', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderLoadedPlayer();

    fireEvent.click(flags(container)[1]); // jump to B — a single seek, no select
    expect(controller.seek).toHaveBeenLastCalledWith(20);

    await user.keyboard(' ');

    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
    expect(controller.seek).toHaveBeenCalledTimes(1);
  });
});

describe('Player navigation — suppression in text inputs', () => {
  it('suppresses shortcuts while a text field has focus', async () => {
    const user = userEvent.setup();
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    // The player no longer contains a text field (T39), but the guard is
    // retained — cheap, correct, and future-proof. Focus a probe input to
    // prove the suppression still holds.
    const probe = document.createElement('input');
    document.body.appendChild(probe);
    try {
      probe.focus();
      await user.keyboard('{ArrowLeft}{ArrowRight}{ArrowDown}b');
      expect(controller.seek).not.toHaveBeenCalled();
    } finally {
      probe.remove();
    }
  });
});

/* The fixture record carries markers at 10s (m1) and 20s (m2) — the anchor
positions the navigation and strip tests divide by. */

/** The recording's duration — flags and x→time math divide by it. */
const RECORD_SECONDS = 123.456;

/**
 * Renders a settled player — the load has resolved (success path) and its
 * playback duration matches the record. The strip is not geometry-mocked:
 * jsdom reports no layout, so its measured width never lands and the flags
 * render without the edge-overhang correction — the one test that needs a
 * width mocks it for itself.
 */
async function renderSettledPlayer(record = projectRecord()) {
  const controller = mockController();
  const storage = await testStorage();
  controller.load = vi.fn(async () => ({ duration: RECORD_SECONDS }));
  // Settle the mount duration before the strip draws its seek surface.
  controller.emitPlayback({ duration: RECORD_SECONDS });
  const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
  const view = render(<Player autosave={autosave} controller={controller} />);
  await waitForPlayerSettled();
  return { ...view, controller, storage, record, autosave };
}

/** The marker flag buttons, in DOM order (which is time order). */
function flags(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.player-flag'));
}

/**
 * The flags in the selected state. Selection ceased to exist with the editing
 * tools (T39), so a player test asserting selection would expect this empty —
 * the helper exists to make that "no flag is ever pressed" assertion read.
 */
function selectedFlags(container: HTMLElement): HTMLElement[] {
  return flags(container).filter((flag) => flag.getAttribute('aria-pressed') === 'true');
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

describe('Player — read-only over markers (T39)', () => {
  it('no keyboard gesture can create, move, rename, or delete a marker', async () => {
    const user = userEvent.setup();
    const { container, controller, autosave } = await renderLoadedPlayer();
    const original = autosave.get().markers;
    act(() => controller.emitPlayback({ currentTime: 15 }));

    // M: a 2-marker set has no marker M — nothing to jump to, and nothing is
    // added. Delete/Backspace: no selection, no delete. ArrowLeft: seeks −5s,
    // never moves a marker.
    await user.keyboard('m{Delete}{Backspace}{ArrowLeft}');

    expect(flags(container)).toHaveLength(2);
    expect(autosave.get().markers).toEqual(original);
    // The only effect was the seek.
    expect(controller.seek).toHaveBeenCalledTimes(1);
    expect(controller.seek).toHaveBeenLastCalledWith(10);
  });

  it('a flag click jumps to the marker and never selects', async () => {
    const { container, controller } = await renderLoadedPlayer();

    fireEvent.click(flags(container)[1]); // B at 20s

    expect(controller.seek).toHaveBeenCalledWith(20);
    // Selection ceased to exist in the player: no inspector, no pressed flag.
    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(flags(container)[1]).not.toHaveAttribute('aria-pressed');
  });
});

describe('Player timeline strip (T38)', () => {
  it('moves the timeline out of the video column into a full-width strip below the split', async () => {
    const { container } = await renderLoadedPlayer();

    const split = container.querySelector('.player-practice-split') as HTMLElement;
    const strip = container.querySelector('.player-timeline-strip') as HTMLElement;
    expect(split.nextElementSibling).toBe(strip);

    const videoColumn = split.querySelector('.player-video-column') as HTMLElement;
    expect(videoColumn.querySelector('.player-ruler')).not.toBeNull();
    expect(videoColumn.querySelector('.player-flag')).toBeNull();
    expect(videoColumn.querySelector('.player-playhead')).toBeNull();

    expect(strip.querySelector('.rm-ruler')).not.toBeNull();
    expect(strip.querySelectorAll('.player-flag')).toHaveLength(2);
    expect(strip.querySelector('.player-playhead')).not.toBeNull();
  });

  it('draws its seek surface from the shared ruler module, ticks included', async () => {
    const { container } = await renderLoadedPlayer();
    const strip = container.querySelector('.player-timeline-strip') as HTMLElement;

    const ruler = strip.querySelector('.rm-ruler') as HTMLElement;
    expect(ruler.getAttribute('role')).toBe('slider');
    expect(ruler.getAttribute('aria-label')).toBe('Recording timeline');
    expect(strip.querySelectorAll('.rm-ruler-tick').length).toBeGreaterThan(1);
  });

  it('sizes by percentages only — no pixel offsets, no inline widths', async () => {
    const { container } = await renderLoadedPlayer();

    expect((container.querySelector('.player-timeline-surface') as HTMLElement).style.width).toBe('');
    expect((container.querySelector('.player-markers') as HTMLElement).style.width).toBe('');
    expect((container.querySelector('.player-playhead') as HTMLElement).style.left).toMatch(/%$/);
  });

  it('seeks anywhere on the strip, and a flag click jumps without ever selecting', async () => {
    const { container, controller } = await renderLoadedPlayer();
    stubRulerBounds(container, 200);

    fireEvent.click(container.querySelector('.player-timeline-strip .rm-ruler') as HTMLElement, {
      clientX: 50,
    });
    expect(controller.seek).toHaveBeenLastCalledWith((50 / 200) * RECORD_SECONDS);

    fireEvent.click(flags(container)[1]);
    expect(controller.seek).toHaveBeenLastCalledWith(20);
    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(flags(container)[1]).not.toHaveAttribute('aria-pressed');
  });

  it('keeps a flag at time zero on screen — the edge overhang is pulled inward', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(stripRect(800));
    try {
      const { container } = await renderLoadedPlayer(
        projectRecord({ markers: [marker('m0', 0), marker('m1', 10)] }),
      );

      expect(flags(container)[0].style.transform).toBe('translateX(calc(-50% + 16px))');
      expect(flags(container)[1].style.transform).toBe('');
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('retires the zoom machinery: no scroll shell, no content-width fit, no reveal-on-jump', async () => {
    const { container } = await renderLoadedPlayer();

    expect(container.querySelector('.player-ruler-shell')).toBeNull();
    expect((container.querySelector('.player-ruler') as HTMLElement).style.width).toBe('');

    fireEvent.click(flags(container)[1]);
    expect((container.querySelector('.player-timeline-strip') as HTMLElement).scrollLeft).toBe(0);
  });

  it('renders the markers even when playback has failed', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 0, error: new YouTubePlaybackError(150) })),
    });
    controller.emitPlayback({ duration: RECORD_SECONDS });
    const record = projectRecord({ duration: RECORD_SECONDS });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    const { container } = render(<Player autosave={autosave} controller={controller} />);
    await screen.findByRole('alert');

    const strip = container.querySelector('.player-timeline-strip') as HTMLElement;
    expect(strip.querySelectorAll('.player-flag')).toHaveLength(2);
    expect(flags(container)[0].style.left).toBe(`${(10 / RECORD_SECONDS) * 100}%`);
    storage.close();
  });

  it('keeps the page from scrolling sideways at a narrow viewport', () => {
    // jsdom cannot observe layout, so the overflow guards are CSS facts —
    // pin the rules that let the rail and the split shrink instead of forcing
    // a horizontal scrollbar: box-sizing on the shared page rail (now in the
    // shell stylesheet, app.css), minmax(0, …) columns in the split, and
    // min-width: 0 on the video column.
    expect(appCss).toMatch(/\.page-rail\s*\{[^}]*box-sizing:\s*border-box;/);
    expect(playerCss).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1\.1fr\)\s+minmax\(0,\s*0\.9fr\);/,
    );
    expect(playerCss).toMatch(/\.player-video-column\s*\{\s*min-width:\s*0;/);
  });
});

describe('Player — YouTube projects', () => {
  const CANONICAL = canonicalYouTubeUrl(projectRecord().videoId);

  async function renderYouTubePlayer(duration = 200) {
    const storage = await testStorage();
    const controller = mockController({ load: vi.fn(async () => ({ duration })) });
    controller.emitPlayback({ duration });
    const record = projectRecord({ name: 'Brahms — Intermezzo', duration });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });
    const view = render(<Player autosave={autosave} controller={controller} />);
    await waitForPlayerSettled();
    return { ...view, controller, storage, autosave };
  }

  it('plays the canonical URL through the YouTube arm of the seam', async () => {
    const { controller, storage } = await renderYouTubePlayer();

    const options = youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]);
    expect(options.url).toBe(CANONICAL);
    expect(options.container).toHaveClass('player-ruler');
    storage.close();
  });

  it('shows the browsable-but-muted error card when the video cannot play', async () => {
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 0, error: new YouTubePlaybackError(150) })),
    });
    const record = projectRecord({ duration: 0 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} />);

    const card = await screen.findByRole('alert');
    expect(card).toHaveTextContent(/couldn’t be played/i);
    const link = within(card).getByRole('link', { name: CANONICAL });
    expect(link).toHaveAttribute('href', CANONICAL);
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

    render(<Player autosave={autosave} controller={controller} />);
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(load).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    // The load settled again on the success path — the root's marker, no
    // longer a lone `<main>` (the player is shell chrome now, T45).
    await waitForPlayerSettled();
    storage.close();
  });

  it('cannot add marks while the video cannot play — M is a letter jump, nothing more', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2, error: new YouTubePlaybackError(150) })),
    });
    const record = projectRecord({ duration: 604.2 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} />);
    await screen.findByRole('alert');

    await user.keyboard('m');

    // No marker named M in the fixture set, so M jumps to nothing — and
    // nothing is added: the record's two marks are untouched.
    expect(autosave.get().markers).toHaveLength(2);
    storage.close();
  });

  it('gives the timeline the full content width instead of zooming the embed off-screen', async () => {
    const { container, storage } = await renderYouTubePlayer(200);

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

    expect((container.querySelector('.player-ruler') as HTMLElement).style.width).toBe('');
    expect(wheel.defaultPrevented).toBe(false);
    storage.close();
  });

  it('persists the duration the embed reports, so the list and ruler stay honest', async () => {
    const storage = await testStorage();
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372.5 })) });
    const record = projectRecord({ duration: 0 });
    const autosave = createAutosave(record, { save: (next) => storage.projects.save(next) });

    render(<Player autosave={autosave} controller={controller} />);
    await waitForPlayerSettled();

    await waitFor(() => expect(autosave.get().duration).toBe(372.5));
    storage.close();
  });

  describe('the practice split view (T27)', () => {
    const readout = () => screen.getByRole('region', { name: 'Practice readout' });

    it('splits the view: the readout sits beside the recording', async () => {
      const { storage } = await renderYouTubePlayer();

      const split = document.querySelector('.player-practice-split') as HTMLElement;
      expect(split.querySelector('.player-video-column .player-ruler')).not.toBeNull();
      expect(split.querySelector('.player-timeline-strip')).toBeNull();
      expect(within(split).getByRole('region', { name: 'Practice readout' })).toBeInTheDocument();
      storage.close();
    });

    it('reads Start, then the passed and next markers, following seeks', async () => {
      const { controller, storage } = await renderYouTubePlayer();

      act(() => controller.emitPlayback({ duration: 200 }));

      expect(within(readout()).getByText('Start')).toBeInTheDocument();

      act(() => controller.seek(15));
      expect(within(readout()).getByText('A')).toBeInTheDocument();
      expect(within(readout()).getByText('B')).toBeInTheDocument();
      expect(within(readout()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0.5');
      expect(within(readout()).getByText('00:10')).toBeInTheDocument();
      expect(within(readout()).getByText('00:20')).toBeInTheDocument();

      act(() => controller.seek(25));
      expect(within(readout()).getByText('B')).toBeInTheDocument();
      expect(within(readout()).getByText('End')).toBeInTheDocument();
      storage.close();
    });

    it('confines the flags and playhead to the timeline strip', async () => {
      const { storage } = await renderYouTubePlayer();

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
