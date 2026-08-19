import { formatDuration } from '../projects/summary';
import type { CatalogEntry } from '../library/catalog';
import './library.css';

export interface LibraryScreenProps {
  /** The catalog rows, in manifest order. */
  entries: CatalogEntry[];
  /** Entry audio URL → seeded project id: the "Loaded" state's join. */
  loadedProjects: ReadonlyMap<string, string>;
  /** The entry being loaded — its row shows progress and every row is inert. */
  loadingId: string | null;
  /** A transient failure the user must see (a catalog or download problem). */
  notice: string | null;
  onLoad: (entry: CatalogEntry) => void;
  /** Opens the editable project seeded from the entry. */
  onOpen: (projectId: string) => void;
}

/**
 * The Library tab: the community catalog of CC0 recordings. Every row shows
 * what the manifest promises — composer, piece, performer, duration, license,
 * attribution — and either loads the entry or opens the user's seeded copy,
 * the "Loaded" state. All persistence happens in the caller; this screen
 * only renders the catalog and routes the two actions.
 */
export function LibraryScreen({
  entries,
  loadedProjects,
  loadingId,
  notice,
  onLoad,
  onOpen,
}: LibraryScreenProps) {
  return (
    <section aria-label="Library">
      <h2>Library</h2>
      <p className="library-intro">
        Public-domain recordings, pre-marked by the community. Loading one copies it into
        your projects — the recording and your marks stay in this browser.
      </p>
      {notice !== null && (
        <p role="alert" className="library-notice">
          {notice}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="library-empty">Nothing here yet — the catalog has no recordings.</p>
      ) : (
        <ul className="library-list">
          {entries.map((entry) => {
            const loadedProjectId = loadedProjects.get(entry.audioUrl);
            return (
              <li key={entry.id} className="library-row">
                <span className="library-facts">
                  <span className="library-piece">{entry.piece}</span>
                  <span className="library-meta">
                    {entry.composer} · {entry.performer} · {formatDuration(entry.duration)} ·{' '}
                    {entry.license}
                  </span>
                  <span className="library-attribution">Attribution: {entry.attribution}</span>
                </span>
                {loadedProjectId !== undefined ? (
                  <button
                    type="button"
                    className="library-open"
                    disabled={loadingId !== null}
                    onClick={() => onOpen(loadedProjectId)}
                  >
                    Loaded — Open
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={loadingId !== null}
                    onClick={() => onLoad(entry)}
                  >
                    {loadingId === entry.id ? 'Loading…' : 'Load'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
