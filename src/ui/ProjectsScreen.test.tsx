import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectSummary } from '../storage';
import { ProjectsScreen } from './ProjectsScreen';
import type { ProjectsScreenProps } from './ProjectsScreen';

function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'project-1',
    name: 'Brahms Op. 118 No. 2',
    duration: 123.456,
    markerCount: 2,
    sizeBytes: 285,
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
    onExport: vi.fn(),
    onExportLabels: vi.fn(),
    onImportLabels: vi.fn(),
    onBrowseLibrary: vi.fn(),
    ...overrides,
  };
  const view = render(<ProjectsScreen {...props} />);
  return { ...view, props };
}

describe('ProjectsScreen list', () => {
  it('shows name, duration, marker count, size, last-modified, and total usage', () => {
    renderScreen();
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
    // 1_700_000_000_000 ms is more than eight weeks old — the date fallback.
    expect(within(row).getByText(/2:03\.456 · 2 markers · 285 B · 2023-11-14/)).toBeInTheDocument();
    expect(screen.getByText(/Total used: 285 B/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
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

  it('disables rows while one is opening', () => {
    renderScreen({ openingId: 'project-1' });
    expect(screen.getByRole('button', { name: /Brahms/ })).toBeDisabled();
  });

  it('renders the status line vocabulary', () => {
    renderScreen({ status: 'saving' });
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  });

  it('surfaces the storage-full state honestly', () => {
    renderScreen({ status: 'storage-full' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Storage full — free up space to keep saving.',
    );
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

describe('ProjectsScreen export', () => {
  it('routes Export and Export labels to the caller with the row’s project id', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(props.onExport).toHaveBeenCalledWith('project-1');

    await user.click(screen.getByRole('button', { name: 'Export labels' }));
    expect(props.onExportLabels).toHaveBeenCalledWith('project-1');
  });
});

describe('ProjectsScreen label-set import', () => {
  it('confirms before replacing a project that has markers, and Cancel walks it back', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Import labels' }));

    expect(
      screen.getByText('Replace this project’s 2 markers with the label set?'),
    ).toBeInTheDocument();
    expect(props.onImportLabels).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Import labels' })).toBeInTheDocument();
    expect(props.onImportLabels).not.toHaveBeenCalled();
  });

  it('hands the picked file to the caller with the row’s project id', async () => {
    const user = userEvent.setup();
    const { props, container } = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Import labels' }));
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    const file = new File(['{}'], 'labels.json', { type: 'application/json' });
    await user.upload(container.querySelector('input[type="file"]')!, file);

    expect(props.onImportLabels).toHaveBeenCalledWith('project-1', file);
  });

  it('skips the confirmation when the project has no markers', async () => {
    const user = userEvent.setup();
    const { props, container } = renderScreen({ projects: [summary({ markerCount: 0 })] });

    await user.click(screen.getByRole('button', { name: 'Import labels' }));
    expect(screen.queryByText(/Replace this project/)).not.toBeInTheDocument();

    const file = new File(['{}'], 'labels.json', { type: 'application/json' });
    await user.upload(container.querySelector('input[type="file"]')!, file);

    expect(props.onImportLabels).toHaveBeenCalledWith('project-1', file);
  });
});

describe('ProjectsScreen empty state', () => {
  it('offers the two first-run paths and hides the list', () => {
    const { props } = renderScreen({ projects: [] });
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/Total used/)).not.toBeInTheDocument();
    expect(props.onBrowseLibrary).toBeDefined();
  });

  it('routes "Browse the library" to the caller', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ projects: [] });
    await user.click(screen.getByRole('button', { name: 'Browse the library' }));
    expect(props.onBrowseLibrary).toHaveBeenCalled();
  });
});
