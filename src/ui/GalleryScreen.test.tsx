import { MemoryRouter, useLocation } from 'react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { fakeProjectsApi } from '../test/projects-fixture';
import type { FakeProjectsApi } from '../test/projects-fixture';
import { serverProject } from '../test/server-project-fixture';
import { marker } from '../test/marker-fixture';
import { GalleryScreen } from './GalleryScreen';

/**
 * A published public project the gallery lists — a server row with the card's
 * facts, seeded through the fake's store the way a read would return it.
 */
function galleryProject(overrides: Partial<Parameters<typeof serverProject>[0]> = {}) {
  return serverProject({
    name: 'Honeck Tchaikovsky 5',
    recordingTitle: 'Tschaikowsky: 5. Sinfonie — hr-Sinfonieorchester, Manfred Honeck',
    videoId: 'a_B02BZp-5Y',
    duration: 3036,
    markers: Array.from({ length: 21 }, (_, i) => marker(`g${i}`, 10 + i)),
    ...overrides,
  });
}

/** Renders the gallery under a memory router, with a probe that records the path. */
function renderGallery(api: FakeProjectsApi = fakeProjectsApi(), initialEntry = '/') {
  let currentPath = '/';
  function Probe() {
    const location = useLocation();
    useEffect(() => {
      currentPath = location.pathname;
    }, [location.pathname]);
    return null;
  }
  const { container, unmount } = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Probe />
      <GalleryScreen api={api} />
    </MemoryRouter>,
  );
  return { currentPath: () => currentPath, container, unmount };
}

describe('GalleryScreen', () => {
  it('renders one card per recording, showing only the recording title', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject({ createdAt: 2_000 }));
    api.seed(
      galleryProject({
        id: 'p2',
        createdAt: 3_000,
        videoId: 'bbb_XXXXXXXXXX',
        recordingTitle: 'Bruckner: 7. Sinfonie — hr-Sinfonieorchester, Daniel Harding',
        name: 'Bruckner 7, first read',
      }),
    );

    renderGallery(api);

    const cards = await screen.findAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Manfred Honeck/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Daniel Harding/ })).toBeInTheDocument();
    // Each card's title is a heading inside its link — the grid is navigable
    // by heading as well as by list.
    expect(screen.getByRole('heading', { name: /Manfred Honeck/ })).toBeInTheDocument();

    // The card names the recording, never the owner's project or its counts.
    expect(screen.queryByText('Honeck Tchaikovsky 5')).not.toBeInTheDocument();
    expect(screen.queryByText(/markers?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/movements?/)).not.toBeInTheDocument();
  });

  it('collapses several projects on one video into a single card', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject({ createdAt: 1_000 }));
    api.seed(galleryProject({ id: 'p2', createdAt: 2_000 }));
    api.seed(galleryProject({ id: 'p3', createdAt: 3_000 }));

    renderGallery(api);

    expect(await screen.findAllByRole('link')).toHaveLength(1);
  });

  it('orders cards by each recording’s newest project, newest first, in DOM order', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject({ createdAt: 3_000 }));
    api.seed(
      galleryProject({
        id: 'p2',
        createdAt: 1_000,
        videoId: 'bbbbbbbbbbb',
        recordingTitle: 'Bruckner: 7. Sinfonie — hr-Sinfonieorchester, Daniel Harding',
      }),
    );
    api.seed(
      galleryProject({
        id: 'p3',
        createdAt: 2_000,
        videoId: 'ccccccccccc',
        recordingTitle: 'Strauss: Till Eulenspiegel — hr-Sinfonieorchester, Sebastian Weigle',
      }),
    );

    renderGallery(api);

    const cards = await screen.findAllByRole('link');
    expect(cards.map((card) => card.getAttribute('aria-label') ?? card.textContent)).toEqual([
      expect.stringContaining('Manfred Honeck'),
      expect.stringContaining('Sebastian Weigle'),
      expect.stringContaining('Daniel Harding'),
    ]);
  });

  describe('sort', () => {
    function seedThree(api: FakeProjectsApi) {
      api.seed(galleryProject({ createdAt: 3_000 }));
      api.seed(
        galleryProject({
          id: 'p2',
          createdAt: 1_000,
          videoId: 'bbbbbbbbbbb',
          recordingTitle: 'Bruckner: 7. Sinfonie — Daniel Harding',
        }),
      );
      api.seed(
        galleryProject({
          id: 'p3',
          createdAt: 2_000,
          videoId: 'ccccccccccc',
          recordingTitle: 'Strauss: Till Eulenspiegel — Sebastian Weigle',
        }),
      );
    }
    const titles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

    it('offers a labelled Newest/Oldest control, Newest selected first', async () => {
      const api = fakeProjectsApi();
      seedThree(api);
      renderGallery(api);

      const sort = await screen.findByRole('combobox', { name: 'Sort by' });
      expect(sort).toHaveValue('newest');
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Newest', 'Oldest']);
    });

    it('reverses the cards on Oldest, keeping the search and the URL', async () => {
      const user = userEvent.setup();
      const api = fakeProjectsApi();
      seedThree(api);
      renderGallery(api, '/?q=sinfonie');

      await user.selectOptions(await screen.findByRole('combobox', { name: 'Sort by' }), 'oldest');

      expect(titles()).toEqual([
        expect.stringContaining('Daniel Harding'),
        expect.stringContaining('Manfred Honeck'),
      ]);
      expect(screen.getByRole('status')).toHaveTextContent('2 recordings found.');
    });

    it('resets to Newest when the gallery remounts', async () => {
      const user = userEvent.setup();
      const api = fakeProjectsApi();
      seedThree(api);
      const first = renderGallery(api);
      await user.selectOptions(await screen.findByRole('combobox', { name: 'Sort by' }), 'oldest');
      first.unmount();

      renderGallery(api);

      expect(await screen.findByRole('combobox', { name: 'Sort by' })).toHaveValue('newest');
    });
  });

  it('opens the recording’s oldest published project at /gallery/:id', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(galleryProject({ id: 'oldest', createdAt: 1_000 }));
    api.seed(galleryProject({ id: 'newest', createdAt: 2_000 }));
    const { currentPath } = renderGallery(api);

    const card = await screen.findByRole('link', { name: /Manfred Honeck/ });
    expect(card).toHaveAttribute('href', '/gallery/oldest');

    await user.click(card);
    await waitFor(() => expect(currentPath()).toBe('/gallery/oldest'));
  });

  it('keeps the whole card when a project-name search matches a non-oldest project', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject({ id: 'oldest', name: 'First read', createdAt: 2_000 }));
    api.seed(galleryProject({ id: 'newest', name: 'Second read', createdAt: 3_000 }));

    renderGallery(api, '/?q=second');

    // The query matches only the newer project's name, but the search finds the
    // recording: its card is unchanged, still opening the recording's oldest
    // published set, the same target the unfiltered card has.
    expect(await screen.findByRole('link', { name: /Manfred Honeck/ })).toHaveAttribute(
      'href',
      '/gallery/oldest',
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('1 recording found.');
  });

  it('shows the high-resolution still, falling back to the medium one, then hiding', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    const { container } = renderGallery(api);

    await screen.findByRole('link', { name: /Manfred Honeck/ });
    const image = container.querySelector('.gallery-thumb')!;

    // The still is decorative — the card's title names the recording.
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('src', 'https://i.ytimg.com/vi/a_B02BZp-5Y/hq720.jpg');

    fireEvent.error(image);
    expect(image).toHaveAttribute('src', 'https://i.ytimg.com/vi/a_B02BZp-5Y/mqdefault.jpg');

    fireEvent.error(image);
    expect(image).toHaveAttribute('hidden');
  });

  it('labels the card with the recording’s whole-second duration', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    renderGallery(api);

    expect(await screen.findByText('50:36')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is published', async () => {
    renderGallery();

    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No public projects yet.');
  });

  it('keeps the status region mounted and empty without a query, and the subtitle gone', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    renderGallery(api);

    await screen.findByRole('link', { name: /Manfred Honeck/ });
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.queryByText('Published projects, newest first.')).not.toBeInTheDocument();
  });

  it('counts recordings, not projects, and says when none match', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(galleryProject({ createdAt: 1_000 }));
    api.seed(galleryProject({ id: 'p2', createdAt: 2_000 }));
    const { currentPath } = renderGallery(api, '/?q=nothing%20like%20this');

    expect(await screen.findByText('No recordings match “nothing like this”.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 recordings found.');
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(await screen.findAllByRole('link')).toHaveLength(1);
    expect(currentPath()).toBe('/');
  });

  it('surfaces a failed read as an error with a retry that re-runs the read', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    api.failNext('listPublishedProjects');
    renderGallery(api);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/couldn’t load the gallery/i)).toBeInTheDocument();

    // Retry re-runs the read; the fixture's one-shot failure is spent.
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /Manfred Honeck/ })).toBeInTheDocument();
  });
});
