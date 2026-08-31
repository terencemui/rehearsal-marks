import { MemoryRouter, useLocation } from 'react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { fakeProjectsApi } from '../test/projects-fixture';
import type { FakeProjectsApi } from '../test/projects-fixture';
import { serverProject } from '../test/server-project-fixture';
import { marker } from '../test/marker-fixture';
import { GalleryScreen } from './GalleryScreen';

/**
 * A published public project the gallery lists — a server row with the entry's
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
function renderGallery(api: FakeProjectsApi = fakeProjectsApi()) {
  let currentPath = '/';
  function Probe() {
    const location = useLocation();
    useEffect(() => {
      currentPath = location.pathname;
    }, [location.pathname]);
    return null;
  }
  render(
    <MemoryRouter>
      <Probe />
      <GalleryScreen api={api} />
    </MemoryRouter>,
  );
  return { currentPath: () => currentPath };
}

describe('GalleryScreen', () => {
  it('renders recording-title groups, each entry showing the project name and marker count', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    api.seed(
      galleryProject({
        id: 'p2',
        videoId: 'bbb_XXXXXXXXXX',
        recordingTitle: 'Bruckner: 7. Sinfonie — hr-Sinfonieorchester, Daniel Harding',
        markers: [marker('b1', 34)],
        name: 'Bruckner 7, first read',
      }),
    );

    renderGallery(api);

    expect(
      await screen.findByRole('heading', { name: /Manfred Honeck/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Daniel Harding/ })).toBeInTheDocument();
    // Each entry is the name and the count, in the same row.
    expect(screen.getByRole('button', { name: /Honeck Tchaikovsky 5/ })).toBeInTheDocument();
    expect(screen.getByText('21 markers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bruckner 7, first read/ })).toBeInTheDocument();
    expect(screen.getByText('1 marker')).toBeInTheDocument();
  });

  it('opens a project at /gallery/:id', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    const { currentPath } = renderGallery(api);

    await user.click(
      await screen.findByRole('button', { name: /Honeck Tchaikovsky 5/ }),
    );

    await waitFor(() => expect(currentPath()).toBe('/gallery/project-1'));
  });

  it('shows the empty state when nothing is published', async () => {
    renderGallery();

    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
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
    expect(await screen.findByRole('button', { name: /Honeck Tchaikovsky 5/ })).toBeInTheDocument();
  });
});
