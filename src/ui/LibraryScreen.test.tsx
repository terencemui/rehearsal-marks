import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../library/catalog';
import { LibraryScreen } from './LibraryScreen';

const ENTRY: CatalogEntry = {
  id: 'goldberg-aria',
  composer: 'J. S. Bach',
  piece: 'Goldberg Variations, BWV 988 — Aria',
  performer: 'Kimiko Ishizaka',
  duration: 230.4,
  license: 'CC0',
  attribution: 'Kimiko Ishizaka, via the Open Goldberg Variations',
  audioUrl: 'https://example.org/audio/goldberg-aria.mp3',
  sha256: 'a'.repeat(64),
  labelsetUrl: './labelsets/goldberg-aria.json',
};

function renderScreen(
  overrides: Partial<Parameters<typeof LibraryScreen>[0]> = {},
): ReturnType<typeof render> & { onLoad: ReturnType<typeof vi.fn>; onOpen: ReturnType<typeof vi.fn> } {
  const onLoad = vi.fn();
  const onOpen = vi.fn();
  const view = render(
    <LibraryScreen
      entries={[ENTRY]}
      loadedProjects={new Map()}
      loadingId={null}
      notice={null}
      onLoad={onLoad}
      onOpen={onOpen}
      {...overrides}
    />,
  );
  return { ...view, onLoad, onOpen };
}

describe('LibraryScreen', () => {
  it('shows every catalog fact: composer, piece, performer, duration, license, attribution', () => {
    renderScreen();

    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByText('Goldberg Variations, BWV 988 — Aria')).toBeInTheDocument();
    expect(screen.getByText('J. S. Bach · Kimiko Ishizaka · 3:50.400 · CC0')).toBeInTheDocument();
    expect(screen.getByText('Attribution: Kimiko Ishizaka, via the Open Goldberg Variations')).toBeInTheDocument();
  });

  it('offers Load for an entry with no seeded project', async () => {
    const user = userEvent.setup();
    const { onLoad, onOpen } = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Load' }));

    expect(onLoad).toHaveBeenCalledWith(ENTRY);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows the Loaded state and opens the seeded project instead of loading again', async () => {
    const user = userEvent.setup();
    const { onLoad, onOpen } = renderScreen({
      loadedProjects: new Map([[ENTRY.audioUrl, 'project-7']]),
    });

    await user.click(screen.getByRole('button', { name: 'Loaded — Open' }));

    expect(onOpen).toHaveBeenCalledWith('project-7');
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Load' })).not.toBeInTheDocument();
  });

  it('shows Loading… on the row being loaded and makes every row inert', async () => {
    const user = userEvent.setup();
    const other = {
      ...ENTRY,
      id: 'another',
      piece: 'Another piece',
      audioUrl: 'https://example.org/audio/another.mp3',
      labelsetUrl: './labelsets/another.json',
    };
    const { onLoad, onOpen } = renderScreen({
      entries: [ENTRY, other],
      loadedProjects: new Map([[other.audioUrl, 'project-7']]),
      loadingId: ENTRY.id,
    });

    const loading = screen.getByRole('button', { name: 'Loading…' });
    const loaded = screen.getByRole('button', { name: 'Loaded — Open' });
    expect(loading).toBeDisabled();
    expect(loaded).toBeDisabled();

    await user.click(loading);
    await user.click(loaded);
    expect(onLoad).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('surfaces the notice as an alert', () => {
    renderScreen({ notice: "Couldn't reach the library." });

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach the library.");
  });

  it('renders an empty catalog honestly', () => {
    renderScreen({ entries: [] });

    expect(screen.getByText(/nothing here/i)).toBeInTheDocument();
  });
});
