import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectSummary } from '../projects/types';
import { ProjectsScreen } from './ProjectsScreen';
import type { ProjectsScreenProps } from './ProjectsScreen';

function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'project-1',
    name: 'Brahms Op. 118 No. 2',
    recordingTitle: 'Brahms: Klavierstücke, Op. 118',
    duration: 123.456,
    markerCount: 2,
    visibility: 'public',
    publicationStatus: 'published',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Renders the screen with recording mocks; returns them plus the view. */
function renderScreen(overrides: Partial<ProjectsScreenProps> = {}) {
  const props: ProjectsScreenProps = {
    projects: [summary()],
    status: 'idle',
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onToggleVisibility: vi.fn(),
    ...overrides,
  };
  const view = render(<ProjectsScreen {...props} />);
  return { ...view, props };
}

describe('ProjectsScreen list', () => {
  it('shows name, duration, marker count, and last-modified', () => {
    renderScreen();
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
    // 1_700_000_000_000 ms is more than eight weeks old — the date fallback.
    expect(within(row).getByText(/2:03\.456 · 2 markers · 2023-11-14/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('shows no per-row YouTube badge — every project is a YouTube project', () => {
    renderScreen();
    expect(screen.queryByText('YouTube')).not.toBeInTheDocument();
  });

  it('uses singular "marker" for one marker', () => {
    renderScreen({ projects: [summary({ markerCount: 1 })] });
    expect(screen.getByText(/1 marker ·/)).toBeInTheDocument();
  });

  it('opens a project by clicking its row', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByText('Brahms Op. 118 No. 2'));
    expect(props.onOpen).toHaveBeenCalledWith('project-1');
  });

  it('disables rows while a workspace pipeline (a link create) runs', () => {
    renderScreen({ busy: true });
    expect(screen.getByRole('button', { name: /Brahms/ })).toBeDisabled();
  });

  it('renders the status line vocabulary', () => {
    renderScreen({ status: 'saving' });
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  });

  it('shows a notice as an alert when one is set', () => {
    renderScreen({ notice: 'Couldn’t open that project. Try again.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t open that project.');
  });
});

describe('ProjectsScreen rename', () => {
  it('commits a trimmed name on Enter and leaves the edit', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    const input = screen.getByRole('textbox', { name: 'Project name' });
    expect(input).toHaveValue('Brahms Op. 118 No. 2');
    await user.clear(input);
    await user.type(input, '  Brahms 2  {enter}');

    expect(props.onRename).toHaveBeenCalledWith('project-1', 'Brahms 2');
    expect(screen.queryByRole('textbox', { name: 'Project name' })).not.toBeInTheDocument();
  });

  it('commits on blur', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(props.onRename).toHaveBeenCalledWith('project-1', 'Renamed');
  });

  it('cancels on Escape without committing', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'x{Escape}');

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Project name' })).not.toBeInTheDocument();
  });

  it('treats an empty or unchanged name as a cancel', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    let input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, '   {enter}');
    expect(props.onRename).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    input = screen.getByRole('textbox', { name: 'Project name' });
    await user.type(input, '{enter}'); // unchanged — commits nothing
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Project name' })).not.toBeInTheDocument();
  });

  it('commits exactly once when a blur trails a commit', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'Renamed{enter}');
    // Real browsers fire blur when the committed input unmounts; jsdom does
    // not, so dispatch the trailing event the way a browser would.
    fireEvent.blur(input);

    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onRename).toHaveBeenCalledWith('project-1', 'Renamed');
  });
});

describe('ProjectsScreen delete', () => {
  it('requires confirmation, and Cancel walks it back', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(
      screen.getByText('Delete “Brahms Op. 118 No. 2”? This cannot be undone.'),
    ).toBeInTheDocument();
    expect(props.onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('deletes on the confirming click', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(props.onDelete).toHaveBeenCalledWith('project-1');
  });
});

describe('ProjectsScreen review and visibility', () => {
  it('shows the review badge for a public project', () => {
    renderScreen({ projects: [summary({ publicationStatus: 'pending' })] });
    expect(screen.getByText('Pending review')).toBeInTheDocument();
  });

  it.each([
    ['published', 'Published'],
    ['rejected', 'Rejected'],
  ] as const)('shows the %s badge for a public project', (status, text) => {
    renderScreen({ projects: [summary({ publicationStatus: status })] });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows a Private tag instead of a review badge for a private project', () => {
    renderScreen({ projects: [summary({ visibility: 'private', publicationStatus: 'pending' })] });
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.queryByText('Pending review')).not.toBeInTheDocument();
  });

  it('offers to make a public project private', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByRole('button', { name: 'Make private' }));
    expect(props.onToggleVisibility).toHaveBeenCalledWith('project-1');
  });

  it('offers to make a private project public, noting review re-entry', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ projects: [summary({ visibility: 'private' })] });
    const toggle = screen.getByRole('button', { name: 'Make public' });
    expect(toggle).toHaveAttribute('title', expect.stringMatching(/review again/));
    await user.click(toggle);
    expect(props.onToggleVisibility).toHaveBeenCalledWith('project-1');
  });

  it('disables the toggle while a workspace pipeline runs', () => {
    renderScreen({ busy: true });
    expect(screen.getByRole('button', { name: 'Make private' })).toBeDisabled();
  });
});

describe('ProjectsScreen empty state', () => {
  it('points at pasting a YouTube link and hides the list', () => {
    renderScreen({ projects: [] });
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByText(/paste a YouTube link/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
  });
});
