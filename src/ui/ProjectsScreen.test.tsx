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
    videoId: 'dQw4w9WgXcQ',
    duration: 123.456,
    markerCount: 2,
    naming: 'letters',
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
    onOpenMarkings: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onToggleVisibility: vi.fn(),
    onSetNaming: vi.fn(),
    ...overrides,
  };
  const view = render(<ProjectsScreen {...props} />);
  return { ...view, props };
}

/** Opens a card's "More" disclosure (T111) so its controls can be reached. */
async function openMore(
  user: ReturnType<typeof userEvent.setup>,
  name = 'Brahms Op. 118 No. 2',
) {
  await user.click(screen.getByRole('button', { name: `More for ${name}` }));
}

describe('ProjectsScreen list', () => {
  it('shows name, recording title, duration, marker count, and last-modified', () => {
    renderScreen();
    const card = screen.getByRole('listitem');
    expect(within(card).getByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
    expect(within(card).getByText('Brahms: Klavierstücke, Op. 118')).toBeInTheDocument();
    // Whole seconds, gallery-style — on the thumbnail's own chip.
    expect(within(card).getByText('2:03')).toBeInTheDocument();
    // 1_700_000_000_000 ms is more than eight weeks old — the date fallback.
    expect(within(card).getByText(/2 markers · 2023-11-14/)).toBeInTheDocument();
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

  it('opens a project’s markings page from its disclosure', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Markings/ }));
    expect(props.onOpenMarkings).toHaveBeenCalledWith('project-1');
  });

  it('offers the way in on every card, each opening its own project', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({
      projects: [summary(), summary({ id: 'project-2', name: 'Chopin Op. 28' })],
    });

    // Each door names its own project, so a reader walking the grid can tell
    // them apart — and so this test can put the finger on a card rather than
    // on a position. Only one card's disclosure is open at a time, so each
    // is opened, used, then closed by opening the next.
    await openMore(user, 'Brahms Op. 118 No. 2');
    await user.click(screen.getByRole('button', { name: 'Markings for Brahms Op. 118 No. 2' }));
    expect(props.onOpenMarkings).toHaveBeenLastCalledWith('project-1');

    await openMore(user, 'Chopin Op. 28');
    await user.click(screen.getByRole('button', { name: 'Markings for Chopin Op. 28' }));
    expect(props.onOpenMarkings).toHaveBeenLastCalledWith('project-2');
    expect(props.onOpenMarkings).toHaveBeenCalledTimes(2);
  });

  it('disables rows while a workspace pipeline (a link create) runs', () => {
    renderScreen({ busy: true });
    expect(screen.getByRole('button', { name: /^Brahms/ })).toBeDisabled();
  });

  it('holds the "More" disclosure inert while a workspace pipeline runs', () => {
    // The card disables its controls while a create runs, and the disclosure
    // trigger joins them (T61, T111) — gating every action behind it, since
    // a disabled trigger cannot be opened to reach what it holds.
    renderScreen({ busy: true });
    expect(screen.getByRole('button', { name: /^More/ })).toBeDisabled();
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

describe('ProjectsScreen "More" disclosure', () => {
  it('keeps the five actions out of the card face until "More" is opened', () => {
    renderScreen();
    expect(screen.queryByRole('button', { name: /^Markings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make private' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Naming/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('opens a disclosure holding all five actions', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openMore(user);
    const menu = screen.getByRole('group', { name: 'More for Brahms Op. 118 No. 2' });
    expect(within(menu).getByRole('button', { name: /^Markings/ })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Make private' })).toBeInTheDocument();
    expect(within(menu).getByRole('combobox', { name: /^Naming/ })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('toggles shut on a second click of "More"', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openMore(user);
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    await openMore(user);
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('disarms a pending delete confirmation when the disclosure closes', async () => {
    // Closing on an armed confirmation must not leave it armed — otherwise
    // reopening lands straight back on "Delete… cannot be undone", and a
    // single further click (which reads as a fresh first click) deletes,
    // silently skipping the two-step confirmation.
    const user = userEvent.setup();
    const { props } = renderScreen();
    await openMore(user);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      screen.getByText('Delete “Brahms Op. 118 No. 2”? This cannot be undone.'),
    ).toBeInTheDocument();

    await openMore(user); // closes the disclosure without confirming
    await openMore(user); // reopens it

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(
      screen.queryByText('Delete “Brahms Op. 118 No. 2”? This cannot be undone.'),
    ).not.toBeInTheDocument();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it('still opens the project directly from its thumbnail or title, bypassing the disclosure', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByRole('button', { name: 'Open Brahms Op. 118 No. 2' }));
    expect(props.onOpen).toHaveBeenCalledWith('project-1');
    await user.click(screen.getByText('Brahms Op. 118 No. 2'));
    expect(props.onOpen).toHaveBeenCalledTimes(2);
  });
});

describe('ProjectsScreen rename', () => {
  it('commits a trimmed name on Enter and leaves the edit', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await openMore(user);
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
    await openMore(user);
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
    await openMore(user);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'x{Escape}');

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Project name' })).not.toBeInTheDocument();
  });

  it('treats an empty or unchanged name as a cancel', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await openMore(user);
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
    await openMore(user);
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
    await openMore(user);
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
    await openMore(user);
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
    await openMore(user);
    await user.click(screen.getByRole('button', { name: 'Make private' }));
    expect(props.onToggleVisibility).toHaveBeenCalledWith('project-1');
  });

  it('offers to make a private project public, noting review re-entry', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ projects: [summary({ visibility: 'private' })] });
    await openMore(user);
    const toggle = screen.getByRole('button', { name: 'Make public' });
    expect(toggle).toHaveAttribute('title', expect.stringMatching(/review again/));
    await user.click(toggle);
    expect(props.onToggleVisibility).toHaveBeenCalledWith('project-1');
  });

  it('disables the "More" disclosure trigger while a workspace pipeline runs', () => {
    // The toggle lives behind the disclosure (T111); a disabled trigger
    // cannot be opened to reach it.
    renderScreen({ busy: true });
    expect(screen.getByRole('button', { name: /^More/ })).toBeDisabled();
  });
});

describe('ProjectsScreen naming', () => {
  /** The row's naming control — the select that says how the project names its marks. */
  function namingControl(): HTMLSelectElement {
    return screen.getByRole('combobox', { name: 'Naming for Brahms Op. 118 No. 2' });
  }

  it('shows how the project names its marks, and offers all three modes', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openMore(user);
    expect(namingControl()).toHaveValue('letters');
    expect(within(namingControl()).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'A, B, C',
      '1, 2, 3',
      'Bar numbers',
    ]);
  });

  it.each(['numbers', 'measures'] as const)(
    'reads the %s a project is kept in',
    async (naming) => {
      const user = userEvent.setup();
      renderScreen({ projects: [summary({ naming })] });
      await openMore(user);
      expect(namingControl()).toHaveValue(naming);
    },
  );

  it('commits the chosen mode for the row it belongs to', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({
      projects: [summary(), summary({ id: 'project-2', name: 'The other one' })],
    });
    await openMore(user);

    await user.selectOptions(namingControl(), 'measures');

    expect(props.onSetNaming).toHaveBeenCalledWith('project-1', 'measures');
  });

  it('disables the "More" disclosure trigger while a workspace pipeline runs', () => {
    // The naming select lives behind the disclosure (T111); a disabled
    // trigger cannot be opened to reach it.
    renderScreen({ busy: true });
    expect(screen.getByRole('button', { name: /^More/ })).toBeDisabled();
  });
});

describe('ProjectsScreen empty state', () => {
  it('shows a single plain line, matching the gallery’s own empty state', () => {
    renderScreen({ projects: [] });
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
  });

  it('shows the plain empty line regardless of query text, for an owner with zero projects', () => {
    renderScreen({ projects: [], query: 'anything' });
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
    expect(screen.queryByText(/found\./)).not.toBeInTheDocument();
  });
});

describe('ProjectsScreen search (T112)', () => {
  const brahms = summary();
  const chopin = summary({ id: 'project-2', name: 'Chopin Op. 28', recordingTitle: 'Chopin études' });

  it('shows no count line while the query is empty', () => {
    renderScreen({ projects: [brahms, chopin], query: '' });
    expect(screen.queryByText(/found\./)).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('filters the grid by a project’s own name or its recording title, and reports the count', () => {
    renderScreen({ projects: [brahms, chopin], query: 'chopin' });
    expect(screen.getByText('1 project found.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Chopin Op. 28')).toBeInTheDocument();
    expect(screen.queryByText('Brahms Op. 118 No. 2')).not.toBeInTheDocument();
  });

  it('reports a zero count, distinct from the "no projects at all" empty state, when nothing matches', () => {
    renderScreen({ projects: [brahms, chopin], query: 'nothing like this' });
    expect(screen.getByText('0 projects found.')).toBeInTheDocument();
    expect(screen.queryByText('No projects yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
