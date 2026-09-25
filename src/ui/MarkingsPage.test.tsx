import { readFileSync } from 'node:fs';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LoadOptions } from '../audio';
import { YouTubePlaybackError } from '../audio';
import { canonicalYouTubeUrl } from '../domain';
import type { ServerProject } from '../projects/types';
import { renderApp } from '../test/app-fixture';
import { mockAuth } from '../test/auth-fixture';
import { mockController } from '../test/controller-fixture';
import { marker } from '../test/marker-fixture';
import { fakeProjectsApi } from '../test/projects-fixture';
import { stubRevealGeometry } from '../test/reveal-fixture';
import { serverProject } from '../test/server-project-fixture';
import { waitForPlayerSettled } from '../test/settle-player';
// jsdom computes no layout, so a fact that is about sizes is a fact about the
// stylesheet — those tests read it from disk (vitest stubs CSS imports, raw or
// not, to an empty string), the way Player's narrow-viewport tests do.
const markingsCss = readFileSync('src/ui/markings.css', 'utf8');
// The panel's own width, which is what the page's rows have to fit: declared
// once, in the split's stylesheet, and read here for the row that fills it
// (T70).
const appCss = readFileSync('src/ui/app.css', 'utf8');

/**
 * The markings page (T55), driven at the app-level seam: `renderApp` serves the
 * real router and the real shell over a fake server surface, mocked audio, and
 * a mocked sign-in, so a test reaches the page at its own URL and asserts what
 * a student sees and what the server ends up holding. The highest seam the app
 * has — the page, its session, and the server surface together — and the one
 * the save-mode split will be observable at (T56).
 */

/** Narrows a captured `load` call's options to the YouTube arm. */
function youtubeLoad(options: LoadOptions): Extract<LoadOptions, { source: 'youtube' }> {
  if (options.source !== 'youtube') throw new Error('Expected a YouTube load.');
  return options;
}

/** A project with marks at 10s and 20s, and one movement starting at 15s. */
function project(overrides = {}) {
  return serverProject({
    id: 'p1',
    name: 'Brahms Op. 118 No. 2',
    duration: 372,
    markers: [marker('m1', 10), marker('m2', 20)],
    movements: [],
    ...overrides,
  });
}

/** Two movements with marks inside them — a symphony, roughly placed. */
function multiMovement(overrides = {}) {
  return project({
    visibility: 'private',
    duration: 1800,
    markers: [marker('m1', 10), marker('m2', 20), marker('m3', 900)],
    movements: [
      { id: 'mv1', name: 'I. Allegro', start: 15 },
      { id: 'mv2', name: 'II. Adagio', start: 831 },
    ],
    ...overrides,
  });
}

/**
 * A mark's row on the markings page, in the one shape that page gives it — the
 * container holding the label and the clock, each a seek control of its own, a
 * click anywhere else on it jumping exactly as the row's single button did
 * before it (T67).
 *
 * A movement's header is laid out by that same rule (T70), so the row's class
 * alone would answer with the headers too — and a header is a movement's, not a
 * mark's. The band is the one row that is not a marker's, which is what the
 * `:not()` is.
 */
const MARKINGS_ROW = '.markings-row:not(.markings-movement-header)';

/**
 * A mark's row on the browsing surfaces, which *is* its one seek control (T67) —
 * the shape the markings page's row must keep agreeing with, since it is the
 * same row read by the same student a moment earlier.
 */
const BROWSING_ROW = '.player-marker-row';

/** Every mark row, whichever of the two shapes the surface under test shows it in. */
const MARKER_ROW = `${MARKINGS_ROW}, ${BROWSING_ROW}`;

/**
 * Something a mark's row holds, named by a descendant selector, in both of the
 * row's shapes. Written as one selector rather than by joining `MARKER_ROW` and
 * the descendant: a comma-separated list of rows joined to `.x` would read as
 * "any row, or `.x` inside the second shape" — the first shape would answer with
 * the row itself.
 */
function inMarkerRows(descendant: string): string {
  return `${MARKINGS_ROW} ${descendant}, ${BROWSING_ROW} ${descendant}`;
}

function markerRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll(MARKER_ROW));
}

/** The rows' derived labels, in DOM order. */
function markerTitles(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.player-marker-title')).map((t) => t.textContent);
}

/**
 * The rows' clocks, in DOM order — the rows not being corrected (T68). The
 * marker rows' clocks: a movement's header carries the same clock (T70), and a
 * header is asked for its own time by `movementTimes`, which reads both kinds of
 * header state as this reads a mark's.
 */
function markerTimes(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll(inMarkerRows('.player-marker-time'))).map(
    (t) => t.textContent,
  );
}

/**
 * Every one of `selector`'s rows read as the page reads it, in DOM order: the
 * exact time the row the playhead is on carries in its field, the whole-second
 * clock every other row carries (T68). The slot holds one reading or the other
 * and never both, so this is a row's time in whichever state the row is in —
 * which is what a test asking *where the marks are* wants. A test asking what a
 * row *shows* reads `markerTimes` (the clocks on the page) or `timeField` (the
 * one field).
 *
 * One function for both kinds of row (T70), because both read their times the
 * same way: what a band's time is differs from a mark's in which rows are asked,
 * and in nothing else.
 */
function timesOf(container: HTMLElement, selector: string): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).map(
    (row) =>
      row.querySelector<HTMLInputElement>('.markings-row-time')?.value ??
      row.querySelector('.player-marker-time')?.textContent ??
      '',
  );
}

/** Every mark row's time as the page reads it — `timesOf` over the rows. */
function rowTimes(container: HTMLElement): string[] {
  return timesOf(container, MARKINGS_ROW);
}

/**
 * The alias field the list holds — the one the active row carries (T69). A row
 * is a form only while the playhead is on it, so there is exactly one at a time
 * and this is it.
 */
function aliasField(container: HTMLElement): HTMLInputElement {
  const field = container.querySelector<HTMLInputElement>('.markings-row-alias');
  if (field === null) throw new Error('No alias field — no row is the active one.');
  return field;
}

/**
 * What a row reads, in the order it reads it (T69): its label, the name beside
 * it, and its time. The middle one is a field on the active row and plain text
 * on every other row; this reads whichever is there, so the two states are
 * compared as a reader meets them rather than as two markups.
 *
 * The third one is a field on the active row too — the exact time took the slot
 * its clock occupied (T68) — and the clock every other row still carries, so the
 * time is read the way `rowTimes` reads it for the whole list: whichever of the
 * two the row is in.
 *
 * Every row reads three things, a row with no name included: the slot is what
 * holds the clock off the label, and it is there whether or not it has anything
 * in it. What it *renders* as is the stylesheet's business and is not asserted
 * here; that it is there at all is what the row's shape says for itself.
 */
function rowReading(row: HTMLElement): [string, string, string] {
  const field = row.querySelector<HTMLInputElement>('.markings-row-time');
  return [
    readPart(row, '.player-marker-title'),
    readPart(row, '.markings-alias-slot'),
    field !== null ? field.value : readPart(row, '.player-marker-time'),
  ];
}

/** The first `selector` in the row, as it reads — a field by its value, anything else by its text. */
function readPart(row: HTMLElement, selector: string): string {
  const part = row.querySelector(selector);
  if (part === null) throw new Error(`The row reads no ${selector}.`);
  return part instanceof HTMLInputElement ? part.value : (part.textContent ?? '');
}

/**
 * One rule's declarations from the markings stylesheet, by its class selector.
 * For the slot's tests, which assert what a box is *made of* — the one thing
 * about a size that a test can hold jsdom to.
 */
function ruleBody(selector: string): string {
  const match = markingsCss.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  if (match === null) throw new Error(`markings.css has no rule for ${selector}.`);
  return match[1];
}

/**
 * The seek control on a marking row that reads `reading` — the row's label, or
 * the clock beside it (T67). Addressed by what it reads rather than by a class,
 * because what has to be true of it is that it is a control of its own: while
 * one button spanned the label and the clock, a click on either was a click on
 * the button between them, and no field could live inside the row at all.
 */
function rowControl(row: HTMLElement, reading: string): HTMLElement {
  return within(row).getByRole('button', { name: reading });
}

/**
 * The movement name fields, in DOM order — one per header, on the authoring
 * surface (T58), where a movement is named where it sits in the list.
 */
function movementNameFields(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('.markings-movement-name'));
}

/**
 * The movement headers' jump controls, in DOM order — one per header that is
 * not the one being corrected. A header's jump is its clock (T68), and the
 * clock a header carries is the clock a mark's row carries (T70), so this is
 * the row's own control read off the band.
 */
function movementJumps(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.markings-movement-header .player-marker-time'),
  );
}

/** Every movement's time as its band reads it — `timesOf` over the headers. */
function movementTimes(container: HTMLElement): string[] {
  return timesOf(container, '.markings-movement-header');
}

/**
 * The one rule that sizes the slot every reading on the page is read in — the
 * clock a row shows and the exact time its field replaces it with, on either
 * kind of row (T68, T70). It names the row and not either kind of row, which is
 * what makes a band's reading and a mark's one reading: there is no second rule
 * for a second occupant to drift into.
 *
 * Two tests assert it, each for its own reason, so it is written once here.
 */
const CLOCK_SLOT_RULE =
  /\.markings-row \.player-marker-time,\s*\.markings-row \.markings-row-time \{[^}]*box-sizing:\s*border-box;[^}]*width:\s*var\(--markings-clock-slot\);[^}]*text-align:\s*right;/;

/** The slot's one size: the widest reading a recording can hold, h:mm:ss.mmm (T68). */
const CLOCK_SLOT_WIDTH = /--markings-clock-slot:\s*104px;/;

/** Waits past the autosave debounce, so a write that was going to happen has. */
async function pastDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 700));
}

/**
 * Asks the page the browser's own question — "may this tab go?" — and reports
 * whether it objected (T60). This is the only way a page can be asked: closing
 * and reloading are the browser's, and the confirm that follows a refusal is
 * the browser's too, which is why what is asserted is the refusal and not a
 * dialog nobody can render.
 */
function closeTheTab(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * The page on a private project with marks at 10s and 20s, every edit writing
 * itself — the two marks the row's own shape (T67) and the exact time moving
 * into it (T68) are both read against.
 */
function openTwoMarkPage() {
  const api = fakeProjectsApi();
  api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
  const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
  return renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
}

/**
 * The row carrying the correction block (T57, T64) — the row the playhead is
 * on, found by the attribute rather than the class so the test asserts what a
 * reader is told, not only what is coloured.
 */
function correctingRow(container: HTMLElement): HTMLElement | null {
  return container.querySelector('li[aria-current="true"]');
}

/** The corrected row's time field — the exact place a correction is read and typed. */
function timeField(container: HTMLElement): HTMLInputElement {
  const field = container.querySelector<HTMLInputElement>('.markings-row-time');
  if (field === null) throw new Error('No time field — no row is carrying the block.');
  return field;
}

/**
 * One of the corrected row's nudge controls, by the words it shows — which is
 * the whole of what it promises, and what a student reads before pressing it
 * (T71). The halves read the step they are about to take, so a test asking for
 * `−1s` is asking for the control a held `Shift` has already named.
 */
function nudgeControl(label: string): HTMLElement {
  return screen.getByRole('button', { name: label });
}

/**
 * The correction's four steps, in the order the strip reads them: `−0.5s`,
 * `−0.1s`, `+0.1s`, `+0.5s`.
 *
 * Read the way a student reads them — off the words on the controls, in the
 * order the document offers them — and reached through the group the block puts
 * around them, which is named for the row it corrects. The reading is the
 * behaviour and is asserted as such; how the four are laid out, the two decks
 * and the width that does not move under the finger, is the stylesheet's
 * business and is asserted there.
 */
function nudgeSteps(): string[] {
  const block = screen.getByRole('group', { name: /^(Correct marker|Re-time movement) / });
  return within(block)
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
}

/**
 * Nudges from the keyboard. The bracket keys are userEvent's own descriptor
 * syntax, so the press is dispatched directly — the same keydown the hook
 * listens for, Shift included.
 */
function pressNudge(key: '[' | ']', shift = false): void {
  // A real keyboard reports the shifted character — Shift+[ arrives as "{".
  const shifted = key === '[' ? '{' : '}';
  // The modifier goes down and comes up like a real one's (T71): the decks read
  // the state of the keyboard rather than the state of the click, so a `Shift`
  // pressed and never released would leave them promising `±1s` to the rest of
  // the test — and the key's own step is read off the key, so releasing it
  // takes nothing away from the press.
  if (shift) fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
  fireEvent.keyDown(window, { key: shift ? shifted : key, shiftKey: shift });
  if (shift) fireEvent.keyUp(window, { key: 'Shift' });
}

describe('the markings page opens on a project and plays it (T55)', () => {
  it('opens at its own URL on the project it names, under the navbar, and plays the recording', async () => {
    const api = fakeProjectsApi();
    const record = project();
    api.seed(record);
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });

    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });

    expect(
      await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' }),
    ).toBeInTheDocument();
    // The page is shell chrome: the persistent navbar frames it.
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(container.querySelector('.player-ruler')).toBeInTheDocument();

    await waitForPlayerSettled();
    // The page read the project from the server before it played anything.
    expect(api.getProject).toHaveBeenCalledWith('p1');
    // The recording plays through the page's own controller, from the stored
    // recording's canonical URL.
    expect(controller.load).toHaveBeenCalledTimes(1);
    expect(youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]).url).toBe(
      canonicalYouTubeUrl(record.videoId),
    );
  });

  it('lists the marks the project carries, labelled by rank within their movement', async () => {
    const api = fakeProjectsApi();
    // Three marks with a movement starting between the first and the second:
    // the first falls before it and forms the leading sequence, the other two
    // are movement II's A and B.
    api.seed(
      project({
        markers: [marker('m1', 10), marker('m2', 20), marker('m3', 30)],
        movements: [{ id: 'mv1', name: 'II. Andante', start: 15 }],
      }),
    );
    const { container } = renderApp({ api, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    const titles = Array.from(container.querySelectorAll('.player-marker-title')).map(
      (title) => title.textContent,
    );
    expect(titles).toEqual(['A', 'A', 'B']);
    const rows = markerRows(container);
    expect(rows[0].textContent).toContain('00:10');
    expect(rows[2].textContent).toContain('00:30');
    // Grouped by movement, with the leading sequence named as such. On this
    // page the movement's header is where its name is edited (T58), so the
    // header reads as the field holding it rather than as a button labelled
    // with it; the grouping it performs is the same grouping.
    expect(movementNameFields(container).map((f) => f.value)).toEqual(['II. Andante']);
    expect(screen.getByText('Before the first movement')).toBeInTheDocument();
  });

  it('carries a prompt naming the one action when the project has no marks', async () => {
    const api = fakeProjectsApi();
    api.seed(project({ markers: [] }));
    const { container } = renderApp({ api, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // No list — but the column says what fills it, and the recording is
    // playable, so the first mark can be placed at all.
    expect(markerRows(container)).toHaveLength(0);
    // The column keeps the panel's own name in both states — the empty column
    // and the filled one are the same column, not two surfaces.
    const empty = screen.getByRole('region', { name: 'Markers' });
    expect(empty.textContent).toMatch(/nothing marked yet/i);
    expect(empty.textContent).toContain('M');
    expect(container.querySelector('.player-ruler')).toBeInTheDocument();
  });

  it('plays, seeks, and walks the marks from the keyboard, and a row click jumps the recording', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    // Space plays and pauses.
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);

    // ←/→ seek within the recording.
    act(() => controller.seek(50));
    await user.keyboard('{ArrowRight}');
    expect(controller.getCurrentTime()).toBe(55);
    await user.keyboard('{ArrowLeft}');
    expect(controller.getCurrentTime()).toBe(50);

    // ↑/↓ walk the marks, from wherever the playhead is.
    await user.keyboard('{ArrowDown}');
    expect(controller.getCurrentTime()).toBe(10);
    await user.keyboard('{ArrowDown}');
    expect(controller.getCurrentTime()).toBe(20);

    // A mark's row jumps the recording to it.
    await user.click(markerRows(container)[0]);
    expect(controller.getCurrentTime()).toBe(10);
  });

  it('writes nothing — not even the recording length it measures', async () => {
    // The page's one in-memory mutation is stamping the measured duration, as
    // the practice surface does; under ADR-0006 duration is not a persisted
    // field, so the save wire skips it and the server row is untouched however
    // long the visit lasts.
    const api = fakeProjectsApi();
    api.seed(project({ duration: 0 }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372.5 })) });
    const { unmount } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    expect(api.get('p1')?.duration).toBe(0);
    unmount();
    await waitFor(() => expect(api.saveProject).not.toHaveBeenCalled());
  });

  it('shows the not-found surface for a URL that names no row', async () => {
    const api = fakeProjectsApi();
    renderApp({ api, initialEntry: '/projects/missing/markings' });

    expect(
      await screen.findByRole('heading', { name: 'This project could not be found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Projects' })).toBeInTheDocument();
  });

  it('lays out in the player rail, not the narrow text rail', async () => {
    const api = fakeProjectsApi();
    api.seed(project());
    const { container } = renderApp({ api, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    expect(container.querySelector('.page-rail-wide.app-page')).toBeInTheDocument();
  });

  it('tears its session down on leaving — nothing it held survives the navigation', async () => {
    const api = fakeProjectsApi();
    api.seed(project());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { navigateTo, container } = renderApp({
      api,
      controller,
      initialEntry: '/projects/p1/markings',
    });
    await waitForPlayerSettled();

    await navigateTo('/help');

    expect(await screen.findByRole('heading', { name: 'Help' })).toBeInTheDocument();
    // The controller the page built is released, and the workspace behind the
    // navigation holds the row exactly as the server does.
    expect(controller.destroy).toHaveBeenCalled();
    expect(container.querySelector('.player-ruler')).toBeNull();
    expect(api.get('p1')).toEqual(expect.objectContaining({ markers: project().markers }));
  });
});

describe('a mark can be placed, named and removed (T56)', () => {
  it('places a mark at the playhead with M, without interrupting playback', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ playing: true, duration: 372 }));
    act(() => controller.seek(42));

    await user.keyboard('m');

    // The mark fell where the student was hearing, not at zero and not at the
    // last place the playhead was written.
    expect(markerRows(container)).toHaveLength(1);
    // The row it landed on is the row the playhead is on, so it reads to the
    // millisecond already (T68) — 42 exactly, which is where it fell.
    expect(rowTimes(container)).toEqual(['00:42.000']);
    // Placing a mark is a listening gesture: the recording kept playing.
    expect(controller.getPlaybackState().playing).toBe(true);
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.seek).toHaveBeenLastCalledWith(42);

    // And the mark is the row the playhead has just passed, so it lands under
    // the correction block the instant it exists (T64) — a mark placed by ear
    // is a mark about to be made exact, with nothing to click to begin.
    expect(within(correctingRow(container)!).getByText('A')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Correct marker A' })).toBeInTheDocument();
  });

  it('lands the marks in time order with their derived labels, however they were placed', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    // Placed out of order — 30s, then 10s, then 20s.
    for (const time of [30, 10, 20]) {
      act(() => controller.seek(time));
      await user.keyboard('m');
    }

    // In the order time puts them in, which is not the order they were placed:
    // the row the playhead ended on reads to the millisecond (T68) and the two
    // it has gone by read as a music stand does.
    expect(rowTimes(container)).toEqual(['00:10', '00:20.000', '00:30']);
    expect(markerTitles(container)).toEqual(['A', 'B', 'C']);
  });

  it('places a mark from the column’s own control as well as the key', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(15));

    await user.click(screen.getByRole('button', { name: 'Add marker' }));

    // The mark lands active — it is the row the playhead is on — so it reads
    // through the field its clock gave way to (T68).
    expect(rowTimes(container)).toEqual(['00:15.000']);
    // The column stays open to a second mark — the control does not disappear
    // with the empty state that carried it.
    act(() => controller.seek(45));
    await user.click(screen.getByRole('button', { name: 'Add marker' }));
    expect(rowTimes(container)).toEqual(['00:15', '00:45.000']);
  });

  it('names a mark with the student’s own word, and clears it again', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    // Private, so the work saves itself and the server's copy is the assertion.
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // The name is read and written on the row the playhead is on (T69), so the
    // row is jumped to first: naming a mark is a jump and then an edit.
    await user.click(markerRows(container)[0]);
    const field = aliasField(container);
    await user.type(field, 'Meno');
    await user.tab();

    await waitFor(() => expect(api.get('p1')?.markers[0].aliases).toEqual(['Meno']));
    // The row reads the name beside its label, where it is read — and it is the
    // active row, so its time reads to the millisecond in the field the clock
    // gave way to (T68).
    expect(rowReading(markerRows(container)[0])).toEqual(['A', 'Meno', '00:10.000']);
    // An alias is a name, not a mark: typing into the field placed nothing.
    expect(markerRows(container)).toHaveLength(2);

    await user.clear(aliasField(container));
    await user.tab();

    await waitFor(() => expect(api.get('p1')?.markers[0].aliases).toEqual([]));
    expect(rowReading(markerRows(container)[0])).toEqual(['A', '', '00:10.000']);
  });

  it('refuses an alias that breaks a rule, with the domain’s own guidance', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // The row the playhead is on is the one that carries the field (T69).
    await user.click(markerRows(container)[0]);
    const field = aliasField(container);
    // Longer than the domain's 16 characters.
    await user.type(field, 'seventeen chars!!');
    await user.tab();

    // The rule is the domain's, and so is the sentence explaining it.
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 16 characters/i);
    // The refused text is not what the mark holds, and the field shows what it
    // does hold — nothing was taken and nothing was silently mangled.
    expect(field).toHaveValue('');
    expect(api.get('p1')?.markers[0].aliases).toEqual([]);
  });

  it('keeps that guidance where it was refused — another row’s success is no answer to it', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private' }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    const first = aliasField(container);
    await user.type(first, 'seventeen chars!!');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 16 characters/i);

    // A rule broken on one mark is that mark's complaint. Naming a different
    // one successfully says nothing about it, so the refusal outlives it —
    // otherwise the refused text sits in its field unexplained. Naming another
    // mark is a jump to its row first (T69), which is also how its field
    // appears at all.
    await user.click(markerRows(container)[1]);
    await user.type(aliasField(container), 'Recap');
    await user.tab();

    await waitFor(() => expect(api.get('p1')?.markers[1].aliases).toEqual(['Recap']));
    expect(screen.getByRole('alert')).toHaveTextContent(/at most 16 characters/i);
    expect(rowReading(markerRows(container)[0])).toEqual(['A', '', '00:10']);
  });

  it('removes a mark that was a mistake', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));

    // Gone from the column, and the mark behind it took its label.
    expect(markerTimes(container)).toEqual(['00:20']);
    expect(markerTitles(container)).toEqual(['A']);
    await waitFor(() => expect(api.get('p1')?.markers.map((m) => m.id)).toEqual(['m2']));
  });

  it('offers no editing control on the practice surface, and M places nothing there', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(50));

    // No control that could change a mark — the panel is the browsing list.
    expect(container.querySelector('.markings-row')).toBeNull();
    expect(container.querySelector('.markings-add')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete marker A' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Markings' })).toBeInTheDocument();

    // And no key either: the practice surface stays playback-only (ADR-0003),
    // so the authoring key its neighbour owns is simply not bound here.
    await user.keyboard('m');
    expect(markerRows(container)).toHaveLength(2);
    expect(api.saveProject).not.toHaveBeenCalled();
  });
});

describe('a mark can be corrected: nudge and typed time (T57)', () => {
  it('puts the correction controls on the row the playhead is on, and nowhere before the first mark', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // The recording's Start is not a row: nothing is being corrected while the
    // playhead sits before the first mark, and there is no block to show.
    expect(correctingRow(container)).toBeNull();
    expect(container.querySelector('.markings-correct')).toBeNull();

    await user.click(markerRows(container)[0]);

    // The click is the jump and only the jump. The seek parks the playhead on
    // the mark, and the row the playhead is on is the row carrying the block —
    // one gesture, with no separate act of picking a row out to correct. It is
    // named for a reader rather than only coloured.
    const carrying = correctingRow(container);
    expect(carrying).not.toBeNull();
    expect(within(carrying!).getByText('A')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Correct marker A' })).toBeInTheDocument();
    expect(controller.getCurrentTime()).toBe(10);

    // And the block is the playhead's, so it goes where the playhead goes:
    // jumping on to B carries it there.
    await user.click(markerRows(container)[1]);
    expect(within(correctingRow(container)!).getByText('B')).toBeInTheDocument();
  });

  it('nudges the mark the playhead is on a tenth of a second either way from the bracket keys', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    // The correction block reads the exact time: the row's own clock stays the
    // whole-second reading a music stand wants, and would not move for a tenth.
    expect(timeField(container)).toHaveValue('00:10.000');

    pressNudge('[');
    expect(await screen.findByDisplayValue('00:09.900')).toBeInTheDocument();

    pressNudge(']');
    pressNudge(']');
    expect(await screen.findByDisplayValue('00:10.100')).toBeInTheDocument();

    await waitFor(() => expect(api.get('p1')?.markers[0].time).toBeCloseTo(10.1));
    // A correction moves the recording with it (T64): the playhead is on the
    // time just written, which is what the student hears next and what keeps
    // the block on the row they corrected.
    expect(controller.getCurrentTime()).toBeCloseTo(10.1);
  });

  it('nudges a whole second with Shift from the keys, and the pointer has its own four steps', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);

    // The keys are unchanged by the decks (T71): a tenth, and a whole second
    // with Shift — the widened step they have always taken.
    pressNudge(']', true);
    expect(await screen.findByDisplayValue('00:11.000')).toBeInTheDocument();

    pressNudge('[', true);
    expect(await screen.findByDisplayValue('00:10.000')).toBeInTheDocument();

    // The pointer's way to the same corrections, as Add marker is the pointer's
    // way to `M`: the keys alone would leave the corrections unreachable
    // without a keyboard. The decks carry four steps where the keys carry two —
    // a half second is the tenth's coarse twin, reached in one press where the
    // tenth takes five — and the fine step is the tenths' own, whatever is held.
    await user.click(nudgeControl('+0.5s'));
    expect(await screen.findByDisplayValue('00:10.500')).toBeInTheDocument();
    await user.click(nudgeControl('−0.5s'));
    expect(await screen.findByDisplayValue('00:10.000')).toBeInTheDocument();
    await user.click(nudgeControl('+0.1s'));
    expect(await screen.findByDisplayValue('00:10.100')).toBeInTheDocument();

    // `Shift` widens the halves to the keys' whole second, and the control says
    // so before it is pressed: the step is on the label, not in a tooltip about
    // a modifier the student cannot see.
    await user.keyboard('{Shift>}');
    await user.click(nudgeControl('+1s'));
    await user.keyboard('{/Shift}');
    expect(await screen.findByDisplayValue('00:11.100')).toBeInTheDocument();
  });

  it('takes a time typed exactly, in the loose forms a student writes', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    const field = timeField(container);
    // The field opens on the mark's own time, at the precision a correction needs.
    expect(field).toHaveValue('00:10.000');

    await user.clear(field);
    await user.type(field, '5:10.5');
    await user.keyboard('{Enter}');

    // The clock form a score or a teacher's notes is written in, applied as the
    // exact time it means.
    expect(await screen.findByDisplayValue('05:10.500')).toBeInTheDocument();
    await waitFor(() => expect(api.get('p1')?.markers[0].time).toBe(310.5));
    // Committing a time commits the recording too (T64): the playhead goes to
    // the exact moment just written, so the student hears the landmark they
    // have just placed rather than the one it was.
    expect(controller.getCurrentTime()).toBeCloseTo(310.5);
  });

  it('refuses a time that makes no sense, with the domain’s guidance beside the field', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    const field = timeField(container);
    await user.clear(field);
    await user.type(field, '1:2:3:4');
    await user.keyboard('{Enter}');

    // The rule is the domain's, and so is the sentence explaining it — shown
    // inside the block that holds the field that caused it, not down beside the
    // alias field's own complaint.
    const guidance = await screen.findByRole('alert');
    expect(guidance).toHaveTextContent(/invalid time "1:2:3:4"/i);
    expect(guidance).toHaveTextContent(/use seconds like/i);
    expect(guidance.closest('.markings-correct')).not.toBeNull();
    // The refused text is not what the mark holds: the field goes back to the
    // time it does hold, and nothing was written — and nothing was sought
    // either, since the mark did not move to seek to.
    expect(field).toHaveValue('00:10.000');
    await pastDebounce();
    expect(api.get('p1')?.markers[0].time).toBe(10);
    expect(controller.getCurrentTime()).toBe(10);
  });

  it('drops a refused time when the mark is nudged instead', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    const field = timeField(container);
    await user.clear(field);
    await user.type(field, '1:2:3:4');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid time "1:2:3:4"/i);

    pressNudge(']');

    // A nudge puts the mark's own time back in the field, so the refusal is a
    // complaint about text that is nowhere any more: it goes when the text
    // does. Left standing it would sit under a valid time contradicting it, and
    // be announced a second time when the block came back to this row.
    expect(await screen.findByDisplayValue('00:10.100')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('holds the row being typed into while the caret is in its field, and hands it back after', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    const field = timeField(container);
    // The caret is in A's field: the student is telling this row what time it
    // holds, and it is the row they are working on (T64).
    await user.click(field);

    const list = container.querySelector('.player-marker-list') as HTMLElement;
    const rows = markerRows(container).map((button) => button.closest('li') as HTMLElement);
    // A is at the band's top and B is far below it, so a reveal aimed at either
    // lands somewhere unmistakable.
    stubRevealGeometry(list, rows[0], {
      scrollTop: 200,
      clientHeight: 320,
      scrollHeight: 2000,
      listTop: 100,
      listBottom: 420,
      rowTop: 300,
      rowBottom: 330,
    });
    stubRevealGeometry(list, rows[1], {
      scrollTop: 200,
      clientHeight: 320,
      scrollHeight: 2000,
      listTop: 100,
      listBottom: 420,
      rowTop: 900,
      rowBottom: 930,
    });

    // One row can be both at once — the row the playhead is on, with the caret
    // in the field it is giving a time to — and it reads as both.
    expect(rows[0]).toHaveClass('passed');
    expect(rows[0]).toHaveClass('correcting');

    // The playhead runs on past both marks while the time is being typed. Left
    // to the playhead the block would slide down to B, taking the field out
    // from under the typist and re-seeding it mid-word; the caret holds it
    // where it is, and the panel holds the list with it.
    act(() => controller.emitPlayback({ currentTime: 25 }));
    expect(within(correctingRow(container)!).getByText('A')).toBeInTheDocument();
    expect(timeField(container)).toBe(field);
    expect(list.scrollTop).toBe(200);

    // Two different rows, and a reader can tell them apart: A carries the block
    // — the ring, and the word `aria-current` gives it — while B holds the
    // playhead the block has been held off. Both are marked, each as itself.
    expect(correctingRow(container)).toBe(rows[0]);
    expect(rows[0]).toHaveClass('correcting');
    expect(rows[0]).not.toHaveClass('passed');
    expect(rows[1]).toHaveClass('passed');
    expect(rows[1]).not.toHaveClass('correcting');
    expect(rows[1]).not.toHaveAttribute('aria-current');

    // Leaving the field hands both back: the block is the playhead's again, and
    // the row it names — B, far below the band — comes to the top.
    await user.tab();
    expect(within(correctingRow(container)!).getByText('B')).toBeInTheDocument();
    expect(list.scrollTop).toBe(1000);
  });

  it('lets go of the pin on a nudge, which replaces the field the caret was in', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    await user.click(timeField(container));

    // A nudge pressed without the browser having moved the focus — which is
    // Safari, where a click does not focus a button. No blur ever arrives, and
    // the nudge re-seeds the field the caret was in, so that field is gone: the
    // pin has nothing left to hold, and the block is the playhead's again.
    fireEvent.click(nudgeControl('+0.1s'));
    act(() => controller.emitPlayback({ currentTime: 25 }));
    expect(within(correctingRow(container)!).getByText('B')).toBeInTheDocument();
  });

  it('holds the block on the caret’s row and never on a nudge button’s', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    await user.click(nudgeControl('+0.1s'));

    // The button has the focus, and still does not hold the block: a button
    // held down is not a row being given a time. Only the caret in the time
    // field pins — a pin armed by any interaction would arm here in Chrome and
    // not in Safari, which does not focus a button on click, and it has nothing
    // to buy now that a nudge takes the playhead with it. So the playhead
    // moving on takes the block with it, as it always would.
    expect(document.activeElement).toBe(nudgeControl('+0.1s'));
    act(() => controller.emitPlayback({ currentTime: 25 }));
    expect(within(correctingRow(container)!).getByText('B')).toBeInTheDocument();
  });

  it('moves the recording to the time it writes, and nothing else about playback', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ playing: true, duration: 372 }));

    await user.click(markerRows(container)[0]);

    pressNudge(']');
    pressNudge(']', true);
    const field = timeField(container);
    await user.clear(field);
    await user.type(field, '12');
    await user.keyboard('{Enter}');

    // A correction is a correction, not a transport: it moves the playhead to
    // the time it wrote (T64) and leaves everything else about playback alone —
    // a recording being played is still being played, from the moment the
    // student just named.
    expect(controller.getPlaybackState().playing).toBe(true);
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.getCurrentTime()).toBe(12);
    expect(await screen.findByDisplayValue('00:12.000')).toBeInTheDocument();
    await waitFor(() => expect(api.get('p1')?.markers[0].time).toBe(12));
  });

  it('gives a corrected mark its place in time order, and its label follows it', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // The first mark moves past the second: order is time's, and a label is a
    // rank within it — never a name the mark keeps.
    await user.click(markerRows(container)[0]);
    const field = timeField(container);
    await user.clear(field);
    await user.type(field, '25');
    await user.keyboard('{Enter}');

    expect(rowTimes(container)).toEqual(['00:20', '00:25.000']);
    expect(markerTitles(container)).toEqual(['A', 'B']);
    // The block is still on the mark it was on, not on the position it held —
    // because the correction took the playhead with it, and the row the
    // playhead is on is the row it re-sorted into. The label it reads is B now:
    // a label is a rank, and the rank moved with the mark.
    expect(within(correctingRow(container)!).getByText('B')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.get('p1')?.markers).toEqual([
        expect.objectContaining({ id: 'm1', time: 25 }),
        expect.objectContaining({ id: 'm2', time: 20 }),
      ]),
    );
  });

  it('walks to a mark with the arrow keys, and puts the block on the row the walk lands on', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.keyboard('{ArrowDown}');

    // ↑/↓ are how this panel is walked, and a walk is a jump: the playhead
    // lands on the mark it reached, which is the whole of what makes that row
    // the one being corrected — otherwise the nudge keys could never reach a
    // mark without a pointer.
    expect(controller.getCurrentTime()).toBe(10);
    expect(within(correctingRow(container)!).getByText('A')).toBeInTheDocument();

    pressNudge(']');
    expect(await screen.findByDisplayValue('00:10.100')).toBeInTheDocument();
  });

  it('waits for the recording, as every other key does — a correction is a seek', async () => {
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    // A load that never settles: the page is up and the marks are there, and
    // the recording is not.
    const controller = mockController({ load: vi.fn(() => new Promise<never>(() => {})) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' });

    pressNudge(']');
    pressNudge(']', true);
    await pastDebounce();

    // A correction asks the recording for a seek now (T64), so it waits with
    // every other playhead gesture until there is a recording to move — and
    // there is nothing to move yet, the playhead being nowhere but the
    // recording's Start. Nothing was written, and nothing was sought.
    expect(correctingRow(container)).toBeNull();
    expect(api.get('p1')?.markers.map((m) => m.time)).toEqual([10]);
    expect(vi.mocked(controller.seek)).not.toHaveBeenCalled();
  });

  it('corrects a mark whose recording cannot play at all', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    // A dead embed: the load settles on its failure path, and the length the
    // record remembers is what the timeline and the list are drawn from.
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 0, error: new YouTubePlaybackError(150) })),
    });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    // The length the record holds, as the player's own load hands it over.
    act(() => controller.emitPlayback({ duration: 372 }));

    await user.click(markerRows(container)[0]);
    pressNudge(']');

    // A settled load is a settled load, whether it settled well or badly: the
    // marks are all there is to correct, and the block and its keys work on
    // them exactly as they do over a recording that plays.
    expect(await screen.findByDisplayValue('00:10.100')).toBeInTheDocument();
    await waitFor(() => expect(api.get('p1')?.markers[0].time).toBeCloseTo(10.1));
  });

  it('follows the playhead from row to row, and finds the row behind when one goes', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    expect(within(correctingRow(container)!).getByText('A')).toBeInTheDocument();

    await user.click(markerRows(container)[1]);
    expect(within(correctingRow(container)!).getByText('B')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Correct marker B' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete marker B' }));

    // Nothing is held, so nothing can be left aimed at a mark that has gone:
    // the block is re-derived, and the playhead standing where B was is now on
    // the mark it has last passed — A, which is the row that takes it.
    expect(within(correctingRow(container)!).getByText('A')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Correct marker A' })).toBeInTheDocument();
  });

  it('corrects nothing before the first mark — the keys have no row to act on', async () => {
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    pressNudge('[');
    pressNudge(']', true);
    await pastDebounce();

    // The recording's Start is not a row, so there is no row for a correction
    // and nothing for the keys to move.
    expect(correctingRow(container)).toBeNull();
    expect(container.querySelector('.markings-row-time')).toBeNull();
    expect(api.get('p1')?.markers.map((m) => m.time)).toEqual([10, 20]);
    expect(api.saveProject).not.toHaveBeenCalled();
  });

  it('leaves the marks alone while the student is typing in a correction field', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    await user.click(markerRows(container)[0]);

    // A bracket aimed at a text field is the field's, not a nudge — the gesture
    // is a shortcut only where there is no field to type into.
    const alias = aliasField(container);
    alias.focus();
    fireEvent.keyDown(alias, { key: '[' });
    fireEvent.keyDown(timeField(container), { key: ']' });
    await pastDebounce();

    expect(api.get('p1')?.markers[0].time).toBe(10);
  });

  it('offers no correction on the practice surface, and the keys do nothing there', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private' }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    // The practice surface stays playback-only (ADR-0003): clicking a row still
    // jumps, and there is nothing to correct with — the surface carries no
    // block at all, so there is no row for one to be on.
    await user.click(markerRows(container)[0]);
    expect(correctingRow(container)).toBeNull();
    expect(container.querySelector('.markings-correct')).toBeNull();
    expect(container.querySelector('.markings-row-time')).toBeNull();

    pressNudge('[');
    pressNudge(']', true);
    await pastDebounce();

    expect(api.get('p1')?.markers.map((m) => m.time)).toEqual([10, 20]);
    expect(api.saveProject).not.toHaveBeenCalled();
  });
});

describe('a half-second step, and four nudges in two decks (T71)', () => {
  it('reads the four steps as one strip: the halves outboard, the tenths inboard', async () => {
    const user = userEvent.setup();
    const { container } = openTwoMarkPage();
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);

    // The row above the strip reads as the time between the two decks — the
    // minus pair flush left, the plus pair flush right — and within each deck
    // the coarse step sits outboard of the fine one, next to the row it moves.
    expect(nudgeSteps()).toEqual(['−0.5s', '−0.1s', '+0.1s', '+0.5s']);
  });

  it('moves the mark half a second either way, and leaves the playhead on the new time', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    expect(timeField(container)).toHaveValue('00:10.000');

    // The step that was five tenths away in one press where the tenth took
    // five. It is the same correction a key makes, through the same path (T64):
    // the mark moves and the recording moves with it, so the student hears the
    // landmark they have just made exact.
    await user.click(nudgeControl('−0.5s'));
    expect(await screen.findByDisplayValue('00:09.500')).toBeInTheDocument();
    await waitFor(() => expect(api.get('p1')?.markers[0].time).toBeCloseTo(9.5));
    expect(controller.getCurrentTime()).toBeCloseTo(9.5);

    await user.click(nudgeControl('+0.5s'));
    expect(await screen.findByDisplayValue('00:10.000')).toBeInTheDocument();
    await waitFor(() => expect(api.get('p1')?.markers[0].time).toBeCloseTo(10));
  });

  it('widens the halves to a whole second while Shift is held, and says so before the press', async () => {
    const user = userEvent.setup();
    const { container, controller } = openTwoMarkPage();
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);

    await user.keyboard('{Shift>}');

    // The label is the promise (T71). While `Shift` is held the halves are a
    // whole second, and they say a whole second — the state is read once, and
    // both what a control shows and what it takes come from that one reading,
    // so nothing can promise one step and take another.
    expect(nudgeSteps()).toEqual(['−1s', '−0.1s', '+0.1s', '+1s']);

    await user.click(nudgeControl('+1s'));
    expect(await screen.findByDisplayValue('00:11.000')).toBeInTheDocument();
    expect(controller.getCurrentTime()).toBeCloseTo(11);

    await user.keyboard('{/Shift}');

    // Let go, and the halves are halves again — the same controls, saying the
    // step they would now take.
    expect(nudgeSteps()).toEqual(['−0.5s', '−0.1s', '+0.1s', '+0.5s']);
    await user.click(nudgeControl('−0.5s'));
    expect(await screen.findByDisplayValue('00:10.500')).toBeInTheDocument();
  });

  it('still reads the held Shift when the correction moves to another row', async () => {
    const user = userEvent.setup();
    const { container } = openTwoMarkPage();
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    await user.keyboard('{Shift>}');
    expect(nudgeSteps()).toEqual(['−1s', '−0.1s', '+0.1s', '+1s']);

    // The correction follows the playhead, so it changes rows as the student
    // works — and the decks change rows with it. `Shift` is a fact about the
    // keyboard and not about the row: a deck that read it once, on the row it
    // was mounted on, would come back saying `±0.5s` with the modifier still
    // down, and the student holding it would take a half second where the
    // control they pressed promised a whole one the moment before.
    await user.click(markerRows(container)[1]);
    expect(nudgeSteps()).toEqual(['−1s', '−0.1s', '+0.1s', '+1s']);

    await user.click(nudgeControl('+1s'));
    expect(await screen.findByDisplayValue('00:21.000')).toBeInTheDocument();

    await user.keyboard('{/Shift}');
    expect(nudgeSteps()).toEqual(['−0.5s', '−0.1s', '+0.1s', '+0.5s']);
  });

  it('takes a tenth whatever is held — Shift does not widen the fine step', async () => {
    const user = userEvent.setup();
    const { container } = openTwoMarkPage();
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);

    await user.keyboard('{Shift>}');
    await user.click(nudgeControl('+0.1s'));
    await user.keyboard('{/Shift}');

    // The tenth is the fine control and wants no coarse twin: with the halves
    // widened there is nothing left for a widened tenth to be.
    expect(await screen.findByDisplayValue('00:10.100')).toBeInTheDocument();
  });

  it('returns the halves to a half second when the window loses focus, or a key-up goes missing', async () => {
    const user = userEvent.setup();
    const { container } = openTwoMarkPage();
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);

    await user.keyboard('{Shift>}');
    expect(nudgeSteps()).toEqual(['−1s', '−0.1s', '+0.1s', '+1s']);

    // The window losing focus: the student has left, no key-up is coming, and a
    // deck left saying `±1s` would be describing a keyboard nobody is at.
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(nudgeSteps()).toEqual(['−0.5s', '−0.1s', '+0.1s', '+0.5s']);

    // And a `Shift` whose key-up was swallowed — a browser dialog, an embed
    // taking the keyboard — is corrected by the next key of any kind, which
    // carries the modifier state with it.
    await user.keyboard('{Shift>}');
    expect(nudgeSteps()).toEqual(['−1s', '−0.1s', '+0.1s', '+1s']);
    fireEvent.keyDown(window, { key: 'a' });
    expect(nudgeSteps()).toEqual(['−0.5s', '−0.1s', '+0.1s', '+0.5s']);
    await user.keyboard('{/Shift}');
  });

  it('leaves the correction on the playhead’s row, and puts no caret in a field', async () => {
    const user = userEvent.setup();
    const { container, controller } = openTwoMarkPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    await user.click(markerRows(container)[0]);
    await user.click(nudgeControl('+0.5s'));

    // A press is a press and not an edit: it moves the caret into no field of
    // the row, so nothing pins the block and the row the corrections are on
    // stays the playhead's.
    expect(document.activeElement instanceof HTMLInputElement).toBe(false);
    expect(within(correctingRow(container)!).getByText('A')).toBeInTheDocument();

    act(() => controller.emitPlayback({ currentTime: 25 }));
    expect(within(correctingRow(container)!).getByText('B')).toBeInTheDocument();
  });

  it('lays the decks out to wrap, and holds the four controls to one width', () => {
    // "A control does not resize under the finger reaching for it" and "the
    // decks wrap, and the plus pair stays right-aligned" are claims about
    // layout, and jsdom computes none — so they are read off the stylesheet,
    // where they are made.
    //
    // The two decks share a line while both fit, the plus one held at the right
    // end by its own auto margin: `space-between` would do that for the line
    // they start on, and strand the plus deck at the left of the line it wraps
    // to. The wrap itself is the panel's floor, not its layout.
    expect(ruleBody('.markings-correct')).toMatch(/flex-wrap:\s*wrap;/);
    expect(ruleBody('.markings-nudge-deck-plus')).toMatch(/margin-left:\s*auto;/);

    // One width for all four, and the wider of the two labels the halves read:
    // five characters of the monospace face the strip is set in. The two that
    // change their words keep the width they had while the modifier is down.
    expect(ruleBody('.markings-nudge')).toMatch(/min-width:\s*5ch;/);
  });
});

describe('a marker row is a container with seek controls of its own (T67)', () => {
  it('jumps to the mark from the label, from the clock, and from the row itself', async () => {
    const user = userEvent.setup();
    const { container, controller } = openTwoMarkPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    // The label and the clock are seek controls of their own — the row is a
    // container holding them rather than one button wrapping them, which is
    // what makes room for a field inside it.
    const row = markerRows(container)[0];
    act(() => controller.seek(50));
    await user.click(rowControl(row, 'A'));
    expect(controller.getCurrentTime()).toBe(10);

    act(() => controller.seek(50));
    await user.click(rowControl(row, '00:10'));
    expect(controller.getCurrentTime()).toBe(10);

    // And every other pixel of the row — its own padding, and the space
    // between its controls — moves the playhead there too: a row with controls
    // in it is still a row a student can click anywhere on.
    act(() => controller.seek(50));
    await user.click(row);
    expect(controller.getCurrentTime()).toBe(10);
  });

  it('leaves the row’s own controls their clicks — the trash does only its own thing', async () => {
    const user = userEvent.setup();
    const { api, controller } = openTwoMarkPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));
    // The playhead somewhere that is not a mark, so a jump to one would be
    // visible as a change rather than as the playhead already standing there.
    act(() => controller.seek(50));

    // The trash deletes, and does not also jump the recording to the mark it
    // has just destroyed.
    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await waitFor(() => expect(api.get('p1')?.markers.map((m) => m.id)).toEqual(['m2']));
    expect(controller.getCurrentTime()).toBe(50);
  });

  it('nudges without a second jump from the row the decks sit under', async () => {
    const user = userEvent.setup();
    const { container, controller } = openTwoMarkPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    // The block is the playhead's, so a click on the row is what puts it there
    // — and the decks hang below the row rather than inside it (ADR-0007), so
    // the click a nudge takes is the nudge's alone.
    await user.click(markerRows(container)[0]);
    expect(controller.getCurrentTime()).toBe(10);

    // A nudge moves the mark and takes the recording with it (T64). The
    // recording lands on the time the nudge wrote: the row under the decks
    // does not also seek to the mark, which would put the playhead back on the
    // time the student has just corrected.
    await user.click(nudgeControl('−0.1s'));
    expect(await screen.findByDisplayValue('00:09.900')).toBeInTheDocument();
    expect(controller.getCurrentTime()).toBeCloseTo(9.9);
  });

  it('gives up the keyboard focus after a seek from the row, so Space still means play/pause', async () => {
    const user = userEvent.setup();
    const { container, controller } = openTwoMarkPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    const row = markerRows(container)[0];
    await user.click(rowControl(row, 'A'));
    expect(controller.getCurrentTime()).toBe(10);

    // The row is a pointer target, not a focus stop: the control gives the
    // focus up, so the next Space plays and pauses rather than re-activating
    // the control and jumping back to the row just clicked. (A focused button
    // owns Space — playerKeys stands down for one — so a control that kept the
    // focus would leave the toggle unmade here.)
    expect(row.contains(document.activeElement)).toBe(false);
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);

    // The clock is the row's other seek, and it gives the focus up the same
    // way: the rule belongs to the seek, not to one of the two controls. The
    // row has to be off the playhead for it to have a clock at all (T68) — the
    // active row reads through its field, and a field is not a seek — so the
    // playhead is moved away first, which puts the clock back.
    act(() => controller.seek(50));
    await user.click(rowControl(row, '00:10'));
    expect(controller.getCurrentTime()).toBe(10);
    expect(row.contains(document.activeElement)).toBe(false);
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(2);
  });

  it('leaves the browsing row its single seek control', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    // The row *is* the control where markings are only read (ADR-0003): no
    // control of its own appears inside it, so the practice surface's panel —
    // and the read-only public view's, which is the same panel — reads as it
    // always has.
    const row = markerRows(container)[0];
    expect(within(row).queryAllByRole('button')).toHaveLength(0);

    act(() => controller.seek(50));
    await user.click(row);
    expect(controller.getCurrentTime()).toBe(10);
  });
});

describe('the exact time moves into the active row (T68)', () => {
  it('reads the active row to the millisecond where its clock was, and every other row in seconds', async () => {
    const user = userEvent.setup();
    const { container, controller } = openTwoMarkPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    // Before: nothing is being corrected — the playhead is on no row at all,
    // having reached neither mark — so every row reads in whole seconds and no
    // row offers a field.
    expect(markerTimes(container)).toEqual(['00:10', '00:20']);
    expect(container.querySelector('.markings-row-time')).toBeNull();

    await user.click(markerRows(container)[0]);

    // The row the playhead is on reads to the millisecond, in the slot its
    // clock occupied: the field stands exactly where the clock was — behind the
    // alias, ahead of the trash — so the row is laid out identically in both
    // states and nothing moves as the playhead arrives on it.
    const row = markerRows(container)[0];
    const field = timeField(container);
    expect(row.contains(field)).toBe(true);
    expect(field).toHaveValue('00:10.000');
    expect(row.querySelector('.player-marker-time')).toBeNull();
    expect(field.nextElementSibling).toHaveClass('markings-delete');

    // A row shows one reading at a time and never both, and the page carries
    // exactly one millisecond reading: the one being corrected.
    expect(markerTimes(container)).toEqual(['00:20']);
    expect(container.querySelectorAll('.markings-row-time')).toHaveLength(1);
  });

  it('leaves the block below the row its controls and nothing left to read', async () => {
    const user = userEvent.setup();
    const { container } = openTwoMarkPage();
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);

    // The block is the row's correction surface still — the group a reader
    // hears named for the row it corrects — but the row's time is not in it any
    // more. The row above holds the field, and the nudges below keep their
    // place, which is where a correction is made.
    const block = screen.getByRole('group', { name: 'Correct marker A' });
    expect(block.querySelector('.markings-row-time')).toBeNull();
    expect(within(block).queryByRole('textbox')).toBeNull();
    expect(within(block).getByRole('button', { name: '−0.1s' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: '+0.1s' })).toBeInTheDocument();
  });

  it('lands a mark just placed on the row carrying the field', async () => {
    const user = userEvent.setup();
    const { container, controller } = openTwoMarkPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(120));

    await user.click(screen.getByRole('button', { name: 'Add marker' }));

    // Placing a mark pays for itself: the mark lands active the instant it
    // exists, so the field is already on the mark just placed rather than on
    // the one before it.
    const rows = markerRows(container);
    expect(rows).toHaveLength(3);
    const field = timeField(container);
    expect(rows[2].contains(field)).toBe(true);
    expect(field).toHaveValue('02:00.000');
  });

  it('corrects a movement in its own header, the field in the slot its jump had', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 1800 }));

    // Neither boundary is being corrected yet: each header shows its clock, and
    // the clock is the header's jump.
    const headers = container.querySelectorAll<HTMLElement>('.markings-movement-header');
    expect(headers[0].querySelector('.markings-row-time')).toBeNull();
    expect(movementJumps(container)).toHaveLength(2);

    await user.click(movementJumps(container)[0]);

    // The boundary the playhead is standing on reads to the millisecond in its
    // own header, in the slot its clock occupied — and the clock gives way to
    // it, as the clock in a mark's row does: the playhead is already there.
    const header = container.querySelectorAll<HTMLElement>('.markings-movement-header')[0];
    expect(within(header).getByLabelText('Time for movement I. Allegro')).toHaveValue('00:15.000');
    expect(header.querySelector('.player-marker-time')).toBeNull();

    // The movement next door is untouched: still its clock, still its jump,
    // and still no field — one correction on the page, on one row.
    const other = container.querySelectorAll<HTMLElement>('.markings-movement-header')[1];
    expect(within(other).getByRole('button', { name: '13:51' })).toBeInTheDocument();
    expect(movementJumps(container)).toHaveLength(1);
    expect(container.querySelectorAll('.markings-row-time')).toHaveLength(1);
  });

  it('rings the block’s own row under the band, and holds it there for the caret', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 1800 }));

    await user.click(movementJumps(container)[0]);

    // A movement's correction is two rows on the page: the field is up in the
    // band (T68), and the ring is on the block's own `<li>` under it (T64). The
    // ring is what the reveal looks for, and the row it rings has to be one in
    // flow: the band is sticky, and a sticky row's box is clipped to the band it
    // is pinned in, so a reveal aimed at the band measures nothing and leaves
    // the list where it is.
    const list = container.querySelector('.player-marker-list') as HTMLElement;
    // The first header is movement I's — the leading group has no movement, and
    // so no band of its own.
    const bandRow = container.querySelector('.markings-movement-header')!.closest('li') as HTMLElement;
    const blockRow = container.querySelector('li.correcting') as HTMLElement;
    expect(bandRow).toHaveClass('player-marker-movement');
    expect(blockRow).not.toHaveClass('player-marker-movement');
    expect(blockRow).toBe(bandRow.nextElementSibling);

    // The field the student types into is in the band above it.
    const field = timeField(container);
    expect(bandRow.contains(field)).toBe(true);

    // And while the caret is in it the row is held: the playhead running on to
    // a later mark moves the field, the ring, and the list nowhere. The block's
    // row is stubbed far down the list, so a reveal that did run would move it.
    stubRevealGeometry(list, blockRow, {
      scrollTop: 200,
      clientHeight: 320,
      scrollHeight: 2000,
      listTop: 100,
      listBottom: 420,
      rowTop: 900,
      rowBottom: 930,
    });
    await user.click(field);
    act(() => controller.emitPlayback({ currentTime: 900 }));
    expect(timeField(container)).toBe(field);
    expect(correctingRow(container)).toBe(blockRow);
    expect(list.scrollTop).toBe(200);
  });

  it('reveals a row inside a movement below the band that stands over it', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 1800 }));

    // The row the reveal follows is a row in flow inside a group — a mark's, or
    // the block's when the playhead is on a boundary — and the movement's band
    // stands over it. The reveal aims that row at the top of the list *below*
    // the band's own height, or the band would cover the row just revealed. The
    // band is what the inset is measured from, which is the other reason it can
    // never be the row revealed.
    const list = container.querySelector('.player-marker-list') as HTMLElement;
    const bandRow = container.querySelector('.markings-movement-header')!.closest('li') as HTMLElement;
    const rows = markerRows(container).map((row) => row.closest('li') as HTMLElement);
    stubRevealGeometry(list, bandRow, {
      scrollTop: 200,
      clientHeight: 320,
      scrollHeight: 2000,
      listTop: 100,
      listBottom: 420,
      rowTop: 100,
      rowBottom: 130,
    });
    stubRevealGeometry(list, rows[1], {
      scrollTop: 200,
      clientHeight: 320,
      scrollHeight: 2000,
      listTop: 100,
      listBottom: 420,
      rowTop: 900,
      rowBottom: 930,
    });

    // The 20s mark, which is the one inside movement I.
    await user.click(markerRows(container)[1]);

    expect(correctingRow(container)).toBe(rows[1]);
    // 900 against the list's top at 100 and the band's 30: the row lands at the
    // top of the band the list can show, not under the band.
    expect(list.scrollTop).toBe(970);
  });

  it('gives the clock and the field one slot of one rendered size', () => {
    // "Nothing in the row moves when the playhead arrives" is a claim about
    // layout, and jsdom computes none — so it is read off the stylesheet, where
    // it is made. One rule sizes every occupant of the slot, so the two states
    // cannot drift apart by being sized in two places.
    expect(markingsCss).toMatch(CLOCK_SLOT_RULE);
    // And one size for it to be, declared once.
    expect(markingsCss).toMatch(CLOCK_SLOT_WIDTH);

    // The field declares no width of its own — which is the mistake the ticket
    // names: 96px of content plus 12px of padding and 2px of border renders
    // 110px, wider than any clock it is meant to share a slot with. Its own
    // rule, at the start of a line, so the slot rule above is not what is read.
    expect(markingsCss).toMatch(/\n\.markings-row-time \{[^}]*padding:\s*4px 6px;/);
    expect(markingsCss).not.toMatch(/\n\.markings-row-time \{[^}]*width:/);

    // A clock is not a field and shows no edge, so it takes the field's right
    // inset — 6px of padding and 1px of border — in transparent space. One rule
    // and not two, because there is one clock (T70): a movement's header reads
    // its time in this same control, so a `border: 0` here would put that
    // header's digits 1px left of its own field's and there would be no second
    // rule left to correct it.
    expect(markingsCss).toMatch(
      /\.markings-row \.player-marker-time \{[^}]*padding:\s*0 6px;[^}]*border:\s*1px solid transparent;/,
    );

    // The passed row's accent reaches the field as it reached the clock it
    // replaces — the active row is usually the passed one, and it is the one
    // row whose reading is not a clock (T68).
    expect(markingsCss).toMatch(/li\.passed \.markings-row-time \{[^}]*color:\s*#0f766e;/);
  });
});

describe('the alias sits beside the label, text until its row is active (T69)', () => {
  /** The page on a private project with a named mark at 10s and an unnamed one at 20s. */
  function openPage() {
    const api = fakeProjectsApi();
    api.seed(
      project({ visibility: 'private', markers: [marker('m1', 10, ['Meno']), marker('m2', 20)] }),
    );
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    return renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
  }

  it('reads the name beside the label on every row, and is text until the playhead is on it', async () => {
    const user = userEvent.setup();
    const { container, controller } = openPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    // The name is read where the label is — the two things that name a mark,
    // one after the other, rather than at opposite ends of the row with the
    // clock wedged between them. A row with no name reads the same three
    // things with the middle one empty, because the slot is what holds the
    // clock off the label and is there whether or not it has anything in it.
    const [named, unnamed] = markerRows(container);
    expect(rowReading(named)).toEqual(['A', 'Meno', '00:10']);
    expect(rowReading(unnamed)).toEqual(['B', '', '00:20']);

    // The whole name is still reachable where the slot ellipsises it: the
    // browsing row's own span carries the whole reading in a title, and making
    // the row active to read the rest of a name would move the recording.
    expect(named.querySelector('.markings-alias-slot')).toHaveAttribute('title', 'Meno');
    // An empty name is an empty slot, and says nothing on hover either.
    expect(unnamed.querySelector('.markings-alias-slot')).not.toHaveAttribute('title');

    // The playhead is nowhere, so no row is a form: there is nothing in the
    // list to type into at all.
    expect(container.querySelector('.markings-row-alias')).toBeNull();

    // The playhead lands on the unnamed row, and that row becomes the field —
    // seeded empty, and empty means empty: no hint stands in for a name.
    await user.click(unnamed);
    expect(controller.getCurrentTime()).toBe(20);
    const field = aliasField(container);
    expect(field).toHaveValue('');
    expect(field).not.toHaveAttribute('placeholder');
    // The row the playhead is on reads its time to the millisecond, in the slot
    // its clock occupied (T68): the clock it had as a row of the list is gone.
    expect(rowReading(unnamed)).toEqual(['B', '', '00:20.000']);

    // And the named row is text still, and still a clock: one field in the list,
    // on the row the playhead is on, and the row that has one reads it beside
    // its label.
    expect(rowReading(named)).toEqual(['A', 'Meno', '00:10']);
  });

  it('jumps the recording from the name itself, which is text and not a control', async () => {
    const user = userEvent.setup();
    const { container, controller } = openPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(50));

    // The name on a row the playhead is not on is part of the row's own seek
    // surface, like the padding around it: a student who has read a name and
    // wants to hear the mark clicks the name. The field it becomes on the
    // active row takes the caret instead — that is the row's own suite above.
    const named = markerRows(container)[0];
    await user.click(within(named).getByText('Meno'));
    expect(controller.getCurrentTime()).toBe(10);
  });

  it('names a mark by jumping to its row and typing, and the mark holds the name afterwards', async () => {
    const user = userEvent.setup();
    const { api, container, controller } = openPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(50));

    // Naming a mark is a jump and then an edit: the row is a seek target, so
    // the click that makes it the row being worked on is also the click that
    // moves the recording to it. That is the price of a row that is a form
    // only while it is the row being worked on, and it is paid here.
    const row = markerRows(container)[1];
    await user.click(row);
    expect(controller.getCurrentTime()).toBe(20);

    const field = aliasField(container);
    await user.click(field);
    expect(field).toHaveFocus();
    await user.type(field, 'Recap');
    await user.tab();

    await waitFor(() => expect(api.get('p1')?.markers[1].aliases).toEqual(['Recap']));
    // Leaving the field commits it, and the row reads the name it now holds.
    // It is the row the playhead is on — the jump put it there — so its time
    // reads to the millisecond in the field that took the clock's slot (T68).
    expect(rowReading(row)).toEqual(['B', 'Recap', '00:20.000']);
  });

  it('reports a name the domain refuses beside the row, and puts the row back to the name it holds', async () => {
    const user = userEvent.setup();
    const { api, container, controller } = openPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    await user.click(markerRows(container)[0]);
    const field = aliasField(container);
    // Longer than the domain's 16 characters.
    await user.type(field, 'seventeen chars!!');
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 16 characters/i);
    // The list never shows a name the record does not have: the row reads the
    // name the mark holds, not the text that was refused — and, still being the
    // row the playhead is on, it reads its time to the millisecond (T68).
    expect(rowReading(markerRows(container)[0])).toEqual(['A', 'Meno', '00:10.000']);
    expect(api.get('p1')?.markers[0].aliases).toEqual(['Meno']);
  });

  it('keeps the row while a name is being typed, so the playhead cannot take the typing with it', async () => {
    const user = userEvent.setup();
    const { api, container, controller } = openPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    await user.click(markerRows(container)[0]);
    const field = aliasField(container);
    await user.click(field);
    await user.clear(field);
    await user.type(field, 'Recap');

    // Half a name in, and the caret is in the row's own field — so the row is
    // the one being worked on whatever the playhead does: the mark going by
    // cannot unmount the field and take what has been typed with it.
    act(() => controller.emitPlayback({ currentTime: 25 }));
    expect(aliasField(container)).toBe(field);
    expect(field).toHaveValue('Recap');
    expect(correctingRow(container)).toBe(markerRows(container)[0].closest('li'));

    // Leaving the row's fields hands the row back to the playhead, which has
    // moved on to the next mark — and the name was committed on the way out, as
    // it always is. The row's own fields are adjacent: the exact time took the
    // slot beside the name (T68), so the caret's first step out of the name is
    // into the row's other field, and only the second leaves the row.
    await user.tab();
    expect(correctingRow(container)).toBe(markerRows(container)[0].closest('li'));
    await user.tab();
    expect(within(correctingRow(container)!).getByText('B')).toBeInTheDocument();
    await waitFor(() => expect(api.get('p1')?.markers[0].aliases).toEqual(['Recap']));
  });

  it('keeps the row when the caret moves between its two fields, and lets go when it leaves both', async () => {
    const user = userEvent.setup();
    const { container, controller } = openPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    await user.click(markerRows(container)[0]);
    await user.click(aliasField(container));
    // The caret steps to the row's other field — the one that gives the mark
    // its time — with the playhead running on. One edit in two fields is one
    // row being worked on, not two.
    await user.click(timeField(container));
    act(() => controller.emitPlayback({ currentTime: 25 }));

    expect(correctingRow(container)).toBe(markerRows(container)[0].closest('li'));
    // The caret is in the row's time field, so the row reads to the millisecond
    // (T68) as well as holding the name it was made to hold.
    expect(rowReading(markerRows(container)[0])).toEqual(['A', 'Meno', '00:10.000']);

    // Leaving both is leaving the row: the block and the field are the
    // playhead's again, and the row they land on is the mark it has passed.
    await user.tab();
    expect(within(correctingRow(container)!).getByText('B')).toBeInTheDocument();
    expect(aliasField(container)).toHaveValue('');
  });

  it('leaves a click into the name field to the field — a caret, and not a jump', async () => {
    const user = userEvent.setup();
    const { container, controller } = openPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(50));

    // The row is a seek target everywhere but in its controls, and on the row
    // the caret is holding, the widest thing in it is the name field. So the
    // guard that keeps a control's click its own is the only thing between a
    // name being edited and the recording being jumped back to the mark it
    // belongs to — and the playhead has moved on to B, so a jump would show.
    await user.click(markerRows(container)[0]);
    await user.click(aliasField(container));
    act(() => controller.emitPlayback({ currentTime: 25 }));

    await user.click(timeField(container));
    await user.click(aliasField(container));
    expect(aliasField(container)).toHaveFocus();
    expect(controller.getCurrentTime()).toBe(25);
  });

  it('leaves a movement’s own name a field whatever the playhead is doing', async () => {
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // A movement's name is a control the surface exists to set, not a name the
    // row is *read* by, so it does not wait for the playhead the way an alias
    // does — and the panel's marker rows, which do, offer no field at all.
    const names = movementNameFields(container);
    expect(names).toHaveLength(2);
    expect(names[0]).toHaveValue('I. Allegro');
    expect(container.querySelector('.markings-row-alias')).toBeNull();
  });
});

describe('the alias slot is one box in two shapes (T69)', () => {
  it('gives the text and the field one box, so neither state moves the row', () => {
    // jsdom measures nothing, so the two shapes rendering the same size is a
    // CSS fact. The two are different kinds of element — a `span` and a text
    // `input` — so both wear `.markings-alias-slot`, which declares the box
    // itself: `border-box`, so what the rule says is what it renders, and the
    // text's border transparent rather than absent. The field's own rule may
    // add ink to that box and nothing else: a field that brought its own
    // padding would step the clock sideways the moment the playhead arrived.
    expect(ruleBody('.markings-alias-slot')).toMatch(/box-sizing:\s*border-box;/);
    const field = ruleBody('.markings-row-alias');
    expect(field).toMatch(/border-color:/);
    expect(field).toMatch(/background:/);
    expect(field).not.toMatch(/padding|border-width|\bwidth|font|line-height/);
  });

  it('lets the slot shrink to a floor, so the clock and the trash stay on the row', () => {
    // At the panel's narrowest the row still holds the label, the name, a
    // millisecond clock and the trash. The slot is the row's grower — it takes
    // the room the row has, which is what holds the clock off the label on a
    // row with no name — and it gives way to a floor rather than pushing the
    // clock off the row.
    const slot = ruleBody('.markings-alias-slot');
    expect(slot).toMatch(/flex:\s*1 1 64px;/);
    expect(slot).toMatch(/min-width:\s*60px;/);
  });

  it('reads the name in the row’s own face, not a third one', () => {
    // Nothing above this row declares a font: the app sets a face per element
    // and never globally, so a row that declares none reads in the document
    // default — 16px serif — where the practice surface's identical row reads
    // 15px system-ui. The markings row stopped being a button in T67 and lost
    // the metrics that came with the button, so the row's own rule states them
    // again, in the browsing row's words (player.css).
    const row = ruleBody('.markings-row');
    expect(row).toMatch(/font:\s*400 15px\/22px system-ui, sans-serif;/);
    expect(row).toMatch(/color:\s*#334155;/);
    // And the name beside the label is that same reading at that same size: the
    // browsing row prints `label — alias` as one line of one face, so the slot
    // is where that face is declared — it cannot be inherited, because the
    // field shape takes neither font nor ink from its parent.
    expect(ruleBody('.markings-alias-slot')).toMatch(/font:\s*400 15px\//);
  });
});

/**
 * The ticket's own mechanism is most of what is asserted here: "Sharing one row
 * is what puts them there, so the sharing is the mechanism and not a nicety."
 * A band that carries the row's class is laid out by the row's rules and cannot
 * drift from a mark's; two rows laid out by two rules that happen to agree today
 * can drift apart tomorrow and nothing would notice.
 *
 * The parent spec's testing decision is that no test asserts a class name or a
 * CSS measurement (#152). Two of these do, and deliberately: "one column", "one
 * typeface" and "the same gap" are claims that layout alone makes, and jsdom
 * computes no layout — so they are either read off the stylesheet, where they
 * are made, or not held to at all. That is the T68 precedent this follows. What
 * sits on top of the sharing — the order of the controls, what each row reads,
 * what a caret can reach — is asserted by driving the page, as the spec asks.
 */
describe("a movement's header is a marker's row (T70)", () => {
  /**
   * The page on a private project with two movements and marks inside them: a
   * mark before the first boundary, one inside I. Allegro and one inside
   * II. Adagio, so both kinds of row are on the page at once and each header
   * has a mark of its own to be compared with.
   */
  function openPage() {
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    return renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
  }

  /** The first movement's header — the band the list draws above its own marks. */
  function header(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('.markings-movement-header')!;
  }

  it("lays a movement's header out by a marker row's own rule, one indent step out", async () => {
    const { container } = openPage();
    await waitForPlayerSettled();

    // A band is a row. It carries the row's own class, which is what puts every
    // rule the row is laid out by under it without being told — the same gap,
    // the same right padding, the same slot for its time — and it is *that*
    // sharing, rather than two rules that agree today, that keeps a header's
    // trash in the column of its own markers' trash a ticket from now.
    expect(header(container)).toHaveClass('markings-row');

    // And it is no longer the browsing header: that rule lays out the button the
    // practice surface's header still is, and it is not what lays this out.
    expect(header(container)).not.toHaveClass('player-movement-header');
  });

  it("gives the band nothing of the row but the one indent step it sits at", () => {
    // jsdom computes no layout, so "one row" is read off the stylesheet, where
    // it is made. The band's own rule carries the step out — a header sits at
    // the panel's inset and the rows are indented from it — and the divider the
    // band is. It declares no gap, no right padding and no face of its own: each
    // of those is the row's, declared once, so neither kind of row can drift
    // from the other by being laid out in a second place.
    const band = ruleBody('.player-marker-movement .markings-movement-header');
    expect(band).toMatch(/padding-left:\s*10px;/);
    expect(band).not.toMatch(/\bgap:/);
    expect(band).not.toMatch(/padding:/);
    expect(band).not.toMatch(/padding-right:/);
    expect(band).not.toMatch(/\bfont:/);
    expect(band).not.toMatch(/display:/);

    // The right padding and the step are the row's own numbers, which is what
    // makes a header's trash and a mark's the same distance from the panel's
    // edge — and so one column, whatever the panel is doing.
    expect(ruleBody('.markings-row')).toMatch(/padding:\s*7px 10px 7px 16px;/);
    expect(ruleBody('.markings-row')).toMatch(/gap:\s*6px;/);
  });

  it('holds the reading and the trash in the same order on both kinds of row', async () => {
    const { container } = openPage();
    await waitForPlayerSettled();

    // The two things both kinds of row carry are the time and the control that
    // destroys, and they come in that order on both — the same thing in the same
    // place, whichever row it is on. What leads them is the row's own grower:
    // the name beside the label on a mark's row, the movement's name on a
    // boundary's, both of them the room between the row's left end and its time.
    //
    // The row is the second mark's: the one inside the first movement, so the
    // header compared with it is the header of the group that row is in.
    for (const row of [markerRows(container)[1], header(container)]) {
      const grower = row.querySelector('.markings-alias-slot, .markings-movement-name')!;
      const clock = row.querySelector('.player-marker-time')!;
      const trash = row.querySelector('.markings-delete')!;
      expect(clock).not.toBeNull();
      expect(trash).not.toBeNull();
      expect(grower.compareDocumentPosition(clock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(clock.compareDocumentPosition(trash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // The trash is the last thing the row holds, and the row's right padding
      // is the one the two kinds share: together those are the column.
      expect(row.lastElementChild).toBe(trash);
    }
  });

  it("reads a header's time in the row's own slot and face, from the row's own clock", async () => {
    const { container } = openPage();
    await waitForPlayerSettled();

    // One rule sizes the slot both kinds of row read their time in, and it names
    // the row rather than either kind of row (T70) — the rule itself is stated
    // once for the two tests that assert it.
    expect(markingsCss).toMatch(CLOCK_SLOT_RULE);
    // And the header's clock is that control and not a second one: the button
    // the mark's row jumps by, which is why the movement's own jump class is
    // gone from the panel and from the stylesheet both.
    expect(container.querySelector('.markings-movement-jump')).toBeNull();
    expect(markingsCss).not.toMatch(/markings-movement-jump/);
    // Both clocks read in the row's face, taken by inheritance — a button takes
    // neither the face nor the ink around it unless it is told to, which is the
    // one thing that made the header's reading a different reading.
    expect(markingsCss).toMatch(
      /\.markings-row \.player-marker-title,\s*\.markings-row \.player-marker-time \{[^}]*font-family:\s*inherit;/,
    );
  });

  it('reaches a movement from the keyboard, which the arrows alone cannot do', async () => {
    const user = userEvent.setup();
    const { container, controller } = openPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 1800 }));

    // `↑`/`↓` walk the marks and reach no movement, so a band's clock is the one
    // control on the page that gets the keyboard to a boundary — which is why it
    // is a Tab stop where a mark's clock is not. That difference is deliberate
    // and is the only one the two rows have.
    const bandClock = movementJumps(container)[0];
    bandClock.focus();
    expect(bandClock).toHaveFocus();
    await user.keyboard('{Enter}');

    // Pressed, it does what a click does: the playhead stands on the boundary,
    // which is what makes it the row being corrected (T59, T64), and the field
    // takes the clock's place in the slot — as it does in a mark's row.
    expect(movementTimes(container)[0]).toBe('00:15.000');
    expect(container.querySelectorAll('.markings-row-time')).toHaveLength(1);
  });

  it('reads whole seconds on both kinds of row until one of them is the active one', async () => {
    const user = userEvent.setup();
    const { container, controller } = openPage();
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 1800 }));

    // Nothing is being corrected: every row and every header reads whole seconds
    // — the music stand's reading — down the one column.
    expect(rowTimes(container)).toEqual(['00:10', '00:20', '15:00']);
    expect(movementTimes(container)).toEqual(['00:15', '13:51']);

    // The playhead lands on a mark inside the first movement: that row reads to
    // the millisecond, and every other reading on the page — the other marks'
    // and both headers' — stays in whole seconds.
    await user.click(markerRows(container)[1]);
    expect(rowTimes(container)).toEqual(['00:10', '00:20.000', '15:00']);
    expect(movementTimes(container)).toEqual(['00:15', '13:51']);

    // And the playhead on the boundary next door: the header reads exact in the
    // slot its clock occupied, and the marks it holds read whole seconds again.
    // One millisecond reading is on the page, whichever kind of row it is on.
    await user.click(movementJumps(container)[0]);
    expect(movementTimes(container)).toEqual(['00:15.000', '13:51']);
    expect(rowTimes(container)).toEqual(['00:10', '00:20', '15:00']);
    expect(container.querySelectorAll('.markings-row-time')).toHaveLength(1);
  });

  it('fits the panel at its floor, with the trash reachable on both kinds of row', () => {
    // The panel's width is the split's, and its floor is the one the ticket
    // names. jsdom measures nothing, so what is asserted is the one thing that
    // makes the row fit in it: the parts that cannot give way are sized for what
    // they show, and the parts that can are the growers, floored rather than
    // pinned — so nothing is pushed off the edge at 280px and the trash stays on
    // every row.
    expect(appCss).toMatch(/--player-side-column:\s*clamp\(280px, 26vw, 26rem\);/);
    // A row is never wider than what holds it...
    expect(ruleBody('.markings-row')).not.toMatch(/(^|[^-])\bwidth:/);
    // ...its time is a slot sized once for the longest reading there is...
    expect(markingsCss).toMatch(CLOCK_SLOT_WIDTH);
    // ...its trash is a glyph that takes no room and gives none...
    expect(ruleBody('.markings-delete')).toMatch(/flex:\s*0 0 auto;/);
    // ...and the two things that may give way are the row's growers, each with a
    // floor rather than a width: the name beside a mark's label, and the
    // movement's name, which is the band's own grower.
    expect(ruleBody('.markings-alias-slot')).toMatch(/min-width:\s*60px;/);
    expect(ruleBody('.markings-movement-name')).toMatch(/min-width:\s*0;/);
  });

  it("leaves the browsing panel's own header the button it has always been", async () => {
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 1800 }));

    // The practice surface's header is the jump control alone — the whole header
    // is the button — and it is laid out by the header's browsing rule, not by
    // the markings page's row. The read-only public view draws the same panel
    // with no authoring either, so what is true here is true there: this work
    // reaches the page where markings are authored and no further.
    // Both of the page's headers: the movement's own, and the divider standing
    // for the marks before the first one. The first of those is the button; the
    // second is the divider, and the assertion is that neither has moved.
    const band = container.querySelector<HTMLElement>('button.player-movement-header')!;
    expect(band).toHaveTextContent('I. Allegro');
    expect(band.tagName).toBe('BUTTON');
    for (const header of container.querySelectorAll('.player-movement-header')) {
      expect(header).not.toHaveClass('markings-row');
      expect(header).not.toHaveClass('markings-movement-header');
    }
    expect(container.querySelector('.markings-row')).toBeNull();
    expect(container.querySelector('.markings-delete')).toBeNull();
    expect(container.querySelector('.markings-row-time')).toBeNull();
  });
});

describe('movements exist, so the letters restart (T58)', () => {
  it('adds a movement at the playhead, and the marks group under it with the letters starting over', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // A project with no movements: one flat sequence, exactly as before.
    expect(container.querySelectorAll('.player-movement-header')).toHaveLength(0);
    expect(markerTitles(container)).toEqual(['A', 'B']);

    // The boundary goes where the recording is — the student marks a movement
    // start by hearing it, the same way they place a mark.
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(15));
    await user.click(screen.getByRole('button', { name: 'Add movement' }));

    const names = movementNameFields(container);
    expect(names).toHaveLength(1);
    expect(names[0].value).toBe('Movement 1');

    // And it is a boundary in earnest: the mark before it leads a sequence of
    // its own, and the mark after it opens the movement's letters at A — the
    // whole reason movements exist (ADR-0005).
    expect(markerTitles(container)).toEqual(['A', 'A']);
    expect(screen.getByText('Before the first movement')).toBeInTheDocument();

    // The 00:20 mark is *under* the boundary rather than merely second in the
    // letters. A header and the rows beneath it are the movement — membership is
    // what the list's own order says it is — so the shape has to be the leading
    // group and its mark, then the boundary and its own. The boundary carries
    // the correction block, having been placed where the playhead stands (T64):
    // the block is on the row the playhead is on, and a boundary set by ear is
    // the row the student has most obviously just made. It is a row of the list
    // of its own, under the band — and its own row holds only the nudges now
    // (T68), the boundary's time being typed into the band above it.
    expect(
      [...container.querySelectorAll('.player-marker-list > li')].map((item) => {
        const header = item.querySelector('.markings-movement-header');
        if (header !== null) {
          return (header.querySelector('input') as HTMLInputElement).value;
        }
        if (item.classList.contains('player-marker-movement')) return 'before the first movement';
        if (item.querySelector('.markings-correct') !== null) return 'the correction block';
        return item.querySelector('.player-marker-title')?.textContent ?? '?';
      }),
    ).toEqual(['before the first movement', 'A', 'Movement 1', 'the correction block', 'A']);
    // The boundary's own time is where the correction begins (T68): the field
    // is in the band, in the slot the header's clock occupied, and the block
    // under it is the nudges.
    const band = container.querySelector('.markings-movement-header') as HTMLElement;
    expect(within(band).getByLabelText('Time for movement Movement 1')).toHaveValue('00:15.000');

    // And the boundary is authored in earnest, not merely drawn: it is what the
    // server ends up holding once the project is committed.
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.get('p1')?.movements).toHaveLength(1));
    expect(api.get('p1')?.movements.map((m) => [m.name, m.start])).toEqual([['Movement 1', 15]]);
  });

  it('refuses a boundary the playhead already sits on, naming the movement in the way', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(
      project({
        markers: [marker('m1', 10), marker('m2', 20)],
        movements: [{ id: 'mv1', name: 'I. Allegro', start: 15 }],
      }),
    );
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // Clicking a movement's header parks the playhead exactly on its start —
    // the one moment a boundary cannot be set, and one a student reaches by
    // doing the most ordinary thing on the page.
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(15));
    await user.click(screen.getByRole('button', { name: 'Add movement' }));

    // The domain's own guidance, beside the control that asked — there is no
    // movement to hang it on, because the attempt left none behind.
    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('I. Allegro');
    expect(refusal.textContent).toMatch(/strictly after/i);
    expect(movementNameFields(container)).toHaveLength(1);
  });

  it('names a movement in its header, and the name is what the server ends up holding', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(
      project({
        visibility: 'private',
        movements: [{ id: 'mv1', name: 'Movement 1', start: 15 }],
      }),
    );
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    const field = movementNameFields(container)[0];
    expect(field.value).toBe('Movement 1');

    // The name is edited where it is read — in the header the movement owns.
    await user.clear(field);
    await user.type(field, 'II. Andante{Enter}');

    await pastDebounce();
    expect(api.get('p1')?.movements.map((m) => m.name)).toEqual(['II. Andante']);
    // A rename moves nothing: the boundary is exactly where it was.
    expect(api.get('p1')?.movements.map((m) => m.start)).toEqual([15]);
  });

  it('refuses a name a movement cannot hold, with the domain’s guidance in its header', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(
      project({
        visibility: 'private',
        movements: [{ id: 'mv1', name: 'Movement 1', start: 15 }],
      }),
    );
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // The field is emptied before it is retyped, so an emptied field is a state
    // the page meets — and it must leave the record alone rather than persist a
    // movement with no name.
    const field = movementNameFields(container)[0];
    await user.clear(field);
    await user.tab();

    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toMatch(/must be named/i);
    // And the field goes back to the name the movement still holds.
    expect(field.value).toBe('Movement 1');

    await pastDebounce();
    expect(api.get('p1')?.movements.map((m) => m.name)).toEqual(['Movement 1']);
  });

  it('puts the block on the boundary when the playhead sits on one, mark standing there or not', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    // A mark exactly where a movement begins — the ordinary result of setting a
    // boundary and marking the downbeat you hear at it.
    api.seed(
      project({
        markers: [marker('m1', 15)],
        movements: [{ id: 'mv1', name: 'II. Andante', start: 15 }],
      }),
    );
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(movementJumps(container)[0]);

    // Movements are markers' peers, not their superiors (ADR-0007): a boundary
    // is corrected by the same controls a mark is, so the two rows need no rank
    // between them — only a rule for the one moment both hold the playhead, and
    // the boundary is what the student is standing on.
    expect(controller.getCurrentTime()).toBe(15);
    expect(screen.getByRole('group', { name: 'Re-time movement II. Andante' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Correct marker A' })).toBeNull();
    expect(timeField(container)).toHaveValue('00:15.000');

    // A step off the boundary, the playhead rests on the mark instead, and the
    // block is wherever the playhead is.
    act(() => controller.emitPlayback({ currentTime: 15.5 }));
    expect(screen.getByRole('group', { name: 'Correct marker A' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Re-time movement II. Andante' })).toBeNull();
  });

  it('keeps a movement visible before anything is marked inside it', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // Nothing at all on the project: the column says what fills it.
    expect(screen.getByRole('region', { name: 'Markers' }).textContent).toMatch(
      /nothing marked yet/i,
    );

    // Laying a symphony's movements out before marking any of them is an
    // ordinary way to work through it — and it has to be visible while it is
    // being done, or the student cannot see the boundary they just set.
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(100));
    await user.click(screen.getByRole('button', { name: 'Add movement' }));

    expect(movementNameFields(container)).toHaveLength(1);
    expect(markerRows(container)).toHaveLength(0);
    // The prompt gave way to the boundary: the column holds something now.
    expect(screen.queryByText(/nothing marked yet/i)).toBeNull();
  });
});

describe('a movement can be re-timed and deleted (T59)', () => {
  it('re-times a movement by typing an exact time, and the server ends up holding it', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // The recording's Start is no row at all, so there is nothing to correct
    // until the playhead has reached one.
    expect(container.querySelector('.markings-correct')).toBeNull();

    // Clicking a movement's header parks the playhead at its start — and a
    // boundary is a marker's peer (ADR-0007), so that is the whole of what puts
    // the block on it: the row the playhead is on, exactly as a mark's row is.
    act(() => controller.emitPlayback({ duration: 1800 }));
    await user.click(movementJumps(container)[1]);
    expect(controller.getCurrentTime()).toBe(831);
    const block = screen.getByRole('group', { name: 'Re-time movement II. Adagio' });
    // The field reads the boundary's exact time in the header's own clock slot
    // (T68), where a row that is not being corrected keeps the whole-second
    // reading a music stand wants. The block below is the nudges alone.
    expect(block.querySelector('.markings-row-time')).toBeNull();
    const header = container.querySelectorAll<HTMLElement>('.markings-movement-header')[1];
    expect(within(header).getByLabelText('Time for movement II. Adagio')).toHaveValue('13:51.000');

    const field = timeField(container);
    await user.clear(field);
    await user.type(field, '14:05');
    await user.keyboard('{Enter}');

    await pastDebounce();
    // The boundary moved and every other one stayed exactly where it was.
    expect(api.get('p1')?.movements.map((m) => [m.name, m.start])).toEqual([
      ['I. Allegro', 15],
      ['II. Adagio', 845],
    ]);
    // And the recording moved with it (T64), exactly as it does for a mark: the
    // playhead is on the start just written, so the student hears movement II
    // from where they have just said it begins.
    expect(controller.getCurrentTime()).toBe(845);
  });

  it('refuses a re-time that would cross a neighbour, naming it, and moves nothing', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    act(() => controller.emitPlayback({ duration: 1800 }));
    await user.click(movementJumps(container)[0]);

    // A real time, typed wrong: 15:00 is past where movement II begins, and a
    // boundary that moved there would stand on the wrong side of it, with the
    // two extents overlapping. The domain refuses rather than rearranging the
    // movements behind the student's back.
    const field = timeField(container);
    await user.clear(field);
    await user.type(field, '15:00');
    await user.keyboard('{Enter}');

    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('II. Adagio');
    expect(refusal.textContent).toMatch(/strictly after .* strictly before/);
    // The refused text is not where the boundary is: the field goes back to the
    // start the movement holds, and the record is untouched.
    expect(field).toHaveValue('00:15.000');
    await pastDebounce();
    expect(api.get('p1')?.movements.map((m) => m.start)).toEqual([15, 831]);
    expect(api.saveProject).not.toHaveBeenCalled();
  });

  it('nudges a boundary a tenth of a second either way, and refuses one nudged onto its neighbour', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    act(() => controller.emitPlayback({ duration: 1800 }));
    await user.click(movementJumps(container)[0]);
    expect(timeField(container)).toHaveValue('00:15.000');

    // The same steps, and the same two decks, a mark's correction carries: a
    // boundary placed by ear lands late by reaction time just as a mark does,
    // and the decks hang below the band the boundary's own field is in (T68).
    const block = screen.getByRole('group', { name: 'Re-time movement I. Allegro' });
    expect(within(block).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '−0.5s',
      '−0.1s',
      '+0.1s',
      '+0.5s',
    ]);
    // A list row of its own, directly below the header's: the header's row is
    // the list's sticky band, and a block inside it would grow the very band
    // that pins over the marks the band is for. Asserted as the structure it
    // is — the row above the block's is the row holding the header — so a block
    // moved inside the band fails however it was written.
    const blockRow = block.closest('li') as HTMLElement;
    expect(blockRow.previousElementSibling?.querySelector('.markings-movement-header')).not.toBeNull();

    await user.click(nudgeControl('+0.1s'));
    expect(await screen.findByDisplayValue('00:15.100')).toBeInTheDocument();
    await user.keyboard('{Shift>}');
    await user.click(nudgeControl('−1s'));
    await user.keyboard('{/Shift}');
    expect(await screen.findByDisplayValue('00:14.100')).toBeInTheDocument();
    await pastDebounce();
    expect(api.get('p1')?.movements[0].start).toBeCloseTo(14.1);
    // Every nudge took the recording with it, as a mark's does (T64): the
    // playhead is on the start the boundary now holds.
    expect(controller.getCurrentTime()).toBeCloseTo(14.1);

    // Nudged up against movement II, a step lands on a boundary that is already
    // there: the domain says so where the controls are, and the boundary stays
    // where it was rather than taking the movement next door's place.
    await user.clear(timeField(container));
    await user.type(timeField(container), '13:50.9');
    await user.keyboard('{Enter}');
    await pastDebounce();
    await user.click(nudgeControl('+0.1s'));

    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('II. Adagio');
    // The boundary is one step short of the neighbour and stays there: a nudge
    // that cannot be taken is refused, not clamped onto a start that is taken —
    // and a refused nudge moves the recording nowhere, since there is no new
    // time to move it to.
    const starts = api.get('p1')?.movements.map((m) => m.start) ?? [];
    expect(starts[0]).toBeCloseTo(830.9);
    expect(starts[1]).toBe(831);
    expect(controller.getCurrentTime()).toBeCloseTo(830.9);
  });

  it('asks before deleting a movement, saying how many marks it holds and what becomes of them', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // Nothing is asked until the student asks to delete something.
    expect(screen.queryByText(/^Delete “/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Delete movement II. Adagio' }));

    // The whole decision, before it is taken: the boundary holds one mark, the
    // mark stays, and the letter it carries does not — it drops into the
    // movement before, where its rank is drawn again. A student who is told
    // this is choosing; one who is not has a mark at a different letter to
    // discover afterwards.
    expect(
      screen.getByText(
        'Delete “II. Adagio”? Its marker stays — it falls to “I. Allegro”, and its label renumbers.',
      ),
    ).toBeInTheDocument();

    // And a question is not the act. Cancelling leaves the record alone.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/^Delete “/)).toBeNull();
    expect(movementNameFields(container)).toHaveLength(2);
    await pastDebounce();
    expect(api.saveProject).not.toHaveBeenCalled();
  });

  it('asks a shorter question of a movement holding nothing, because nothing is at stake', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [], movements: [{ id: 'mv1', name: 'I. Allegro', start: 15 }] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // Laying a symphony's boundaries out before marking inside them is an
    // ordinary way to work (T58), so this is a state the page really meets —
    // and a movement with no marks has no marks to fall anywhere or to renumber.
    await user.click(screen.getByRole('button', { name: 'Delete movement I. Allegro' }));
    expect(screen.getByText('Delete “I. Allegro”? It holds no markers.')).toBeInTheDocument();
  });

  it('deletes the movement and keeps its marks, regrouped and relabelled by the rule that remains', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // Before: the mark at 00:10 leads on its own, and the two movements hold
    // one mark each, so each opens its letters at A.
    expect(markerRows(container)).toHaveLength(3);
    expect(markerTitles(container)).toEqual(['A', 'A', 'A']);

    // Deleting the first movement says the other thing a movement can cost:
    // there is no movement before it, so its marks fall to the leading group.
    await user.click(screen.getByRole('button', { name: 'Delete movement I. Allegro' }));
    expect(
      screen.getByText(
        'Delete “I. Allegro”? Its marker stays — it joins the markers before the first movement, ' +
          'and its label renumbers.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // The boundary has gone from the list and from the record.
    expect(movementNameFields(container)).toHaveLength(1);
    await pastDebounce();
    expect(api.get('p1')?.movements.map((m) => m.name)).toEqual(['II. Adagio']);

    // And the marks are all still here — deleting a movement never deletes
    // them. They are re-derived rather than rewritten: the 00:20 mark that was
    // movement I's A is now the second mark of the leading group, and the
    // 15:00 mark is still movement II's A, because its own boundary never moved.
    expect(markerRows(container)).toHaveLength(3);
    expect(markerTitles(container)).toEqual(['A', 'B', 'A']);
    // Read off the rows rather than by class alone: the movement headers carry
    // the same clock class, since a header's jump shows a time too.
    expect(
      markerRows(container).map((row) => row.querySelector('.player-marker-time')?.textContent),
    ).toEqual(['00:10', '00:20', '15:00']);
    expect(api.get('p1')?.markers.map((m) => m.time)).toEqual([10, 20, 900]);
  });
});

describe('saving follows what the project is (T56)', () => {
  it('saves a private project as the student works, with nothing to commit', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));

    await waitFor(() => expect(api.get('p1')?.markers).toEqual([]));
    // Nothing outside the owner's own account was at risk, so there is no
    // commit to make and no consequence to name.
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByText(/returns it to review/i)).toBeNull();
    expect(markerRows(container)).toHaveLength(0);
    // The line reports the write it made, in the autosave's own tense. Read
    // off the state, not the words: "Saved" is also what an untouched record
    // reads, so the text alone could not tell a landed write from no write.
    expect(screen.getByRole('status')).toHaveAttribute('data-save-status', 'saved');
  });

  it('saves a public project still awaiting review without a commit', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(
      project({
        publicationStatus: 'pending',
        markers: [marker('m1', 10)],
      }),
    );
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));

    await waitFor(() => expect(api.get('p1')?.markers).toEqual([]));
    // Already in the queue: a write costs the owner nothing, so it takes no
    // decision.
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(markerRows(container)).toHaveLength(0);
  });

  it('holds a rejected project’s edits for a commit too — it is awaiting another look', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(
      project({
        publicationStatus: 'rejected',
        markers: [marker('m1', 10)],
      }),
    );
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // Rejected is the other state a write disturbs: the same consequence, and
    // the same control, as a published project.
    expect(screen.getByText(/returns it to review/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));

    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    expect(markerRows(container)).toHaveLength(0);

    await pastDebounce();

    // An uncommitted record writes nothing, however long the page is left.
    expect(api.saveProject).not.toHaveBeenCalled();
    expect(api.get('p1')?.markers).toEqual([marker('m1', 10)]);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    expect(api.get('p1')?.markers).toEqual([]);
  });

  it('writes nothing to a published project until the owner commits, and names the consequence first', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // The consequence is on the page before the first write, not after it.
    expect(screen.getByText(/returns it to review/i)).toHaveTextContent(
      /takes it off the public gallery/i,
    );
    expect(screen.getByText(/trusted user/i)).toHaveTextContent(/publish immediately/i);

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));

    // The edit is in hand and the line says so — "unsaved", not "saving".
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    expect(markerRows(container)).toHaveLength(0);

    await pastDebounce();

    // However long the page is left, an uncommitted record writes nothing.
    expect(api.saveProject).not.toHaveBeenCalled();
    expect(api.get('p1')?.markers).toEqual([marker('m1', 10)]);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    expect(api.get('p1')?.markers).toEqual([]);
  });

  it('reports a committed save that returned the project to the queue', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    // The fake server's review trigger demoted it; the line says what happened
    // rather than claiming a plain save.
    expect(api.get('p1')?.publicationStatus).toBe('pending');
    expect(await screen.findByText('Saved — back to review')).toBeInTheDocument();
  });

  it('says so when a commit fails, rather than appearing to have succeeded', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    api.failNext('saveProject');
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/save failed/i);
    // Nothing was stored, and the record is still in hand to retry.
    expect(api.get('p1')?.markers).toEqual([marker('m1', 10)]);
    expect(markerRows(container)).toHaveLength(0);
  });

  it('leaves an uncommitted published project untouched on the way out', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { navigateTo } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    // Work only its owner can settle does not leave on a link press any more
    // (T60): the page asks, and discarding is the answer that lets it go.
    await navigateTo('/help');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await screen.findByRole('heading', { name: 'Help' });
    await pastDebounce();

    // Leaving is not committing: the teardown of a waiting record writes
    // nothing, so the server still holds the mark the owner did not save past.
    expect(api.saveProject).not.toHaveBeenCalled();
    expect(api.get('p1')?.markers).toEqual([marker('m1', 10)]);
  });

  it('settles a private project’s pending work on the way out', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { navigateTo } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // Left inside the debounce window: the teardown is what settles it.
    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await navigateTo('/help');
    await screen.findByRole('heading', { name: 'Help' });

    await waitFor(() => expect(api.get('p1')?.markers).toEqual([]));
  });
});

describe('leaving with unsaved changes (T60)', () => {
  it('asks before an in-app navigation away from work the owner has not committed', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    // Public and published: the mode that waits for a deliberate commit.
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { currentPath, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/projects/p1/markings',
    });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();

    await navigateTo('/help');

    // The router held where it was, and the page is asking.
    expect(currentPath()).toBe('/projects/p1/markings');
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/unsaved changes/i);
    expect(screen.queryByRole('heading', { name: 'Help' })).toBeNull();
  });

  it('stays put with the work intact when the owner declines, and asks again next time', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, currentPath, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/projects/p1/markings',
    });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await navigateTo('/help');
    await user.click(screen.getByRole('button', { name: 'Stay' }));

    // Nowhere moved, the question is answered and gone, and the edit is still
    // in hand — declining costs the owner nothing.
    expect(currentPath()).toBe('/projects/p1/markings');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(markerRows(container)).toHaveLength(0);
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    expect(api.get('p1')?.markers).toEqual([marker('m1', 10)]);

    // Declining refused *that* navigation, it did not spend the guard: the
    // next attempt is a fresh question rather than a page that can now be
    // walked out of.
    await navigateTo('/help');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(currentPath()).toBe('/projects/p1/markings');
  });

  it('prompts when the owner clicks their way out through the navbar', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { currentPath } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    // The everyday exit: a link in the navbar, which navigates through the
    // router rather than through anything this page owns.
    await user.click(screen.getByRole('link', { name: 'Help' }));

    expect(currentPath()).toBe('/projects/p1/markings');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('opening the project again shows what the server holds, not the discarded draft', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, currentPath, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/projects/p1/markings',
    });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await navigateTo('/help');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await screen.findByRole('heading', { name: 'Help' });

    await navigateTo('/projects/p1/markings');
    await waitForPlayerSettled();

    // The mark the owner walked away from is still there. Nothing was written
    // on the way out and no draft was kept to paint over the server's row, so
    // the page the owner comes back to is the page the server describes.
    expect(currentPath()).toBe('/projects/p1/markings');
    expect(markerTimes(container)).toEqual(['00:10']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('leaves without a word when there is nothing uncommitted to lose', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { currentPath } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // A published project, but one whose owner has touched nothing: there is
    // no commit outstanding, so leaving is not a decision to put to them — and
    // the same navbar link that would raise the question stays a plain link.
    await user.click(screen.getByRole('link', { name: 'Help' }));

    expect(await screen.findByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(currentPath()).toBe('/help');
  });

  it('does not stand in the way of a recording that saves itself — leaving writes it', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { currentPath, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/projects/p1/markings',
    });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await navigateTo('/help');

    // An autosaving record has nothing for its owner to answer for: the
    // teardown settles the work on the way out rather than asking about it.
    expect(await screen.findByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(currentPath()).toBe('/help');
    await waitFor(() => expect(api.get('p1')?.markers).toEqual([]));
  });

  it('refuses the browser’s Back button as well — a Back press is not a way past the question', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    // Arrived at the page from Help, so Back is a real history move off it.
    const { currentPath, go, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/help',
    });
    await navigateTo('/projects/p1/markings');
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await go(-1);

    expect(currentPath()).toBe('/projects/p1/markings');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // And the same prompt answers it: discarding is what lets Back through.
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(currentPath()).toBe('/help');
  });

  it('stands the page’s shortcuts down while the question is up', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/projects/p1/markings',
    });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(60));

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await navigateTo('/help');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // The question is about the work, so nothing answers it on the owner's
    // behalf: a mark placed now would be editing the thing being asked about,
    // and a seek would move the recording out from under the answer.
    await user.keyboard('m');
    await user.keyboard('{ArrowRight}');
    expect(markerRows(container)).toHaveLength(0);
    expect(controller.getCurrentTime()).toBe(60);

    // Answering hands the page back, keys and all.
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    await user.keyboard('m');
    expect(markerRows(container)).toHaveLength(1);
  });

  it('stands the correction keys down with the rest — the prompt takes the whole keyboard', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/projects/p1/markings',
    });
    await waitForPlayerSettled();

    // The playhead on a mark, then an exit asked for.
    await user.click(markerRows(container)[0]);
    await user.click(screen.getByRole('button', { name: 'Delete marker B' }));
    await navigateTo('/help');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // The `inert` gate is the one above every key, and the correction keys are
    // the pair a question about the work could most easily miss: they are the
    // keys that move a mark without a pointer. A nudge now would move the very
    // mark the owner is being asked whether to keep.
    pressNudge(']');
    pressNudge('[', true);
    expect(timeField(container)).toHaveValue('00:10.000');
  });

  it('holds the keyboard inside the question, so the page behind it cannot be edited', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, currentPath, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/projects/p1/markings',
    });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await navigateTo('/help');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // The two answers are the whole of the keyboard while the question stands:
    // Tab out of the last one comes back to the first. Without the wrap it
    // walks on into the page — Save changes, Add marker — and a Return there
    // would commit or edit the very work the owner is being asked about.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Discard changes' })).toHaveFocus();

    // Nothing behind the question was reached, and nothing was edited.
    expect(markerRows(container)).toHaveLength(1);
    expect(currentPath()).toBe('/projects/p1/markings');
  });

  it('refuses to leave while a commit is in flight — the server has not answered yet', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    const seeded = project({ markers: [marker('m1', 10)] });
    api.seed(seeded);
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { currentPath, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/projects/p1/markings',
    });
    await waitForPlayerSettled();

    // A commit asked for but not landed: the write is held open, so the page
    // sits between the state it was in and the state the server will answer
    // with. The Save control knows the difference — it goes down for the
    // duration — and so must the exit.
    let land: (() => void) | undefined;
    vi.mocked(api.saveProject).mockImplementation(
      () =>
        new Promise<ServerProject>((resolve) => {
          land = () => resolve(seeded);
        }),
    );

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled(),
    );

    await navigateTo('/help');

    // Requesting the commit is not making it: left now, a write that rejects
    // would come back to a disposed autosave with nothing left to retry it,
    // and the owner would never be asked.
    expect(currentPath()).toBe('/projects/p1/markings');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // And the answer still settles it: the held write lands and the page is
    // free to go.
    await act(async () => {
      land?.();
    });
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('heading', { name: 'Help' })).toBeInTheDocument();
  });

  it('asks the browser before the tab is closed or reloaded, while work is uncommitted', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // Nothing uncommitted yet: the tab may go.
    expect(closeTheTab()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();

    // The router's prompt cannot reach this exit — closing and reloading are
    // the browser's own — so the browser is asked to put its confirm up.
    expect(closeTheTab()).toBe(true);
  });

  it('stops asking once the work is committed', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.get('p1')?.markers).toEqual([]));

    // The commit settled it, so there is nothing left to lose and nothing
    // left to stand in the tab's way.
    expect(closeTheTab()).toBe(false);
  });

  it('asks the browser before the tab is closed on a project that saves itself, while an edit is in hand', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    // Private: the project that writes itself, and so asks nothing of its
    // owner before an in-app exit. The tab's own exit is the other question.
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    expect(closeTheTab()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));

    // The edit is in memory and the debounce is a timer in this page: closing
    // the tab now kills both together, and a write never sent is not a write.
    // No teardown runs on a tab close either, so nothing else will settle it —
    // the browser's own confirm is the only thing that can ask.
    expect(closeTheTab()).toBe(true);
  });

  it('asks the browser before the tab is closed on a project that saves itself, when its last write failed', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    api.failNext('saveProject');
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));

    // The debounce fires and the write is refused. A parked failure retries on
    // the next mutation and not on a clock, so nothing writes this record
    // again however long the page is left — the edit is still only in memory,
    // and closing the tab hours later still loses it.
    expect(await screen.findByRole('alert')).toHaveTextContent(/save failed/i);
    await pastDebounce();
    expect(api.saveProject).toHaveBeenCalledTimes(1);
    expect(closeTheTab()).toBe(true);
  });

  it('leaves a project that saves itself without a word when there is nothing pending', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    expect(closeTheTab()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete marker A' }));
    await waitFor(() => expect(api.get('p1')?.markers).toEqual([]));

    // The write landed, so the server holds what the record holds and the tab
    // is free again: the guard is what the record still owes the server, not
    // the fact that it was ever edited.
    await waitFor(() => expect(closeTheTab()).toBe(false));
  });
});

describe('the way into the markings page (T55)', () => {
  it('opens from the marks panel of the practice surface — the door where the marks are', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { currentPath } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();

    const panel = screen.getByRole('region', { name: 'Markers' });
    await user.click(within(panel).getByRole('link', { name: 'Markings' }));

    await waitFor(() => expect(currentPath()).toBe('/projects/p1/markings'));
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    await waitForPlayerSettled();
  });

  it('opens from a workspace list row — the same page reached without the player (T61)', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    // The workspace list belongs to a signed-in owner, so a session is
    // published before the app mounts: `setUser` fires the backend's session
    // event, which is how the app learns the user (it beats the controller's
    // own restore read — controller.ts's `sessionEventSeen`). Signing in
    // through the navbar would exercise the same state by a longer road this
    // test is not about.
    const auth = mockAuth();
    auth.backend.setUser({ id: 'u1', name: 'Ava Cellist', email: 'ava@example.com' });
    const { currentPath } = renderApp({ api, controller, auth });
    expect(currentPath()).toBe('/projects');

    // The list itself, before the door is touched: `currentPath` above only
    // echoes the fixture's own entry, so the row on screen is what proves the
    // shell painted the workspace rather than the landing.
    expect(await screen.findByText('Brahms Op. 118 No. 2')).toBeInTheDocument();

    // The row is reached from the list itself — no player was opened first,
    // which is the whole point: a project can be filled without hearing it.
    await user.click(screen.getByRole('button', { name: 'Markings for Brahms Op. 118 No. 2' }));

    await waitFor(() => expect(currentPath()).toBe('/projects/p1/markings'));
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    await waitForPlayerSettled();
    // The same page the panel's door opens, and not a lookalike: this is the
    // authoring surface, which the practice surface never shows (T55). One
    // page, one name, two ways in.
    expect(screen.getByRole('button', { name: 'Add marker' })).toBeInTheDocument();
  });

  it('offers no way in from the read-only public view — reading stays reading', async () => {
    const api = fakeProjectsApi();
    api.seed(project());
    renderApp({ api, initialEntry: '/gallery/p1' });
    await waitForPlayerSettled();

    expect(
      within(screen.getByRole('region', { name: 'Markers' })).queryByRole('link'),
    ).toBeNull();
  });
});

describe('the delete control is a trash glyph (T66)', () => {
  /** The `<path>` inside a control's glyph — what a pointer actually lands on. */
  function glyphPath(name: string): SVGPathElement {
    const path = screen.getByRole('button', { name }).querySelector('path');
    if (path === null) throw new Error(`The delete control "${name}" shows no glyph.`);
    return path;
  }

  it('shows a glyph rather than the word, and keeps what each control destroys as its name', async () => {
    const api = fakeProjectsApi();
    api.seed(multiMovement({ markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    const controls = [
      { name: 'Delete marker A', control: screen.getByRole('button', { name: 'Delete marker A' }) },
      {
        name: 'Delete movement I. Allegro',
        control: screen.getByRole('button', { name: 'Delete movement I. Allegro' }),
      },
    ];

    for (const { name, control } of controls) {
      // The word is gone from the panel, and the control is still found by it —
      // and says it to a pointer, which has no screen reader to hear it from.
      expect(control.textContent).toBe('');
      expect(control).toHaveAttribute('title', name);

      // The glyph is drawn, not read: it says nothing of its own, and it carries
      // no ink of its own either — the control's is the icon's.
      const glyph = control.querySelector('svg');
      expect(glyph).not.toBeNull();
      expect(glyph).toHaveAttribute('aria-hidden', 'true');
      expect(glyph?.querySelector('path')).toHaveAttribute('stroke', 'currentColor');
      expect(glyph?.querySelector('path')).toHaveAttribute('fill', 'none');
    }
  });

  it('is the delete and not a row jump when the click lands on the glyph itself', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // The pointer lands on the `<path>` inside the SVG rather than on the button
    // around it, so the control that deletes is the one the click has to reach.
    await user.click(glyphPath('Delete marker A'));

    // The delete and *not* a jump: the recording is still where it was, so the
    // click reached the control and stopped there.
    expect(controller.getCurrentTime()).toBe(0);
    expect(markerTimes(container)).toEqual(['00:20']);
    expect(markerTitles(container)).toEqual(['A']);
    await waitFor(() => expect(api.get('p1')?.markers.map((m) => m.id)).toEqual(['m2']));
  });

  it('raises a movement’s question from the glyph, and still answers it with the word', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(multiMovement());
    const controller = mockController({ load: vi.fn(async () => ({ duration: 1800 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(glyphPath('Delete movement I. Allegro'));

    // The glyph replaces the control that asks, not the one that answers: the
    // decision is still put in words, and taken in one.
    expect(screen.getByText(/^Delete “I\. Allegro”\?/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(movementNameFields(container)).toHaveLength(1);
    // The marks the boundary held are still there, regrouped by the rule left.
    expect(markerRows(container)).toHaveLength(3);
    await pastDebounce();
    expect(api.get('p1')?.movements.map((m) => m.name)).toEqual(['II. Adagio']);
  });
});
