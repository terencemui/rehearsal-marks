import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { boxRect, stubRevealGeometry } from '../test/reveal-fixture';
import { waitForPlayerSettled } from '../test/settle-player';
import { serverProject } from '../test/server-project-fixture';
import { Player } from './Player';
// jsdom computes no layout, so the layout facts are CSS text — the narrow
// viewport and console-row tests pin them by reading the stylesheet from disk
// (vitest stubs CSS imports, raw or not, to an empty string). The shared page
// rail moved to the shell stylesheet (T44), so the rail's fact is read there.
const playerCss = readFileSync('src/ui/player.css', 'utf8');
const appCss = readFileSync('src/ui/app.css', 'utf8');
// The document is where the two faces are *requested* — the one fact about
// them that is not a stylesheet fact.
const indexHtml = readFileSync('index.html', 'utf8');

/**
 * The opening brace of every rule whose selector list names `selector`, in the
 * order the stylesheet names them.
 *
 * The selector is matched whole, at the start of a line, so a pin on
 * `.player-practice-mark` reads the base rule and not the descendant rule
 * `.player-practice-now .player-practice-mark` that follows it: the two differ
 * in exactly the declarations a pin is asking about, and a substring match
 * would merge them and pass on the wrong rule's text. Whole means the name
 * stands alone on its line — what follows it is the next comma of the selector
 * list or the rule's own brace, never more selector text — which is what lets a
 * grouped rule (the fold's focus rule groups all of its stops on one block) be
 * found the same way a rule with one selector is.
 *
 * A selector that was never written throws rather than yielding the empty
 * string. A negative pin (`expect(box).not.toContain('background:')`) would
 * otherwise pass on nothing at all, and would keep passing after the fold
 * dropped the rule entirely — the failure this reader exists to catch.
 */
function ruleOpens(stylesheet: string, selector: string): number[] {
  const needle = `\n${selector}`;
  const opens: number[] = [];
  for (let at = stylesheet.indexOf(needle); at !== -1; at = stylesheet.indexOf(needle, at + 1)) {
    const after = at + needle.length;
    if (!/^(,|[ \t]*\{)/.test(stylesheet.slice(after))) continue;
    const open = stylesheet.indexOf('{', after);
    if (open === -1) throw new Error(`Unterminated rule: ${selector}`);
    opens.push(open);
  }
  if (opens.length === 0) throw new Error(`No rule for ${selector} in the stylesheet`);
  return opens;
}

/** The declaration blocks `ruleOpens` found, joined — the text a pin matches. */
function ruleText(stylesheet: string, selector: string): string {
  return ruleOpens(stylesheet, selector)
    .map((open) => {
      const close = stylesheet.indexOf('}', open);
      if (close === -1) throw new Error(`Unterminated rule: ${selector}`);
      return stylesheet.slice(open + 1, close);
    })
    .join('\n');
}

/**
 * The whole selector list of the first rule naming `selector`, in the order the
 * stylesheet names it — so a grouped rule that lost one of its stops fails a
 * pin, rather than passing on the stops that are left.
 */
function ruleSelectors(stylesheet: string, selector: string): string[] {
  const open = ruleOpens(stylesheet, selector)[0];
  const before = stylesheet.slice(0, open);
  const start = Math.max(before.lastIndexOf('}'), before.lastIndexOf('{')) + 1;
  return before
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/**
 * The autosave every player test runs on. Save is a spy: persistence is the
 * ProjectPage's wire (createProjectSave), tested at the autosave seam and in
 * the duration tests below — the player itself just mutates and flushes.
 */
function testAutosave(record: ServerProject): { autosave: Autosave; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn(async (record: ServerProject) => record);
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

describe('Player — read-only (T50)', () => {
  it('plays a public project without writing anything — no duration stamp, no unmount flush', async () => {
    const record = serverProject({ duration: 0 });
    const { autosave, save } = testAutosave(record);
    const controller = mockController({ load: vi.fn(async () => ({ duration: 42 })) });

    const { unmount } = render(<Player autosave={autosave} controller={controller} readOnly />);
    await waitForPlayerSettled();

    // The read-only player renders and settles, but the duration the load
    // measured is never stamped into the record — nothing about a stranger's
    // project may be written by a viewer.
    expect(autosave.get().duration).toBe(0);

    // Unmount flushes the session's write in the editing player; a read-only
    // session has no write, so the save callback never fires.
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(save).not.toHaveBeenCalled();
    expect(controller.destroy).toHaveBeenCalled();
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
    // Matched loosely on purpose: the control's name carries the marker's own
    // label (`Delete marker A`), so an exact `Delete marker` matches nothing
    // however the panel changes — which is no guard at all (T66).
    expect(screen.queryByRole('button', { name: /Delete marker/ })).not.toBeInTheDocument();
    // And no correction step on any row (T71): the decks belong to the surface
    // that may change a marker, and this one may not. Matched on the shape every
    // step reads as — `−0.5s`, `+1s` — so a deck arriving under a new name is
    // still caught.
    expect(screen.queryByRole('button', { name: /^[−+][0-9.]+s$/ })).not.toBeInTheDocument();
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
    // The slot reads `A — Recap`: the mark in its own element, so the box the
    // direction rules around it (player.css) takes the whole mark, with the
    // alias running beside it outside the rule.
    const passed = region.querySelector('.player-practice-now');
    expect(passed?.textContent).toBe('A — Recap');
    expect(passed?.querySelector('.player-practice-mark')?.textContent).toBe('A');
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

  it('leaves the next slot bare where the derived label names the marks', async () => {
    // The alias belongs to the mark the playhead has *reached*; the slot for
    // the one it is heading for has always read the bare label, and T72 does
    // not change that — a naming setting decides what a mark is called, not
    // how much of the name each slot of the head shows.
    const { controller } = await renderLoadedPlayer(
      serverProject({ markers: [marker('m1', 10, ['Recap']), marker('m2', 20, ['Chorus'])] }),
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

describe('Player — the readout wears the direction (T73)', () => {
  // The readout is the smallest complete surface the practice player alone
  // renders, so the direction is established on it: the tokens here are the
  // ones every later surface of the fold consumes, and the boxed mark
  // established here is the mark they all draw.
  //
  // jsdom computes no layout, so the box the direction rules around a mark is
  // a stylesheet fact and is pinned as source text — the convention the
  // console and split tests above already use. Which mark the box is drawn on
  // is a DOM fact, though, and is asserted directly: the mark is its own
  // element, so what it holds can be read.

  it('declares the direction’s tokens once, and consumes them by name', () => {
    // The palette and the two type roles, each declared exactly once: a token
    // spelled twice is a token that can drift, and the fold's rule is that no
    // surface in scope repeats a hex value.
    const declared = [
      '--paper: #fcfcfa;',
      '--ink: #14161a;',
      '--ink-2: #5a6068;',
      '--rule: #d8dce1;',
      '--wash: #ecedef;',
      '--pencil: #1f4fa8;',
      '--editorial: #8c2f2f;',
    ];
    for (const declaration of declared) {
      expect(appCss.split(declaration)).toHaveLength(2);
    }

    // The direction's two type roles, each with the fallback stack that
    // catches a face which never arrives.
    expect(appCss).toContain("--serif: 'Source Serif 4', Georgia, 'Times New Roman', serif;");
    expect(appCss).toContain("--sans: 'Public Sans', system-ui, -apple-system, sans-serif;");
  });

  it('requests both faces in the document, with swap and both hosts preconnected', () => {
    // A criterion of its own: the faces are *loaded*, not merely named in a font
    // stack — so the document has to ask for them. Whether the request arrives
    // is the network's business and is deliberately not asserted; the fallback
    // stack beside each face is the guarantee that nothing moves if it does not,
    // and no geometry is derived from a face, so nothing can. What is asserted
    // is that the request exists at all: delete the link and the app ships on
    // fallbacks with every other test still green.
    const fonts = indexHtml.match(
      /<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/,
    )?.[1];
    expect(fonts).toBeDefined();
    const request = new URL(fonts!);
    const families = request.searchParams.getAll('family').join(' & ');
    expect(families).toContain('Public Sans');
    expect(families).toContain('Source Serif 4');
    // Swap, so an unarrived face never holds its text invisible while it loads.
    expect(request.searchParams.get('display')).toBe('swap');
    // Both hosts are preconnected — the stylesheet's, then the second origin
    // the face files themselves come from.
    expect(indexHtml).toContain('<link rel="preconnect" href="https://fonts.googleapis.com" />');
    expect(indexHtml).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
  });

  it('boxes the passed mark, filled, with the mark knocked out', () => {
    // The direction's signature, and the only place it spends boldness: the
    // mark the playhead has passed sits in a box ruled in the pencil and
    // filled with it, the mark showing in the sheet's paper.
    const box = ruleText(playerCss, '.player-practice-now .player-practice-mark');
    expect(box).toContain('border: 2px solid var(--pencil);');
    expect(box).toContain('background: var(--pencil);');
    expect(box).toContain('color: var(--paper);');
  });

  it('boxes the mark still ahead as a hollow box in ink', () => {
    // The two states are told apart without reading, which is the difference
    // a score draws: passed filled, ahead hollow. The box is drawn on the mark
    // element alone — the alias runs beside it, outside the rule, because a
    // score boxes the mark, not the name.
    const box = ruleText(playerCss, '.player-practice-mark');
    expect(box).toContain('border: 1.5px solid var(--ink);');
    expect(box).not.toContain('background:');
  });

  it('leaves Start and End unboxed — they name boundaries, not marks', async () => {
    // A boundary takes no box, and no box can be drawn for one: the component
    // emits no mark element in a placeholder slot, so there is nothing for the
    // box rule to match. That is a DOM fact and is read as one — a pin on an
    // absent modifier rule would pass on nothing at all.
    const { controller } = await renderLoadedPlayer(
      serverProject({ markers: [marker('m1', 10, ['Recap']), marker('m2', 20)] }),
    );

    // Before the first mark: the passed slot reads Start, and the one ahead is
    // a real mark, so exactly one box is drawn.
    act(() => controller.emitPlayback({ currentTime: 4 }));
    const readout = () => screen.getByRole('region', { name: 'Practice readout' });
    const now = readout().querySelector('.player-practice-now');
    expect(now?.textContent).toBe('Start');
    expect(now?.querySelector('.player-practice-mark')).toBeNull();
    expect(readout().querySelectorAll('.player-practice-mark')).toHaveLength(1);
    expect(now?.className).toContain('practice-placeholder');

    // After the last mark: the passed slot is a real mark and the next slot
    // reads End, so again exactly one box is drawn — now the filled one.
    act(() => controller.emitPlayback({ currentTime: 25, duration: 40 }));
    const next = readout().querySelector('.player-practice-next');
    expect(next?.textContent).toBe('End');
    expect(next?.querySelector('.player-practice-mark')).toBeNull();
    expect(readout().querySelector('.player-practice-now .player-practice-mark')).not.toBeNull();

    // Start is named in the display type's own rule, so it has to be taken out
    // of that weight by a rule of its own — this one is load-bearing. End needs
    // none: the next slot's base rule is already the body weight in the
    // secondary ink, which is what a boundary reads in.
    const start = ruleText(playerCss, '.player-practice-now.practice-placeholder');
    expect(start).toContain('font-weight: 400;');
    expect(start).toContain('color: var(--ink-2);');
    expect(() => ruleText(playerCss, '.player-practice-next.practice-placeholder')).toThrow();
    expect(ruleText(playerCss, '.player-practice-next')).toContain('font: 400 24px/1.6 var(--serif);');
  });

  it('boxes a mark of more than one character whole', async () => {
    // A movement past 26 marks letters Z, AA, AB (bijective base-26) and a
    // numbered score counts 1, 2, … 12, so a mark is not one character. The
    // box takes the whole mark: it is drawn on the mark's own element, not on
    // a `::first-letter`, which reaches only the first character and would
    // draw `A` boxed with the last `A` beside it — a different mark.
    //
    // 27 markers carry the labels of a movement past Z: the 27th is `AA`.
    const markers = Array.from({ length: 27 }, (_, index) =>
      marker(`m${index}`, 10 + index * 10),
    );
    const { controller } = await renderLoadedPlayer(serverProject({ markers, duration: 400 }));
    const region = screen.getByRole('region', { name: 'Practice readout' });
    const boxed = (slot: string) => region.querySelector(`${slot} .player-practice-mark`)?.textContent;

    act(() => controller.emitPlayback({ currentTime: 15 }));
    expect(boxed('.player-practice-now')).toBe('A');

    // Just past the 26th mark: the one ahead is the 27th, and its label is two
    // characters, so the hollow box is the one being tested here.
    act(() => controller.emitPlayback({ currentTime: 265 }));
    expect(boxed('.player-practice-next')).toBe('AA');

    // Past it, the whole two-character mark sits in the filled box.
    act(() => controller.emitPlayback({ currentTime: 275 }));
    expect(boxed('.player-practice-now')).toBe('AA');
  });

  it('sets the readout in the two type roles of the direction', () => {
    // Content is the document's: the headline, the next mark and the anchor
    // times all read in the engraving serif, and the headline is display
    // size — the readout is legible from a stand at arm's length.
    expect(ruleText(playerCss, '.player-practice-now')).toContain('font: 600 48px/1.45 var(--serif);');
    expect(ruleText(playerCss, '.player-practice-next')).toContain('font: 400 24px/1.6 var(--serif);');
    expect(ruleText(playerCss, '.player-practice-times')).toContain('font-family: var(--serif);');
  });

  it('squares the readout’s bar and draws the passed run in pencil', () => {
    // No rounded corner, tinted band or teal accent survives on the readout:
    // the track is squared and ruled in the sheet's own rule colour, and what
    // the playhead has passed is pencilled rather than tealed.
    const track = ruleText(playerCss, '.player-practice-bar');
    expect(track).toContain('border-radius: 0;');
    expect(track).toContain('background: var(--wash);');
    expect(ruleText(playerCss, '.player-practice-bar-fill')).toContain('background: var(--pencil);');
    // The readout's own rules carry no literal colour at all — every ink and
    // rule on it is a token.
    const readoutRules = playerCss.slice(
      playerCss.indexOf('.player-practice-readout {'),
      playerCss.indexOf('.player-timeline-bar {'),
    );
    expect(readoutRules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('refuses to read a rule whose selector was never written', () => {
    // The reader above is only as good as this: a pin on a rule the fold
    // dropped must fail loudly rather than read as empty text a negative pin
    // would pass on, and the reader must not settle for a rule that merely
    // contains the selector.
    expect(() => ruleText(playerCss, '.player-practice-not-a-rule')).toThrow(
      'No rule for .player-practice-not-a-rule',
    );
    expect(() => ruleText(playerCss, 'player-practice-mark')).toThrow();
    expect(ruleText(playerCss, '.player-practice-bar')).not.toBe('');
  });
});

/** The first of the focus rule's stops — the selector the rule is read by. */
const FOCUS_STOP = '.practice-surface .player-marker-list .player-marker-row:focus-visible';

describe('Player — the surface wears the direction (T77)', () => {
  // The ground and the band. The surface both player routes render is the same
  // surface the markings page hosts (T55), so the fold needs one thing to key
  // on, and it is the distinction the two hosts already carry: a practice
  // surface is on the page, or it is not. The markup says so once
  // (RecordingSurface), and every rule here hangs off it — which is why the
  // Markings page's own pins are the other half of the claim and are left
  // untouched.

  /**
   * Every rule this ticket adds, as its declarations — the surface's own text,
   * read for the two negative claims below (no literal ink, nothing that
   * moves). Rules are named here rather than sliced out of the file by offset,
   * so a rule that was dropped fails the reader instead of quietly leaving the
   * slice short. The focus rule is read like the rest: the reader above finds a
   * grouped rule by any of its stops, so none of this text lives twice.
   */
  function surfaceRules(): string[] {
    return [
      ruleText(playerCss, 'body:has(.practice-surface)'),
      ruleText(playerCss, '.practice-surface .player-title'),
      ruleText(playerCss, '.practice-surface .player-youtube-error'),
      ruleText(playerCss, '.practice-surface .player-youtube-error a'),
      ruleText(playerCss, '.practice-surface .player-youtube-error button'),
      ruleText(playerCss, FOCUS_STOP),
    ];
  }

  it('marks the practice surface, and only the practice surface', async () => {
    // The class is the fold's one hook: the band, the failure card and the
    // ground all hang off it, and the markings page — which renders this same
    // surface — must carry none of them (its own pins are that claim's other
    // half; App.test.tsx drives the three routes).
    const { container } = await renderLoadedPlayer();

    const surface = container.querySelector('.practice-surface');
    expect(surface).not.toBeNull();
    // The band and the recording are inside the marked subtree, not beside it:
    // a class on a sibling would leave the rules matching nothing.
    expect(surface?.querySelector('.player-title')).not.toBeNull();
    expect(surface?.querySelector('.player-practice-split')).not.toBeNull();
  });

  it('grounds the page in the sheet, while a practice surface is on it', () => {
    // The ground belongs to the page and not to the surface's box: the rail's
    // side padding, the page's own padding and the navbar's strip — which is
    // transparent (navbar.css), so the body's ground shows through it — are all
    // the one sheet. So the rule is the page's, keyed on the surface's presence
    // rather than on a document attribute: the prototype set one
    // (`data-direction`) and the fold ships no such thing.
    expect(ruleText(playerCss, 'body:has(.practice-surface)')).toContain(
      'background: var(--paper);',
    );
  });

  it('sets the project’s name in the document’s face over a heavy rule', () => {
    // The page opens like a part and not like a dashboard: the name is content,
    // so it takes the document's face, and the band under it is the one rule on
    // the page drawn heavy rather than hairline — 2px of ink, where every other
    // rule on the surface is 1px of the sheet's own rule colour.
    const band = ruleText(playerCss, '.practice-surface .player-title');
    expect(band).toContain('font: 600 27px/1.12 var(--serif);');
    expect(band).toContain('letter-spacing: -0.015em;');
    expect(band).toContain('color: var(--ink);');
    expect(band).toContain('padding-bottom: 14px;');
    expect(band).toContain('border-bottom: 2px solid var(--ink);');
  });

  it('draws the failure card as an editorial note in the alert colour', () => {
    // The recording's own failure is the document's business too: a note in the
    // direction's alert red, squared and un-filled, rather than the rounded
    // pink alert it has been. Its copy is chrome rather than content, so it
    // takes the chrome face.
    const card = ruleText(playerCss, '.practice-surface .player-youtube-error');
    expect(card).toContain('border: 1px solid var(--editorial);');
    expect(card).toContain('border-radius: 0;');
    expect(card).toContain('background: none;');
    expect(card).toContain('color: var(--editorial);');
    expect(card).toContain('font-family: var(--sans);');

    // The way out keeps the card's ink — the URL and the retry are the card's
    // own contents, not a second surface — and the retry is squared and ruled
    // in it rather than left a rounded button in an inherited grey.
    expect(ruleText(playerCss, '.practice-surface .player-youtube-error a')).toContain(
      'color: var(--editorial);',
    );
    const retry = ruleText(playerCss, '.practice-surface .player-youtube-error button');
    expect(retry).toContain('border: 1px solid currentColor;');
    expect(retry).toContain('border-radius: 0;');
    expect(retry).toContain('color: inherit;');
  });

  it('still offers its way out when the recording cannot play', async () => {
    // The card is restyled, not emptied: the URL stays reachable and Retry
    // still re-runs the load, so a video that comes back recovers without the
    // project being rebuilt. Asserted as behaviour because that is what the
    // styling could silently cost — a `display: none` on the way out would
    // leave every stylesheet pin above still green.
    const controller = mockController({
      load: vi.fn(async () => {
        throw new Error('media element failed');
      }),
    });
    const record = serverProject();
    const { autosave } = testAutosave(record);

    render(<Player autosave={autosave} controller={controller} />);

    const card = await screen.findByRole('alert');
    expect(within(card).getByRole('link')).toHaveAttribute(
      'href',
      canonicalYouTubeUrl(record.videoId),
    );
    expect(within(card).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('draws focus as an inset pencil rule, never the browser’s glow', () => {
    // Every stop is keyed on the fold's one hook, and that keying is the claim
    // this test is really making. One of the names in the list is not the
    // player's alone: the leading group's divider is a `player-movement-header`
    // on the authoring page too (MarkersPanel draws it for both panels), and it
    // is harmless there only while it stays an unfocusable `aria-hidden` div. A
    // bare selector would put a pencil rule on the Markings page the day that
    // div became a button — so the list is pinned whole, and every line of it
    // has to carry the class. Inset, because the rule is drawn inside the
    // control it marks rather than ringing it; the declarations are read out of
    // the stylesheet like every other rule on the surface.
    const focus = ruleText(playerCss, FOCUS_STOP);
    expect(focus).toContain('outline: 2px solid var(--pencil);');
    expect(focus).toContain('outline-offset: -2px;');
    expect(ruleSelectors(playerCss, FOCUS_STOP)).toEqual([
      FOCUS_STOP,
      '.practice-surface .player-movement-header:focus-visible',
      '.practice-surface .player-markings-open:focus-visible',
      '.practice-surface .player-youtube-error button:focus-visible',
    ]);
  });

  it('adds no transition, animation or reveal', () => {
    // A reader who has asked for reduced motion is owed this much: the fold is
    // a restyle, and nothing on it may move on its own. The claim is about the
    // rules this ticket adds — every one of them, so a motion arriving under a
    // selector the list above forgot still fails here.
    for (const body of surfaceRules()) {
      expect(body).not.toMatch(/transition|animation/i);
    }
  });

  it('spends no literal hex or colour function on the surface — every ink is a token', () => {
    // The tokens are declared once in the shell (app.css) and consumed by name
    // here. A hex or a colour function in one of these rules is a value that can
    // drift from the direction without any other test noticing — which is all
    // the two spellings the check names. (A colour's name is a third way to
    // spend one, and is not what this looks for.)
    for (const body of surfaceRules()) {
      expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    }
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


/** The markers list, its rows' `<li>`s, and the movement header `<li>`. */
function markerListParts(container: HTMLElement) {
  const list = container.querySelector('.player-marker-list') as HTMLElement;
  const rows = markerRows(container).map((button) => button.closest('li') as HTMLElement);
  const movement = list.querySelector('.player-marker-movement') as HTMLElement;
  return { list, rows, movement };
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

  it('lists the markers — label — alias on the left, timestamp on the right — and highlights the passed row', async () => {
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
    expect(rows[0].closest('li')).not.toHaveClass('passed');
    expect(rows[1].closest('li')).not.toHaveClass('passed');

    act(() => controller.emitPlayback({ currentTime: 15 }));
    expect(rows[0].closest('li')).toHaveClass('passed');
    expect(rows[1].closest('li')).not.toHaveClass('passed');

    act(() => controller.emitPlayback({ currentTime: 25 }));
    expect(rows[1].closest('li')).toHaveClass('passed');
  });

  it('names the marks by measure — the alias alone — when the project is kept that way', async () => {
    // A score that boxes bar numbers: the owner writes `17` and `42` as the
    // aliases, and the derived letters never name those marks at all.
    const { container, controller } = await renderLoadedPlayer(
      serverProject({
        naming: 'measures',
        markers: [marker('m1', 10, ['17']), marker('m2', 20, ['42'])],
      }),
    );

    const rows = markerRows(container);
    expect(rows[0].querySelector('.player-marker-title')!.textContent).toBe('17');
    expect(rows[1].querySelector('.player-marker-title')!.textContent).toBe('42');

    // The practice readout names them the same way, both slots.
    act(() => controller.emitPlayback({ currentTime: 15 }));
    const region = screen.getByRole('region', { name: 'Practice readout' });
    expect(within(region).getByText('17')).toBeInTheDocument();
    expect(within(region).getByText('42')).toBeInTheDocument();
  });

  it('names the marks by number — 1, 2 — when the project counts rather than letters', async () => {
    const { container } = await renderLoadedPlayer(
      serverProject({
        naming: 'numbers',
        markers: [marker('m1', 10, ['Recap']), marker('m2', 20)],
      }),
    );

    const rows = markerRows(container);
    expect(rows[0].querySelector('.player-marker-title')!.textContent).toBe('1 — Recap');
    expect(rows[1].querySelector('.player-marker-title')!.textContent).toBe('2');
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

  it('retires the zoom machinery: no scroll shell, no content-width fit', async () => {
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
    const sideColumn = container.querySelector('.player-side-column') as HTMLElement;
    // The split's height is driven by whichever column is taller, so a column
    // growing beneath the other doesn't move the split — and the measure
    // wouldn't re-run. On first paint the embed's host is empty (the video
    // column is short and the cap falls back to the stylesheet); the column
    // grows to its 16:9 when the embed renders, and the side column grows as a
    // passed alias wraps or a mark is added. Each must be observed for the cap
    // to land. The side column is observed whole rather than by its readout:
    // the markings page (T55) shares the surface and has no readout, so the
    // column is the thing that is always there to grow.
    const observed = getObservedTargets();
    expect(observed).toContain(videoColumn);
    expect(observed).toContain(sideColumn);
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
    expect(playerCss).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--player-side-column\);/);
    expect(playerCss).toMatch(/\.player-video-column\s*\{\s*min-width:\s*0;/);
    expect(playerCss).toMatch(/\.player-side-column\s*\{\s*min-width:\s*0;/);
  });

  it('derives a player page rail from the window height, so the recording fits the fold', () => {
    // The player's rail escapes the text pages' 1600px reading measure: it is
    // as wide as the split's 16:9 video may be without outgrowing the window.
    // The cap is only exact while the side column is the SAME expression in
    // the cap and in the split's track — which is why it is one custom
    // property read in both files rather than two literals — so pin the
    // property, both of its consumers, and the height the cap spends.
    expect(appCss).toMatch(/--player-side-column:\s*clamp\(280px,\s*26vw,\s*26rem\);/);
    expect(playerCss).toMatch(/grid-template-columns:[^;]*var\(--player-side-column\);/);
    expect(playerCss).toMatch(/gap:\s*var\(--player-gap\);/);
    // Structural rather than one exact regex: the calc is a wrapped
    // multi-line expression, and pinning its whitespace would break on any
    // reformat without catching anything real.
    const wideRail = appCss.match(/\.page-rail-wide\s*\{[^}]*\}/)?.[0] ?? '';
    expect(wideRail).toContain('100vh');
    expect(wideRail).toContain('var(--player-chrome)');
    expect(wideRail).toContain('var(--player-side-column)');
    expect(wideRail).toContain('var(--player-gap)');
    // The rail's height bound has no reader once the split stacks — the video
    // is full width there — so the cap lifts at the split's own breakpoint.
    expect(appCss).toMatch(
      /@media \(max-width: 920px\) \{\s*\.page-rail-wide\s*\{\s*max-width:\s*none;/,
    );
  });
});

describe('Player — the markers panel follows the playhead', () => {
  // Only the grace-period tests fake timers, and the player's own async load
  // must settle on real ones first — so they install them after rendering and
  // this puts the clock back for whatever runs next.
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Three markers inside one movement, so the list has a sticky header above
   * the rows and enough length for a jump to land off-band. The header's own
   * box is a stub the tests set where the inset matters.
   */
  function revealRecord() {
    return serverProject({
      markers: [marker('m1', 10), marker('m2', 20), marker('m3', 30)],
      movements: [{ id: 'mv1', name: 'I. Allegro', start: 5 }],
    });
  }

  it('brings the row a jump landed on to the top of the list', async () => {
    const { container } = await renderLoadedPlayer(revealRecord());
    const { list, rows } = markerListParts(container);
    // The third row sits 400px below the list's top edge.
    stubRevealGeometry(list, rows[2], {
      scrollTop: 0,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 500,
      rowBottom: 530,
    });

    fireEvent.click(markerRows(container)[2]);

    // To the top, not merely into view: landing a row at the band's bottom
    // edge is the one place the reader can least see what comes next.
    expect(list.scrollTop).toBe(400);
  });

  it('scrolls past a row’s own sticky header, not just to the list’s edge', async () => {
    const { container } = await renderLoadedPlayer(revealRecord());
    const { list, rows, movement } = markerListParts(container);
    // The row is inside the list's rect, but behind the 35px movement header
    // pinned over its top — so the band it must be brought to the top of
    // starts lower. Without the inset the answer would be 220, which leaves
    // the row hidden behind that header; the 35px is what makes this
    // assertion discriminate.
    Object.defineProperty(movement, 'getBoundingClientRect', {
      value: () => boxRect({ height: 35 }),
    });
    stubRevealGeometry(list, rows[0], {
      scrollTop: 200,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 120,
      rowBottom: 150,
    });

    fireEvent.click(markerRows(container)[0]);

    expect(list.scrollTop).toBe(185);
  });

  it('brings a row that is already in view to the top too', async () => {
    const { container } = await renderLoadedPlayer(revealRecord());
    const { list, rows } = markerListParts(container);
    stubRevealGeometry(list, rows[0], {
      scrollTop: 200,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 300,
      rowBottom: 330,
    });

    fireEvent.click(markerRows(container)[0]);

    // Not "already visible, leave it": a reveal to the top, so the row 100px
    // into the band moves to its first line. The shortest-distance rule the
    // old reveal used would have answered 200 here.
    expect(list.scrollTop).toBe(400);
  });

  it('follows the playhead — a seek in the embedded player is not a jump this app sees', async () => {
    const { container, controller } = await renderLoadedPlayer(revealRecord());
    const { list, rows } = markerListParts(container);
    stubRevealGeometry(list, rows[2], {
      scrollTop: 0,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 500,
      rowBottom: 530,
    });

    // The playhead moves to the last marker with no click and no keypress —
    // which is exactly what a seek made on the YouTube embed's own controls
    // looks like from in here (its poll reports a new currentTime and nothing
    // else). The row highlights, and the panel follows it.
    act(() => controller.emitPlayback({ currentTime: 30 }));

    expect(rows[2].className).toBe('passed');
    expect(list.scrollTop).toBe(400);
  });

  it('reveals on an arrow-key jump too', async () => {
    const { container } = await renderLoadedPlayer(revealRecord());
    const { list, rows, movement } = markerListParts(container);
    // The arrow keys are the one jump surface that is not a React event — the
    // listener is on the window — so this covers the path end-to-end, from the
    // key through the store to the row the jump reached.
    Object.defineProperty(movement, 'getBoundingClientRect', {
      value: () => boxRect({ height: 35 }),
    });
    stubRevealGeometry(list, rows[0], {
      scrollTop: 0,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 500,
      rowBottom: 530,
    });

    // ↓ walks from the playhead at 0 to the first marker, at 10s.
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    expect(rows[0].className).toBe('passed');
    // 500 − (100 + 35): the row, at the top of the band the header leaves.
    expect(list.scrollTop).toBe(365);
  });

  it('holds off for the grace period when the reader has scrolled the list', async () => {
    const { container } = await renderLoadedPlayer(revealRecord());
    const { list, rows } = markerListParts(container);
    stubRevealGeometry(list, rows[2], {
      scrollTop: 0,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 500,
      rowBottom: 530,
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // The reader drags the list down by hand — jsdom fires no scroll event on
    // its own, so this dispatches the one the browser would.
    list.scrollTop = 120;
    fireEvent.scroll(list);

    fireEvent.click(markerRows(container)[2]);

    // The click seeks and highlights, and the panel stays where the reader
    // put it: the list is theirs for the next few seconds.
    expect(rows[2].className).toBe('passed');
    expect(list.scrollTop).toBe(120);

    await vi.advanceTimersByTimeAsync(3000);

    // Then the reveal lands — from the position the reader left it at, on the
    // row the playhead is on by then: 120 + (500 − 100).
    expect(list.scrollTop).toBe(520);
  });

  it('leaves the list to the reader once the playhead has stopped moving', async () => {
    const { container } = await renderLoadedPlayer(revealRecord());
    const { list, rows } = markerListParts(container);
    stubRevealGeometry(list, rows[2], {
      scrollTop: 0,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 500,
      rowBottom: 530,
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    fireEvent.click(markerRows(container)[2]);
    expect(list.scrollTop).toBe(400);

    // The reader takes the list back — scrolls up to read what is ahead —
    // with the playhead sitting still on the row it just revealed.
    list.scrollTop = 120;
    fireEvent.scroll(list);

    await vi.advanceTimersByTimeAsync(10_000);

    // A scroll queues no reveal of its own: the playhead has not moved, so
    // there is nothing to follow, and the list is the reader's for as long as
    // they want it. (The grace period decides when a *pending* reveal lands,
    // not whether one is owed.)
    expect(list.scrollTop).toBe(120);
  });

  it('restarts the grace period when the reader scrolls again while one is waiting', async () => {
    const { container } = await renderLoadedPlayer(revealRecord());
    const { list, rows } = markerListParts(container);
    stubRevealGeometry(list, rows[2], {
      scrollTop: 0,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 500,
      rowBottom: 530,
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    list.scrollTop = 120;
    fireEvent.scroll(list);
    fireEvent.click(markerRows(container)[2]);
    // The jump queued a reveal against the scroll at t=0, three seconds out.
    await vi.advanceTimersByTimeAsync(2000);
    expect(list.scrollTop).toBe(120);

    // The reader scrolls again, at t=2s. That restarts the period: the reveal
    // must not land on the deadline the *first* scroll set.
    list.scrollTop = 150;
    fireEvent.scroll(list);
    await vi.advanceTimersByTimeAsync(2000);
    expect(list.scrollTop).toBe(150);

    // t=5.5s, past the re-armed deadline: now it lands, from where the reader
    // left it — 150 + (500 − 100).
    await vi.advanceTimersByTimeAsync(1500);
    expect(list.scrollTop).toBe(550);
  });

  it('keeps the list’s scrolling instant, which is what makes its own echo detectable', () => {
    // The panel tells its own writes from the reader's by comparing the
    // position a scroll event reports against the one it last wrote, which
    // only works while the assignment lands in a single step. A
    // `scroll-behavior: smooth` on this list would animate it and deliver a
    // stream of events at positions the panel never wrote — each one reading
    // as a hand scroll and starting a grace period. jsdom animates nothing, so
    // the fact is pinned as CSS text.
    const listRule = playerCss.match(/\.player-marker-list\s*\{[^}]*\}/)?.[0] ?? '';
    expect(listRule).not.toBe('');
    expect(listRule).not.toContain('scroll-behavior: smooth');
  });

  it('does not mistake its own scroll for the reader’s', async () => {
    const { container } = await renderLoadedPlayer(revealRecord());
    const { list, rows } = markerListParts(container);
    // One rect per row, so a second jump moves the list and the assertion can
    // see whether it moved at once. Each call also resets the list, so the
    // last one owns the position the test starts from.
    stubRevealGeometry(list, rows[0], {
      scrollTop: 0,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 100,
      rowBottom: 130,
    });
    stubRevealGeometry(list, rows[1], {
      scrollTop: 0,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 300,
      rowBottom: 330,
    });
    stubRevealGeometry(list, rows[2], {
      scrollTop: 0,
      clientHeight: 320,
      scrollHeight: 1000,
      listTop: 100,
      listBottom: 420,
      rowTop: 500,
      rowBottom: 530,
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    fireEvent.click(markerRows(container)[2]);
    expect(list.scrollTop).toBe(400);

    // The echo: the browser reports the panel's own write back as a scroll
    // event. Counting that as the reader would put the next reveal on a
    // three-second timer.
    fireEvent.scroll(list);

    fireEvent.click(markerRows(container)[1]);

    // Immediately, with no timers advanced: 400 + (300 − 100).
    expect(list.scrollTop).toBe(600);
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
