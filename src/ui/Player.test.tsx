import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LoadOptions, LoadResult } from '../audio';
import { YouTubePlaybackError } from '../audio/errors';
import { canonicalYouTubeUrl } from '../domain';
import { createAutosave, createProjectSave } from '../projects/autosave';
import type { Autosave } from '../projects/autosave';
import type { ServerProject } from '../projects/types';
import { fakeProjectsApi } from '../test/projects-fixture';
import { mockController } from '../test/controller-fixture';
import { marker } from '../test/marker-fixture';
import { fireResizeObservers, getObservedTargets } from '../test/resize-observer';
import { waitForPlayerSettled } from '../test/settle-player';
import { serverProject } from '../test/server-project-fixture';
import { Player } from './Player';
// jsdom computes no layout, so the layout facts are CSS text — the narrow
// viewport and console-row tests pin them by reading the stylesheet from disk
// (vitest stubs CSS imports, raw or not, to an empty string). The shared page
// rail moved to the shell stylesheet (T44), so the rail's fact is read there.
const playerCss = readFileSync('src/ui/player.css', 'utf8');
const appCss = readFileSync('src/ui/app.css', 'utf8');

/**
 * The autosave every player test runs on. Save is a spy: persistence is the
 * ProjectPage's wire (createProjectSave), tested at the autosave seam and in
 * the duration tests below — the player itself just mutates and flushes.
 */
function testAutosave(record: ServerProject): { autosave: Autosave; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn(async () => {});
  const autosave = createAutosave(record, { save });
  return { autosave, save };
}

/**
 * Renders a loaded player whose load result matches the record's duration —
 * the same render the marking tests use, surfaced with the autosave handle
 * for the tests that only need the controller and the view.
 */
async function renderLoadedPlayer(record = serverProject()) {
  const { autosave, ...rest } = await renderSettledPlayer(record);
  return { ...rest, autosave };
}

describe('Player', () => {
  it('loads the canonical URL through the controller and shows the project name', async () => {
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 123.456 })),
    });
    const record = serverProject();
    const { autosave } = testAutosave(record);

    render(<Player autosave={autosave} controller={controller} />);

    expect(screen.getByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();

    expect(controller.load).toHaveBeenCalledTimes(1);
    const options = youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]);
    expect(options.url).toBe(canonicalYouTubeUrl(record.videoId));
    expect(options.container).toBeInstanceOf(HTMLDivElement);
    expect(document.body.contains(options.container)).toBe(true);
    // Settle the async load inside act before the test ends.
    await waitForPlayerSettled();
  });

  it('carries no navigation of its own — the shell’s navbar is the only chrome (T45)', async () => {
    const record = serverProject();
    const { autosave } = testAutosave(record);

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
  });

  it('keeps the media duration learned from the load in memory, never persisting it', async () => {
    // The duration stamp is the player's only in-session mutation, and it is
    // in-memory only (T51): the server never persists it, so the flush's save
    // wire — a change nothing the server can write — is skipped, and a
    // published public project is never PATCHed back to review over it.
    const api = fakeProjectsApi();
    const record = serverProject({ duration: 0 });
    const autosave = createAutosave(record, { save: createProjectSave(api, record) });
    const controller = mockController({ load: vi.fn(async () => ({ duration: 42 })) });

    const { unmount } = render(<Player autosave={autosave} controller={controller} />);
    await waitForPlayerSettled();
    expect(autosave.get().duration).toBe(42);
    unmount();

    await waitFor(() => expect(api.saveProject).not.toHaveBeenCalled());
    expect(controller.destroy).toHaveBeenCalled();
  });

  it('shows the failure card when loading rejects', async () => {
    const controller = mockController({
      load: vi.fn(async () => {
        throw new Error('media element failed');
      }),
    });
    const record = serverProject();
    const { autosave } = testAutosave(record);

    render(<Player autosave={autosave} controller={controller} />);

    const card = await screen.findByRole('alert');
    expect(card).toHaveTextContent(/couldn’t be played/i);
    // There is no transport left to disable, and no precision note to lie
    // beside the card.
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Playing from YouTube/)).not.toBeInTheDocument();
  });

  it('does not mutate over sub-millisecond duration noise — nothing to save', async () => {
    const record = serverProject();
    const { autosave, save } = testAutosave(record);
    const controller = mockController({ load: vi.fn(async () => ({ duration: 123.4560004 })) });

    const { unmount } = render(<Player autosave={autosave} controller={controller} />);
    await waitForPlayerSettled();
    await new Promise((resolve) => setTimeout(resolve, 600));

    // The noise is below the stamp's epsilon, so no mutation ever fires — and
    // a flush has nothing to write.
    expect(autosave.get().duration).toBe(123.456);
    unmount();
    await waitFor(() => expect(save).not.toHaveBeenCalled());
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
    // The marker rows themselves survive — they are the navigable map of the marks.
    expect(markerRows(container)).toHaveLength(2);
  });

  it('renders no save-status line and no explanatory note', async () => {
    await renderLoadedPlayer();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Playing from YouTube/)).not.toBeInTheDocument();
  });

  it('grows the timeline fill with playback time', async () => {
    const { controller, container } = await renderLoadedPlayer();
    const fill = container.querySelector('.player-timeline-fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('0%');

    act(() => controller.emitPlayback({ currentTime: 5, duration: 10 }));
    expect(fill.style.width).toBe('50%');

    act(() => controller.emitPlayback({ currentTime: 15 }));
    expect(fill.style.width).toBe('100%');
  });

  it('toggles with Space, except while a button has focus', async () => {
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 0, error: new YouTubePlaybackError(150) })),
    });
    const record = serverProject();
    const { autosave } = testAutosave(record);
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
      serverProject({ markers: [marker('m1', 10, ['Recap']), marker('m2', 20)] }),
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

    const bar = within(readout()).getByRole('slider', { name: /Progress to/ });
    expect(bar).toHaveAttribute('aria-valuenow', '0.5');
    expect(bar.querySelector('.player-practice-bar-fill')).toHaveStyle({ width: '50%' });
  });

  it('seeks within the anchor span when the bar is clicked', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    // Between A (10s) and B (20s): a click at a quarter of the bar's width
    // lands a quarter of the way through that span.
    const bar = within(readout()).getByRole('slider', { name: /Progress to/ }) as HTMLElement;
    Object.defineProperty(bar, 'getBoundingClientRect', {
      value: () => boxRect({ width: 200 }),
    });
    fireEvent.click(bar, { clientX: 50 });

    expect(controller.seek).toHaveBeenLastCalledWith(12.5);
  });

  it('seeks within the run-up to the first mark when the bar is clicked', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 4 }));

    // Start (0s) to A (10s): a click halfway across the bar lands at 5s.
    const bar = within(readout()).getByRole('slider', { name: /Progress to/ }) as HTMLElement;
    Object.defineProperty(bar, 'getBoundingClientRect', {
      value: () => boxRect({ width: 200 }),
    });
    fireEvent.click(bar, { clientX: 100 });

    expect(controller.seek).toHaveBeenLastCalledWith(5);
  });

  it('seeks within the run from the last mark to the end when the bar is clicked', async () => {
    const { controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 25 }));

    // B (20s) to End (the recording's duration): a click halfway across the
    // bar lands halfway through that closing span.
    const bar = within(readout()).getByRole('slider', { name: /Progress to/ }) as HTMLElement;
    Object.defineProperty(bar, 'getBoundingClientRect', {
      value: () => boxRect({ width: 200 }),
    });
    fireEvent.click(bar, { clientX: 100 });

    expect(controller.seek).toHaveBeenLastCalledWith(20 + (RECORD_SECONDS - 20) / 2);
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

  it('orders the head so the passed marker leads the next — the layout basis', async () => {
    // jsdom computes no flex, so this pins the source order the metro head's
    // left/right arrangement rests on — the nearest observable proxy for
    // "passed marker left, next marker right". The CSS realizes the layout.
    const { controller } = await renderLoadedPlayer(
      serverProject({ markers: [marker('m1', 10, ['Recap']), marker('m2', 20)] }),
    );
    act(() => controller.emitPlayback({ currentTime: 15 }));

    const head = readout().querySelector('.player-practice-head');
    expect(
      Array.from((head as HTMLElement).children).map((element) => element.textContent),
    ).toEqual(['A — Recap', 'B']);
  });

  it('spreads the head as a flex row, the now shrinkable and the next flush right', () => {
    // jsdom computes no flex, so pin the CSS rules that realize the row: the
    // head spreads its two values baseline-aligned, the now column shrinking
    // so a long alias wraps rather than shoving the next marker off the edge.
    expect(playerCss).toMatch(
      /\.player-practice-head\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/,
    );
    expect(playerCss).toMatch(/\.player-practice-now\s*\{[^}]*min-width:\s*0;/);
    expect(playerCss).toMatch(/\.player-practice-next\s*\{[^}]*overflow-wrap:\s*anywhere;/);
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
    expect(selectedMarkerRows(container)).toHaveLength(0);
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
    const { controller } = await renderLoadedPlayer(serverProject({ markers: [] }));
    act(() => controller.emitPlayback({ currentTime: 5 }));

    expect(fireEvent.keyDown(document.body, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'ArrowUp' })).toBe(true);
    expect(controller.seek).not.toHaveBeenCalled();
  });
});

describe('Player navigation — letter keys are inert', () => {
  it('leaves letter keys alone — the A–Z jump is gone (ADR-0005)', async () => {
    const { controller } = await renderLoadedPlayer();

    // A–Z used to jump to the marker with that label — "take it from C" was
    // one keypress. With labels restarting per movement the jump became
    // ambiguous and left (ADR-0005); a letter key now does nothing to
    // playback, stays the browser's own, and never selects.
    expect(fireEvent.keyDown(document.body, { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'b' })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'M' })).toBe(true);
    expect(controller.seek).not.toHaveBeenCalled();
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
    expect(markerRows(container)).toHaveLength(2);
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
    expect(markerRows(container)).toHaveLength(2);
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
    const record = serverProject();
    const { autosave } = testAutosave(record);
    render(<Player autosave={autosave} controller={controller} />);

    // Space is gated with the rest — a press during load is not swallowed
    // against a dead embed (spec #74, story 37).
    await user.keyboard('{ArrowRight}{ArrowDown}b ');

    expect(controller.seek).not.toHaveBeenCalled();
    expect(controller.togglePlay).not.toHaveBeenCalled();
  });

  it('keeps Space meaning play/pause after a marker row click', async () => {
    const user = userEvent.setup();
    const { container, controller } = await renderLoadedPlayer();

    fireEvent.click(markerRows(container)[1]); // jump to B — a single seek, no select
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
positions the navigation, bar, and markers tests divide by. */

/** The recording's duration — the bar's fill and the seek math divide by it. */
const RECORD_SECONDS = 123.456;

/**
 * Renders a settled player — the load has resolved (success path) and its
 * playback duration matches the record. The bar is not geometry-mocked:
 * jsdom reports no layout, so a click-ratio test stubs the track for itself.
 */
async function renderSettledPlayer(record = serverProject()) {
  const controller = mockController();
  controller.load = vi.fn(async () => ({ duration: RECORD_SECONDS }));
  // Settle the mount duration before the bar draws its fill.
  controller.emitPlayback({ duration: RECORD_SECONDS });
  const { autosave } = testAutosave(record);
  const view = render(<Player autosave={autosave} controller={controller} />);
  await waitForPlayerSettled();
  return { ...view, controller, record, autosave };
}

/** The marker row buttons, in DOM order (which is time order). */
function markerRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.player-marker-row'));
}

/**
 * The rows in the selected state. Selection ceased to exist with the editing
 * tools (T39), so a player test asserting selection would expect this empty —
 * the helper exists to make that "no row is ever pressed" assertion read.
 */
function selectedMarkerRows(container: HTMLElement): HTMLElement[] {
  return markerRows(container).filter((row) => row.getAttribute('aria-pressed') === 'true');
}

/** A track-sized DOMRect — jsdom has no layout, so tests own the geometry. */
function trackRect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 10,
    width,
    height: 10,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Gives the bar's track a fixed box so clicks land at known ratios. */
function stubTrackBounds(container: HTMLElement, width: number): void {
  const track = container.querySelector('.player-timeline-track') as HTMLElement;
  Object.defineProperty(track, 'getBoundingClientRect', {
    value: () => trackRect(width),
  });
}

/** A generic box stub — jsdom has no layout, so tests own the geometry. */
function boxRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect;
}

/** Narrows a captured `load` call's options to the YouTube arm. */
function youtubeLoad(options: LoadOptions): Extract<LoadOptions, { source: 'youtube' }> {
  if (options.source !== 'youtube') throw new Error('Expected a YouTube load.');
  return options;
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

    expect(markerRows(container)).toHaveLength(2);
    expect(autosave.get().markers).toEqual(original);
    // The only effect was the seek.
    expect(controller.seek).toHaveBeenCalledTimes(1);
    expect(controller.seek).toHaveBeenLastCalledWith(10);
  });

  it('a marker row click jumps to the marker and never selects', async () => {
    const { container, controller } = await renderLoadedPlayer();

    fireEvent.click(markerRows(container)[1]); // B at 20s

    expect(controller.seek).toHaveBeenCalledWith(20);
    // Selection ceased to exist in the player: no inspector, no pressed row.
    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(markerRows(container)[1]).not.toHaveAttribute('aria-pressed');
  });
});

describe('Player — the timeline bar and markers (T38)', () => {
  it('moves the clock out of the video column into a full-width bar below the split', async () => {
    const { container } = await renderLoadedPlayer();

    const split = container.querySelector('.player-practice-split') as HTMLElement;
    const bar = container.querySelector('.player-timeline-bar') as HTMLElement;
    expect(split.nextElementSibling).toBe(bar);

    const videoColumn = split.querySelector('.player-video-column') as HTMLElement;
    expect(videoColumn.querySelector('.player-ruler')).not.toBeNull();
    expect(videoColumn.querySelector('.player-marker-row')).toBeNull();

    // The bar carries no marks and no ruler band: the marks moved to the
    // markers panel in the side column.
    expect(bar.querySelector('.rm-ruler')).toBeNull();
    expect(bar.querySelector('.player-playhead')).toBeNull();
    expect(bar.querySelectorAll('.player-marker-row')).toHaveLength(0);

    const sideColumn = split.querySelector('.player-side-column') as HTMLElement;
    expect(sideColumn.querySelector('.player-markers')).not.toBeNull();
    expect(sideColumn.querySelectorAll('.player-marker-row')).toHaveLength(2);
  });

  it('draws its seek surface from the bar’s track, clean of ticks', async () => {
    const { container } = await renderLoadedPlayer();
    const track = container.querySelector('.player-timeline-track') as HTMLElement;

    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('aria-label')).toBe('Recording timeline');
    expect(track.getAttribute('aria-valuemin')).toBe('0');
    expect(track.getAttribute('aria-valuemax')).toBe(String(RECORD_SECONDS));
    // The clean-bar decision (no marker dividers, no ticks) — the fill is the
    // only mark on the track.
    expect(track.querySelector('.rm-ruler-tick')).toBeNull();
  });

  it('sizes by percentages only — no pixel offsets, no inline widths', async () => {
    const { container } = await renderLoadedPlayer();

    // The strip's surface and marker layers are gone entirely — the bar
    // carries no surface, no marks, no playhead of its own.
    expect(container.querySelector('.player-timeline-surface')).toBeNull();
    expect(container.querySelector('.player-timeline-bar .player-marker-row')).toBeNull();
    expect(container.querySelector('.player-playhead')).toBeNull();
    expect((container.querySelector('.player-timeline-fill') as HTMLElement).style.width).toMatch(
      /%$/,
    );
  });

  it('shows the elapsed time under the left end and the duration under the right', async () => {
    const { container, controller } = await renderLoadedPlayer();
    act(() => controller.emitPlayback({ currentTime: 15 }));

    const times = container.querySelector('.player-timeline-times') as HTMLElement;
    expect(
      Array.from(times.querySelectorAll('span')).map((element) => element.textContent),
    ).toEqual(['00:15', '02:03']);
  });

  it('seeks anywhere on the bar, and a marker row click jumps without ever selecting', async () => {
    const { container, controller } = await renderLoadedPlayer();
    stubTrackBounds(container, 200);

    fireEvent.click(container.querySelector('.player-timeline-track') as HTMLElement, {
      clientX: 50,
    });
    expect(controller.seek).toHaveBeenLastCalledWith((50 / 200) * RECORD_SECONDS);

    fireEvent.click(markerRows(container)[1]);
    expect(controller.seek).toHaveBeenLastCalledWith(20);
    expect(screen.queryByRole('region', { name: 'Marker B' })).not.toBeInTheDocument();
    expect(markerRows(container)[1]).not.toHaveAttribute('aria-pressed');
  });

  it('lists the markers — label — alias on the left, timestamp on the right — and highlights the active row', async () => {
    const { container, controller } = await renderLoadedPlayer(
      serverProject({ markers: [marker('m1', 10, ['Recap']), marker('m2', 20)] }),
    );

    const rows = markerRows(container);
    expect(rows).toHaveLength(2);
    // The settled layout: the label — alias reads on the left, the timestamp
    // flush right in the shared clock column.
    expect(rows[0].querySelector('.player-marker-title')!.textContent).toBe('A — Recap');
    expect(rows[0].querySelector('.player-marker-time')!.textContent).toBe('00:10');
    expect(rows[1].querySelector('.player-marker-title')!.textContent).toBe('B');
    expect(rows[1].querySelector('.player-marker-time')!.textContent).toBe('00:20');
    expect(rows[0].closest('li')).not.toHaveClass('active');
    expect(rows[1].closest('li')).not.toHaveClass('active');

    act(() => controller.emitPlayback({ currentTime: 15 }));
    expect(rows[0].closest('li')).toHaveClass('active');
    expect(rows[1].closest('li')).not.toHaveClass('active');

    act(() => controller.emitPlayback({ currentTime: 25 }));
    expect(rows[1].closest('li')).toHaveClass('active');
  });

  it('makes marker rows pointer targets, not tab stops — the letter keys navigate', async () => {
    const { container } = await renderLoadedPlayer();
    for (const row of markerRows(container)) {
      expect(row).toHaveAttribute('tabindex', '-1');
    }
  });

  it('renders no markers panel when the recording has no marks', async () => {
    const { container } = await renderLoadedPlayer(serverProject({ markers: [] }));
    expect(container.querySelector('.player-markers')).toBeNull();
  });

  it('groups markers under sticky movement headers and seeks when a header is clicked', async () => {
    const { container, controller } = await renderLoadedPlayer(
      serverProject({
        markers: [marker('a', 10), marker('b', 500), marker('c', 900), marker('d', 1700)],
        movements: [
          { id: 'm1', name: 'I. Allegro', start: 0 },
          { id: 'm2', name: 'II. Adagio', start: 831 },
          { id: 'm3', name: 'III. Finale', start: 1620 },
        ],
      }),
    );

    const headers = Array.from(container.querySelectorAll('.player-movement-header'));
    expect(headers.map((h) => h.querySelector('.player-movement-name')!.textContent)).toEqual([
      'I. Allegro',
      'II. Adagio',
      'III. Finale',
    ]);
    // Each header carries its movement's start in the shared clock column.
    expect(headers[1].querySelector('.player-marker-time')!.textContent).toBe('13:51');

    // Labels restart at A within each movement (ADR-0005).
    const rows = markerRows(container);
    expect(rows.map((r) => r.querySelector('.player-marker-title')!.textContent)).toEqual([
      'A',
      'B',
      'A',
      'A',
    ]);

    // A movement header click jumps to the movement's start — the fold-in
    // that the prototype only sketched with a playhead.
    fireEvent.click(headers[1]);
    expect(controller.seek).toHaveBeenLastCalledWith(831);
  });

  it('renders a flat list for a record saved before movements existed — the field is absent, not empty', async () => {
    // A project read before ADR-0005 carried no movements — the parser's older
    // rows keep their markers and lose nothing else. The panel must treat the
    // absent field as the empty, ungrouped list the contract describes instead
    // of crashing the render.
    const record = serverProject({
      markers: [marker('a', 10), marker('b', 831), marker('c', 1620)],
    }) as ServerProject & { movements?: unknown };
    delete (record as { movements?: unknown }).movements;

    const { container } = await renderLoadedPlayer(record as ServerProject);

    // No movement headers — the flat, pre-movement panel.
    expect(container.querySelectorAll('.player-movement-header')).toHaveLength(0);
    const rows = markerRows(container);
    expect(rows.map((r) => r.querySelector('.player-marker-title')!.textContent)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('retires the zoom machinery: no scroll shell, no content-width fit, no reveal-on-jump', async () => {
    const { container } = await renderLoadedPlayer();

    expect(container.querySelector('.player-ruler-shell')).toBeNull();
    expect((container.querySelector('.player-ruler') as HTMLElement).style.width).toBe('');

    fireEvent.click(markerRows(container)[1]);
    expect((container.querySelector('.player-timeline-bar') as HTMLElement).scrollLeft).toBe(0);
  });

  it('renders the markers even when playback has failed', async () => {
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 0, error: new YouTubePlaybackError(150) })),
    });
    controller.emitPlayback({ duration: RECORD_SECONDS });
    const record = serverProject({ duration: RECORD_SECONDS });
    const { autosave } = testAutosave(record);

    const { container } = render(<Player autosave={autosave} controller={controller} />);
    await screen.findByRole('alert');

    // The stored duration is the failure state's clock: the bar still draws
    // its fill, and the markers panel still lists the marks.
    expect(container.querySelectorAll('.player-marker-row')).toHaveLength(2);
    expect(markerRows(container)[0].textContent).toContain('00:10');
  });

  it('caps the list at the video’s bottom, scrolling instead of outrunning it', async () => {
    const { container } = await renderLoadedPlayer();
    const list = container.querySelector('.player-marker-list') as HTMLElement;
    const videoColumn = container.querySelector('.player-video-column') as HTMLElement;

    // jsdom reports no layout, so the initial measure sees no geometry and
    // leaves the stylesheet cap in charge — until the split's size changes.
    expect(list.style.maxHeight).toBe('');

    // Simulate the side-by-side split: the video's bottom sits 500px down,
    // with the list's top at 100px — a gap that would leave 392px, past the
    // design's tallest. A resize lands, and the list is capped to the
    // stylesheet ceiling (320px), never the full gap.
    Object.defineProperty(videoColumn, 'getBoundingClientRect', {
      value: () => boxRect({ top: 0, bottom: 500, height: 500 }),
    });
    Object.defineProperty(list, 'getBoundingClientRect', {
      value: () => boxRect({ top: 100, bottom: 500, height: 400 }),
    });
    act(() => fireResizeObservers());

    expect(list.style.maxHeight).toBe('320px');
  });

  it('caps the list to the viewport when stacked below the video, so the panel fits on screen', async () => {
    const { container } = await renderLoadedPlayer();
    const list = container.querySelector('.player-marker-list') as HTMLElement;
    const videoColumn = container.querySelector('.player-video-column') as HTMLElement;

    // The stacked layout puts the list below the video — there is no video
    // bottom to stay within, so the cap is the viewport instead: the gap from
    // the list's top to the fold. jsdom's window is 768 tall, so the cap is
    // 768 − 600 − 8 = 160, keeping the panel on screen where it scrolls.
    Object.defineProperty(videoColumn, 'getBoundingClientRect', {
      value: () => boxRect({ top: 0, bottom: 300, height: 300 }),
    });
    Object.defineProperty(list, 'getBoundingClientRect', {
      value: () => boxRect({ top: 600, bottom: 900, height: 300 }),
    });
    act(() => fireResizeObservers());

    expect(list.style.maxHeight).toBe('160px');
  });

  it('floors the stacked list so a fold consumed by a full-width video never slivers it', async () => {
    const { container } = await renderLoadedPlayer();
    const list = container.querySelector('.player-marker-list') as HTMLElement;
    const videoColumn = container.querySelector('.player-video-column') as HTMLElement;

    // Just under the stacking breakpoint a full-width video fills the fold,
    // leaving the list only 40px of viewport (768 − 720 − 8) — the floor
    // keeps a usable band.
    Object.defineProperty(videoColumn, 'getBoundingClientRect', {
      value: () => boxRect({ top: 0, bottom: 700, height: 700 }),
    });
    Object.defineProperty(list, 'getBoundingClientRect', {
      value: () => boxRect({ top: 720, bottom: 900, height: 180 }),
    });
    act(() => fireResizeObservers());

    expect(list.style.maxHeight).toBe('120px');
  });

  it('never inflates the stacked list past the stylesheet cap', async () => {
    const { container } = await renderLoadedPlayer();
    const list = container.querySelector('.player-marker-list') as HTMLElement;
    const videoColumn = container.querySelector('.player-video-column') as HTMLElement;

    // A stacked layout with the list high up leaves the fold most of the
    // viewport to spare, but the panel still tops out at the stylesheet cap.
    Object.defineProperty(videoColumn, 'getBoundingClientRect', {
      value: () => boxRect({ top: 0, bottom: 200, height: 200 }),
    });
    Object.defineProperty(list, 'getBoundingClientRect', {
      value: () => boxRect({ top: 300, bottom: 620, height: 320 }),
    });
    act(() => fireResizeObservers());

    expect(list.style.maxHeight).toBe('320px');
  });

  it('observes the columns that grow without moving the split, so the cap re-measures', async () => {
    const { container } = await renderLoadedPlayer();
    const videoColumn = container.querySelector('.player-video-column') as HTMLElement;
    const readout = container.querySelector('.player-practice-readout') as HTMLElement;
    // The split's height is driven by whichever column is taller, so a column
    // growing beneath the other doesn't move the split — and the measure
    // wouldn't re-run. On first paint the embed's host is empty (the video
    // column is short and the cap falls back to the stylesheet); the column
    // grows to its 16:9 when the embed renders, and the readout grows as passed
    // aliases wrap. Each must be observed for the cap to land.
    const observed = getObservedTargets();
    expect(observed).toContain(videoColumn);
    expect(observed).toContain(readout);
  });

  it('scrolls the markers within their band, so a marker-heavy project never towers', () => {
    // jsdom cannot observe layout, so the scroll is a CSS fact — pin the rule
    // that caps the list and makes it scroll instead of growing the column.
    expect(playerCss).toMatch(
      /\.player-marker-list\s*\{[^}]*max-height:\s*320px;[^}]*overflow-y:\s*auto;/,
    );
  });

  it('keeps the page from scrolling sideways at a narrow viewport', () => {
    // jsdom cannot observe layout, so the overflow guards are CSS facts —
    // pin the rules that let the rail and the split shrink instead of forcing
    // a horizontal scrollbar: box-sizing on the shared page rail (now in the
    // shell stylesheet, app.css), minmax(0, …) columns in the split, and
    // min-width: 0 on the two columns.
    expect(appCss).toMatch(/\.page-rail\s*\{[^}]*box-sizing:\s*border-box;/);
    expect(playerCss).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1\.25fr\)\s+minmax\(0,\s*0\.75fr\);/,
    );
    expect(playerCss).toMatch(/\.player-video-column\s*\{\s*min-width:\s*0;/);
    expect(playerCss).toMatch(/\.player-side-column\s*\{\s*min-width:\s*0;/);
  });
});

describe('Player — YouTube projects', () => {
  const CANONICAL = canonicalYouTubeUrl(serverProject().videoId);

  async function renderYouTubePlayer(duration = 200) {
    const controller = mockController({ load: vi.fn(async () => ({ duration })) });
    controller.emitPlayback({ duration });
    const record = serverProject({ name: 'Brahms — Intermezzo', duration });
    const { autosave } = testAutosave(record);
    const view = render(<Player autosave={autosave} controller={controller} />);
    await waitForPlayerSettled();
    return { ...view, controller, autosave };
  }

  it('plays the canonical URL through the YouTube arm of the seam', async () => {
    const { controller } = await renderYouTubePlayer();

    const options = youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]);
    expect(options.url).toBe(CANONICAL);
    expect(options.container).toHaveClass('player-ruler');
  });

  it('shows the browsable-but-muted error card when the video cannot play', async () => {
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 0, error: new YouTubePlaybackError(150) })),
    });
    const record = serverProject({ duration: 0 });
    const { autosave } = testAutosave(record);

    render(<Player autosave={autosave} controller={controller} />);

    const card = await screen.findByRole('alert');
    expect(card).toHaveTextContent(/couldn’t be played/i);
    const link = within(card).getByRole('link', { name: CANONICAL });
    expect(link).toHaveAttribute('href', CANONICAL);
  });

  it('retries the load from the error card and clears it on success', async () => {
    const user = userEvent.setup();
    const load = vi
      .fn<() => Promise<LoadResult>>()
      .mockResolvedValueOnce({ duration: 0, error: new YouTubePlaybackError(150) })
      .mockResolvedValueOnce({ duration: 604.2 });
    const controller = mockController({ load });
    const record = serverProject({ duration: 604.2 });
    const { autosave } = testAutosave(record);

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
  });

  it('cannot add marks while the video cannot play — M is a letter jump, nothing more', async () => {
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2, error: new YouTubePlaybackError(150) })),
    });
    const record = serverProject({ duration: 604.2 });
    const { autosave } = testAutosave(record);

    render(<Player autosave={autosave} controller={controller} />);
    await screen.findByRole('alert');

    await user.keyboard('m');

    // No marker named M in the fixture set, so M jumps to nothing — and
    // nothing is added: the record's two marks are untouched.
    expect(autosave.get().markers).toHaveLength(2);
  });

  it('gives the timeline the full content width instead of zooming the embed off-screen', async () => {
    const { container } = await renderYouTubePlayer(200);

    const split = container.querySelector('.player-practice-split') as HTMLElement;
    const bar = container.querySelector('.player-timeline-bar') as HTMLElement;
    expect(split.nextElementSibling).toBe(bar);
    expect((container.querySelector('.player-ruler') as HTMLElement).style.width).toBe('');
  });

  it('leaves ctrl+scroll to the browser — there is no zoom to gesture at', async () => {
    const { container } = await renderYouTubePlayer(200);
    const bar = container.querySelector('.player-timeline-bar') as HTMLElement;

    const wheel = new WheelEvent('wheel', {
      deltaY: -300,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      bar.dispatchEvent(wheel);
    });

    expect((container.querySelector('.player-ruler') as HTMLElement).style.width).toBe('');
    expect(wheel.defaultPrevented).toBe(false);
  });

  it('keeps the embed-reported duration in memory, so the ruler stays honest', async () => {
    // The embed's duration is in-memory only (T51): it corrects the ruler's
    // timeline but never reaches the server — the save wire skips it, and a
    // published public project is never demoted over it.
    const api = fakeProjectsApi();
    const record = serverProject({ duration: 0 });
    const autosave = createAutosave(record, { save: createProjectSave(api, record) });
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372.5 })) });

    const { unmount } = render(<Player autosave={autosave} controller={controller} />);
    await waitForPlayerSettled();

    expect(autosave.get().duration).toBe(372.5);
    unmount();
    await waitFor(() => expect(api.saveProject).not.toHaveBeenCalled());
  });

  describe('the practice split view (T27)', () => {
    const readout = () => screen.getByRole('region', { name: 'Practice readout' });

    it('splits the view: the readout sits beside the recording', async () => {
      await renderYouTubePlayer();

      const split = document.querySelector('.player-practice-split') as HTMLElement;
      expect(split.querySelector('.player-video-column .player-ruler')).not.toBeNull();
      // The clock is a sibling below the split, never inside it.
      expect(split.querySelector('.player-timeline-bar')).toBeNull();
      expect(within(split).getByRole('region', { name: 'Practice readout' })).toBeInTheDocument();
    });

    it('reads Start, then the passed and next markers, following seeks', async () => {
      const { controller } = await renderYouTubePlayer();

      act(() => controller.emitPlayback({ duration: 200 }));

      expect(within(readout()).getByText('Start')).toBeInTheDocument();

      act(() => controller.seek(15));
      expect(within(readout()).getByText('A')).toBeInTheDocument();
      expect(within(readout()).getByText('B')).toBeInTheDocument();
      expect(within(readout()).getByRole('slider', { name: /Progress to/ })).toHaveAttribute(
        'aria-valuenow',
        '0.5',
      );
      expect(within(readout()).getByText('00:10')).toBeInTheDocument();
      expect(within(readout()).getByText('00:20')).toBeInTheDocument();

      act(() => controller.seek(25));
      expect(within(readout()).getByText('B')).toBeInTheDocument();
      expect(within(readout()).getByText('End')).toBeInTheDocument();
    });

    it('confines the marks to the markers panel — the bar carries none', async () => {
      await renderYouTubePlayer();

      const videoColumn = document.querySelector('.player-video-column') as HTMLElement;
      const bar = document.querySelector('.player-timeline-bar') as HTMLElement;
      const sideColumn = document.querySelector('.player-side-column') as HTMLElement;
      expect(videoColumn.querySelector('.player-marker-row')).toBeNull();
      expect(bar.querySelector('.player-marker-row')).toBeNull();
      expect(sideColumn.querySelectorAll('.player-marker-row')).toHaveLength(2);
    });
  });
});
