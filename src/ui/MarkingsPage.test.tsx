import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LoadOptions } from '../audio';
import { canonicalYouTubeUrl } from '../domain';
import type { ServerProject } from '../projects/types';
import { renderApp } from '../test/app-fixture';
import { mockController } from '../test/controller-fixture';
import { marker } from '../test/marker-fixture';
import { fakeProjectsApi } from '../test/projects-fixture';
import { stubRevealGeometry } from '../test/reveal-fixture';
import { serverProject } from '../test/server-project-fixture';
import { waitForPlayerSettled } from '../test/settle-player';

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

/** The marker rows, in DOM order (which is time order). */
function markerRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.player-marker-row'));
}

/** The rows' derived labels, in DOM order. */
function markerTitles(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.player-marker-title')).map((t) => t.textContent);
}

/** The rows' clocks, in DOM order. */
function markerTimes(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.player-marker-time')).map((t) => t.textContent);
}

/** The alias fields, in DOM order — one per row, on the authoring rows. */
function aliasFields(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('.markings-row-alias'));
}

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
 * The row the page is showing as selected (T57) — the one carrying the
 * correction block, found by the attribute rather than the class so the test
 * asserts what a reader is told, not only what is coloured.
 */
function selectedRow(container: HTMLElement): HTMLElement | null {
  return container.querySelector('li[aria-current="true"]');
}

/** The selected mark's time field — the exact place a correction is read and typed. */
function timeField(container: HTMLElement): HTMLInputElement {
  const field = container.querySelector<HTMLInputElement>('.markings-row-time');
  if (field === null) throw new Error('No time field — no mark is selected.');
  return field;
}

/** One of the selected row's nudge controls, by the words it shows. */
function nudgeControl(direction: 'earlier' | 'later'): HTMLElement {
  return screen.getByRole('button', { name: direction === 'earlier' ? '−0.1s' : '+0.1s' });
}

/**
 * Nudges from the keyboard. The bracket keys are userEvent's own descriptor
 * syntax, so the press is dispatched directly — the same keydown the hook
 * listens for, Shift included.
 */
function pressNudge(key: '[' | ']', shift = false): void {
  // A real keyboard reports the shifted character — Shift+[ arrives as "{".
  const shifted = key === '[' ? '{' : '}';
  fireEvent.keyDown(window, { key: shift ? shifted : key, shiftKey: shift });
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
    // Grouped by movement, with the leading sequence named as such.
    expect(screen.getByRole('button', { name: /II\. Andante/ })).toBeInTheDocument();
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
    expect(markerTimes(container)).toEqual(['00:42']);
    // Placing a mark is a listening gesture: the recording kept playing.
    expect(controller.getPlaybackState().playing).toBe(true);
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.seek).toHaveBeenLastCalledWith(42);
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

    expect(markerTimes(container)).toEqual(['00:10', '00:20', '00:30']);
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

    expect(markerTimes(container)).toEqual(['00:15']);
    // The column stays open to a second mark — the control does not disappear
    // with the empty state that carried it.
    act(() => controller.seek(45));
    await user.click(screen.getByRole('button', { name: 'Add marker' }));
    expect(markerTimes(container)).toEqual(['00:15', '00:45']);
  });

  it('names a mark with the student’s own word, and clears it again', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    // Private, so the work saves itself and the server's copy is the assertion.
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    const fields = aliasFields(container);
    expect(fields).toHaveLength(2);
    await user.type(fields[0], 'Meno');
    await user.tab();

    await waitFor(() => expect(api.get('p1')?.markers[0].aliases).toEqual(['Meno']));
    expect(fields[0]).toHaveValue('Meno');
    // An alias is a name, not a mark: typing into the field placed nothing.
    expect(markerRows(container)).toHaveLength(2);

    await user.clear(fields[0]);
    await user.tab();

    await waitFor(() => expect(api.get('p1')?.markers[0].aliases).toEqual([]));
    expect(fields[0]).toHaveValue('');
  });

  it('refuses an alias that breaks a rule, with the domain’s own guidance', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    const field = aliasFields(container)[0];
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

    const [first, second] = aliasFields(container);
    await user.type(first, 'seventeen chars!!');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 16 characters/i);

    // A rule broken on one mark is that mark's complaint. Naming a different
    // one successfully says nothing about it, so the refusal outlives it —
    // otherwise the refused text sits in its field unexplained.
    await user.type(second, 'Recap');
    await user.tab();

    await waitFor(() => expect(api.get('p1')?.markers[1].aliases).toEqual(['Recap']));
    expect(screen.getByRole('alert')).toHaveTextContent(/at most 16 characters/i);
    expect(first).toHaveValue('');
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
  it('selects a mark by clicking it, and says which one is selected', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // Nothing is selected until the student picks a mark: the column opens as
    // the list it is.
    expect(selectedRow(container)).toBeNull();
    expect(container.querySelector('.markings-correct')).toBeNull();

    await user.click(markerRows(container)[0]);

    // The row holding the playhead and the row being corrected are different
    // facts — the first moves on its own, the second is a choice — so the
    // selection is the row that was clicked, and it is named for a reader
    // rather than only coloured.
    const selected = selectedRow(container);
    expect(selected).not.toBeNull();
    expect(within(selected!).getByText('A')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Correct marker A' })).toBeInTheDocument();
    // Clicking still jumps: selecting a mark is how it gets heard.
    expect(controller.getCurrentTime()).toBe(10);
  });

  it('nudges the selected mark a tenth of a second either way from the bracket keys', async () => {
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
  });

  it('nudges a whole second with Shift, and both controls carry the same step', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);

    pressNudge(']', true);
    expect(await screen.findByDisplayValue('00:11.000')).toBeInTheDocument();

    pressNudge('[', true);
    expect(await screen.findByDisplayValue('00:10.000')).toBeInTheDocument();

    // The pointer's way to the same two steps, as Add marker is the pointer's
    // way to `M`: the keys alone would leave the corrections unreachable
    // without a keyboard, and Shift-click carries the coarse step they carry.
    await user.click(nudgeControl('earlier'));
    expect(await screen.findByDisplayValue('00:09.900')).toBeInTheDocument();
    await user.click(nudgeControl('later'));
    expect(await screen.findByDisplayValue('00:10.000')).toBeInTheDocument();

    await user.keyboard('{Shift>}');
    await user.click(nudgeControl('later'));
    await user.keyboard('{/Shift}');
    expect(await screen.findByDisplayValue('00:11.000')).toBeInTheDocument();
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
    // time it does hold, and nothing was written.
    expect(field).toHaveValue('00:10.000');
    await pastDebounce();
    expect(api.get('p1')?.markers[0].time).toBe(10);
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
    // be announced a second time when the mark was next selected.
    expect(await screen.findByDisplayValue('00:10.100')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('holds the row being corrected still when a correction takes the playhead from it', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    // The playhead sits past the second mark, so the second mark holds it.
    await user.click(markerRows(container)[1]);
    act(() => controller.emitPlayback({ currentTime: 22, duration: 372 }));

    const list = container.querySelector('.player-marker-list') as HTMLElement;
    const rows = markerRows(container).map((button) => button.closest('li') as HTMLElement);
    // B is at the band's top and A is far below it, so a reveal aimed at either
    // lands somewhere unmistakable.
    stubRevealGeometry(list, rows[1], {
      scrollTop: 200,
      clientHeight: 320,
      scrollHeight: 2000,
      listTop: 100,
      listBottom: 420,
      rowTop: 300,
      rowBottom: 330,
    });
    stubRevealGeometry(list, rows[0], {
      scrollTop: 200,
      clientHeight: 320,
      scrollHeight: 2000,
      listTop: 100,
      listBottom: 420,
      rowTop: 900,
      rowBottom: 930,
    });

    // B moves past the playhead, so A takes it — and following the active row
    // would carry B's correction block out of the band with it, just as the
    // student was reading the time they had given it. The row being corrected
    // is the row they are working on, and it stays where they put it.
    const field = timeField(container);
    await user.clear(field);
    await user.type(field, '0:25');
    await user.keyboard('{Enter}');

    expect(await screen.findByDisplayValue('00:25.000')).toBeInTheDocument();
    expect(list.scrollTop).toBe(200);

    // Not a panel that has stopped revealing: picking another mark out hands
    // the list back, and the mark picked — A, far below the band — comes to its
    // top. The playhead is still audible throughout; the list is the student's
    // while they are working on a mark, and the playhead's again after.
    await user.click(markerRows(container)[0]);
    expect(list.scrollTop).toBe(1000);
  });

  it('changes nothing about playback: the recording keeps playing as it was', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ playing: true, duration: 372 }));

    await user.click(markerRows(container)[0]);
    // The click's own jump is the selection's; from here on nothing moves the
    // playhead.
    const jumps = vi.mocked(controller.seek).mock.calls.length;

    pressNudge(']');
    pressNudge(']', true);
    const field = timeField(container);
    await user.clear(field);
    await user.type(field, '12');
    await user.keyboard('{Enter}');

    // Correcting a mark is a correction, not a transport: the student is still
    // hearing what they were hearing, from where they were hearing it.
    expect(controller.getPlaybackState().playing).toBe(true);
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(vi.mocked(controller.seek).mock.calls.length).toBe(jumps);
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

    expect(markerTimes(container)).toEqual(['00:20', '00:25']);
    expect(markerTitles(container)).toEqual(['A', 'B']);
    // The selection follows the mark it was on, not the position it held.
    expect(within(selectedRow(container)!).getByText('B')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.get('p1')?.markers).toEqual([
        expect.objectContaining({ id: 'm1', time: 25 }),
        expect.objectContaining({ id: 'm2', time: 20 }),
      ]),
    );
  });

  it('selects the mark the arrow keys land on, so the nudge is reachable by keyboard', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.keyboard('{ArrowDown}');

    // ↑/↓ are how this panel is walked, so on this page the mark a walk lands
    // on is the mark being worked on — otherwise the nudge keys could never
    // reach a mark without a pointer.
    expect(controller.getCurrentTime()).toBe(10);
    expect(within(selectedRow(container)!).getByText('A')).toBeInTheDocument();

    pressNudge(']');
    expect(await screen.findByDisplayValue('00:10.100')).toBeInTheDocument();
  });

  it('corrects a mark while the recording is still loading — a correction is not playback', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10)] }));
    // A load that never settles: the page is up and the marks are there, and
    // the recording is not.
    const controller = mockController({ load: vi.fn(() => new Promise<never>(() => {})) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' });

    await user.click(markerRows(container)[0]);
    pressNudge(']');

    // `M` waits for the recording, because it marks a playhead that means
    // nothing yet. A correction moves a mark the record already holds and asks
    // the recording for nothing — so it is not held back, and the keys agree
    // with the block's own controls rather than lagging them.
    expect(await screen.findByDisplayValue('00:10.100')).toBeInTheDocument();
  });

  it('moves the selection with the click, and drops it when the mark goes', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    await user.click(markerRows(container)[0]);
    expect(within(selectedRow(container)!).getByText('A')).toBeInTheDocument();

    await user.click(markerRows(container)[1]);
    expect(within(selectedRow(container)!).getByText('B')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Correct marker B' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete marker B' }));

    // A selection that outlived its mark would be a correction aimed at nothing.
    expect(selectedRow(container)).toBeNull();
    expect(container.querySelector('.markings-correct')).toBeNull();
  });

  it('corrects nothing with no mark selected — the keys are inert until one is', async () => {
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private', markers: [marker('m1', 10), marker('m2', 20)] }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1/markings' });
    await waitForPlayerSettled();

    pressNudge('[');
    pressNudge(']', true);
    await pastDebounce();

    expect(selectedRow(container)).toBeNull();
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
    const alias = aliasFields(container)[0];
    alias.focus();
    fireEvent.keyDown(alias, { key: '[' });
    fireEvent.keyDown(timeField(container), { key: ']' });
    await pastDebounce();

    expect(api.get('p1')?.markers[0].time).toBe(10);
  });

  it('offers no selection or correction on the practice surface, and the keys do nothing there', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(project({ visibility: 'private' }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();
    act(() => controller.emitPlayback({ duration: 372 }));

    // The practice surface stays playback-only (ADR-0003): clicking a row still
    // jumps and still does not select, and there is nothing to correct with.
    await user.click(markerRows(container)[0]);
    expect(selectedRow(container)).toBeNull();
    expect(container.querySelector('.markings-correct')).toBeNull();
    expect(container.querySelector('.markings-row-time')).toBeNull();

    pressNudge('[');
    pressNudge(']', true);
    await pastDebounce();

    expect(api.get('p1')?.markers.map((m) => m.time)).toEqual([10, 20]);
    expect(api.saveProject).not.toHaveBeenCalled();
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

    // A mark picked out to correct, then an exit asked for.
    await user.click(markerRows(container)[0]);
    await user.click(screen.getByRole('button', { name: 'Delete marker B' }));
    await navigateTo('/help');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // `[`/`]` are the one pair that sits above the settle gate (T57), because a
    // correction asks the recording for nothing — so they are the pair a
    // question about the work can most easily miss. A nudge now would move the
    // very mark the owner is being asked whether to keep.
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
