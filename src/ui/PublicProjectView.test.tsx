import { MemoryRouter, Route, Routes } from 'react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ServerProject } from '../projects/types';
import { mockController } from '../test/controller-fixture';
import { marker } from '../test/marker-fixture';
import { fakeProjectsApi } from '../test/projects-fixture';
import { serverProject } from '../test/server-project-fixture';
import { waitForPlayerSettled } from '../test/settle-player';
import { PublicProjectView } from './PublicProjectView';

/** A public project the gallery read returns, with one movement and marks in it. */
function publicProject(overrides: Partial<ServerProject> = {}): ServerProject {
  return serverProject({
    id: '7f8f4a10-2c3e-4b1a-9d5b-6a0e8f9c1d2e',
    name: 'Honeck Tchaikovsky 5',
    recordingTitle: 'Tschaikowsky: 5. Sinfonie — hr-Sinfonieorchester, Manfred Honeck',
    videoId: 'a_B02BZp-5Y',
    duration: 3036,
    markers: [marker('m1', 10, ['I. Andante']), marker('m2', 20, ['II. Andante'])],
    movements: [{ id: 'mv1', name: 'I. Andante', start: 5 }],
    ...overrides,
  });
}

/** The rows in the marker list — the read-only surface's navigable marks. */
function markerRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.player-marker-row'));
}

/** Renders the read-only view on one project, with a mocked controller. */
function renderView(project: ServerProject | null, { fail = false }: { fail?: boolean } = {}) {
  const api = fakeProjectsApi();
  if (project !== null) api.seed(project);
  if (fail) api.failNext('getPublicProject');
  const controller = mockController({ load: vi.fn(async () => ({ duration: 3036 })) });
  const view = render(
    <MemoryRouter initialEntries={[`/gallery/${project?.id ?? 'missing'}`]}>
      <Routes>
        <Route
          path="/gallery/:id"
          element={<PublicProjectView api={api} controllerFactory={() => controller} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, controller, api };
}

describe('PublicProjectView', () => {
  it('plays the project read-only, markers grouped under their movement header', async () => {
    const project = publicProject();
    const { container } = renderView(project);

    // The read-only player is the same playback player — the project name
    // over the settled recording.
    expect(await screen.findByRole('heading', { name: project.name })).toBeInTheDocument();
    await waitForPlayerSettled();

    // Markers render under the movement header the domain assigns them.
    const header = container.querySelector('.player-movement-header');
    expect(header).not.toBeNull();
    expect(header).toHaveTextContent('I. Andante');
    expect(markerRows(container)).toHaveLength(2);

    // Read-only means no edit or copy affordance anywhere on the surface.
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete marker' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Playback' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Label' })).not.toBeInTheDocument();
  });

  it('shows the not-found page when the project is not visible, with the way back to the gallery', async () => {
    renderView(null);

    expect(await screen.findByRole('heading', { name: 'This project could not be found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Gallery' })).toBeInTheDocument();
  });

  it('surfaces a read failure as its own error — not the not-found page', async () => {
    renderView(publicProject(), { fail: true });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /couldn’t open that project/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'This project could not be found' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Gallery' })).toBeInTheDocument();
  });
});
