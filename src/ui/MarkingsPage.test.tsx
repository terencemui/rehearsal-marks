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
    const empty = screen.getByRole('region', { name: 'Markings' });
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
