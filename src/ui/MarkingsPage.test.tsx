import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LoadOptions } from '../audio';
import { canonicalYouTubeUrl } from '../domain';
import { renderApp } from '../test/app-fixture';
import { mockController } from '../test/controller-fixture';
import { marker } from '../test/marker-fixture';
import { fakeProjectsApi } from '../test/projects-fixture';
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
    await navigateTo('/help');
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
