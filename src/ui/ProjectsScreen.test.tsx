import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { labelSetRow } from '../test/commons-fixture';
import type { ProjectSummary } from '../storage';
import { ProjectsScreen } from './ProjectsScreen';
import type { ProjectsScreenProps } from './ProjectsScreen';

function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'project-1',
    name: 'Brahms Op. 118 No. 2',
    duration: 123.456,
    markerCount: 2,
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
    authKind: 'signed-in',
    commonsRows: null,
    onSubmitToCommons: vi.fn(),
    onSignIn: vi.fn(),
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

describe('ProjectsScreen Commons submission', () => {
  const youtube = () => summary();

  it('offers the submit action to a signed-in contributor — every project is a YouTube project', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ projects: [youtube()] });

    await user.click(screen.getByRole('button', { name: 'Submit to Commons' }));
    expect(props.onSubmitToCommons).toHaveBeenCalledWith('project-1');
  });

  it('re-labels the action "Update submission" once the project has a Commons row', () => {
    renderScreen({
      projects: [youtube()],
      commonsRows: { 'project-1': labelSetRow({ id: 'project-1', publication_status: 'pending' }) },
    });
    expect(screen.getByRole('button', { name: 'Update submission' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit to Commons' })).not.toBeInTheDocument();
  });

  it.each([
    ['pending', 'Pending review'],
    ['published', 'Published'],
    ['rejected', 'Rejected'],
  ] as const)('shows the %s status badge the contributor can read', (status, text) => {
    renderScreen({
      projects: [youtube()],
      commonsRows: { 'project-1': labelSetRow({ id: 'project-1', publication_status: status }) },
    });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('routes a signed-out contributor\'s click to sign-in, not to submit', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ projects: [youtube()], authKind: 'anonymous' });

    await user.click(screen.getByRole('button', { name: 'Sign in to submit' }));
    expect(props.onSignIn).toHaveBeenCalled();
    expect(props.onSubmitToCommons).not.toHaveBeenCalled();
  });

  it('disables the action on an unconfigured deployment, with the reason on the button', () => {
    renderScreen({ projects: [youtube()], authKind: 'unavailable' });

    // The label falls through to the sign-in wording — only 'signed-in' shows
    // "Submit to Commons" — but the button is inert and explains why.
    const button = screen.getByRole('button', { name: 'Sign in to submit' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/isn't set up/));
  });

  it('disables the row\'s submit button while one submission runs — other row actions stay live', () => {
    renderScreen({ projects: [youtube()], submittingId: 'project-1' });
    expect(screen.getByRole('button', { name: /Submitting/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rename' })).not.toBeDisabled();
  });
});

describe('ProjectsScreen empty state', () => {
  it('points at pasting a YouTube link and hides the list', () => {
    renderScreen({ projects: [] });
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByText(/paste a YouTube link/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/Total used/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /browse/i })).not.toBeInTheDocument();
  });
});
