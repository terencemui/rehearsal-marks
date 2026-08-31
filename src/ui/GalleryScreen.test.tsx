import { MemoryRouter, useLocation } from 'react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { mockProjectsApi } from '../test/projects-api-fixture';
import type { PublicProjectSummary } from '../projects';
import { GalleryScreen } from './GalleryScreen';

/** A gallery entry builder — a recording's project, defaults so tests name only what varies. */
function summary(overrides: Partial<PublicProjectSummary>): PublicProjectSummary {
  return {
    id: 'p1',
    name: 'Honeck Tchaikovsky 5',
    recordingTitle: 'Tschaikowsky: 5. Sinfonie — hr-Sinfonieorchester, Manfred Honeck',
    videoId: 'a_B02BZp-5Y',
    duration: 3036,
    markerCount: 21,
    createdAt: 3_000_000_000,
    ...overrides,
  };
}

/** Renders the gallery under a memory router, with a probe that records the path. */
function renderGallery(api = mockProjectsApi()) {
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
    const api = mockProjectsApi([
      summary({ id: 'p1', markerCount: 21, name: 'Honeck Tchaikovsky 5' }),
      summary({
        id: 'p2',
        videoId: 'bbb_XXXXXXXXXX',
        recordingTitle: 'Bruckner: 7. Sinfonie — hr-Sinfonieorchester, Daniel Harding',
        markerCount: 1,
        name: 'Bruckner 7, first read',
      }),
    ]);

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
    const api = mockProjectsApi([summary({ id: 'p1' })]);
    const { currentPath } = renderGallery(api);

    await user.click(
      await screen.findByRole('button', { name: /Honeck Tchaikovsky 5/ }),
    );

    await waitFor(() => expect(currentPath()).toBe('/gallery/p1'));
  });

  it('shows the empty state when nothing is published', async () => {
    renderGallery(mockProjectsApi([]));

    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
  });

  it('surfaces a failed read as an error with a retry that re-runs the read', async () => {
    const user = userEvent.setup();
    const api = mockProjectsApi([summary({ id: 'p1' })]);
    api.failNextRead('network down');
    renderGallery(api);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/couldn’t load the gallery/i)).toBeInTheDocument();

    // Retry re-runs the read; the fixture's one-shot failure is spent.
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Honeck Tchaikovsky 5/ })).toBeInTheDocument();
  });
});
