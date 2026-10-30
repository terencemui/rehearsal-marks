import { useRef, useState } from 'react';
import { NAMINGS } from '../projects';
import type { Naming } from '../projects';
import type { ProjectSummary, PublicationStatus } from '../projects/types';
import { formatUpdatedAt, validateProjectName } from '../projects/summary';
import { formatRulerTime } from '../playback/ruler';
import type { SaveStatus } from '../projects/autosave';
import { STATUS_TEXT } from './status';
import { Thumbnail } from './Thumbnail';
import './gallery.css';
import './projects.css';

/** The card badge for each review state a *public* project can hold (CONTEXT.md). */
const PUBLIC_STATUS: Record<PublicationStatus, { text: string; title: string }> = {
  pending: {
    text: 'Pending review',
    title: 'New or edited — visible to you, not yet to anyone else, until a maintainer reviews it',
  },
  published: {
    text: 'Published',
    title: 'Public — anyone who is given the project can read it',
  },
  rejected: {
    text: 'Rejected',
    title: 'Not published — this project did not pass review',
  },
};

/**
 * What each of the three naming modes reads as in the card's control (T72).
 * The wording is the distinction itself rather than the vocabulary — a
 * project is kept in `A, B, C`, `1, 2, 3` or `Bar numbers` — because the
 * choice is about which name a score uses, and the mode's key says nothing
 * about that. Keyed by the vocabulary so a mode can never be added to the
 * domain and go unspoken here.
 */
const NAMING_TEXT: Record<Naming, { label: string; title: string }> = {
  letters: {
    label: 'A, B, C',
    title: 'Name each mark by its letter within the movement',
  },
  numbers: {
    label: '1, 2, 3',
    title: 'Name each mark by its number within the movement',
  },
  measures: {
    label: 'Bar numbers',
    title: 'Name each mark by the bar number you write for it',
  },
};

/**
 * A card's visibility-derived view — the one place the `visibility`
 * discriminant lives. Public cards show their review badge and offer "Make
 * private"; private cards show a Private tag and offer "Make public" (which
 * returns the project to review). The badge and tag share the title-to-text
 * shape so the card renders them uniformly.
 */
function visibilityView(project: ProjectSummary) {
  const isPublic = project.visibility === 'public';
  return {
    isPublic,
    status: isPublic
      ? PUBLIC_STATUS[project.publicationStatus]
      : { text: 'Private', title: 'Visible to you only' },
    toggleLabel: isPublic ? 'Make private' : 'Make public',
    toggleTitle: isPublic
      ? 'Only you can see a private project'
      : 'Making it public sends it to review again',
  };
}

export interface ProjectsScreenProps {
  /** The workspace's cards, newest first — the caller owns the list. */
  projects: ProjectSummary[];
  /** The save-state line for list mutations (rename, delete, visibility). */
  status: SaveStatus;
  /** True while any workspace pipeline (link create) runs — cards are inert then. */
  busy?: boolean;
  /** A transient failure the user must see (e.g. a project that won't open). */
  notice?: string | null;
  onOpen: (id: string) => void;
  /**
   * Opens the project's markings page (T61) — the same page the marks panel's
   * link reaches, so a project can be filled without opening its player first.
   * Navigating, not editing: this screen writes nothing.
   */
  onOpenMarkings: (id: string) => void;
  /** Commits a validated, trimmed name; the caller persists and refreshes. */
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Flips a project's public/private visibility; the caller persists and refreshes. */
  onToggleVisibility: (id: string) => void;
  /**
   * Sets how the project names its marks (T72); the caller persists and
   * refreshes. It is the project's own setting, not the viewer's, so it is
   * changed here — where the project is, on the card of it — and reads the
   * same to everyone afterwards.
   */
  onSetNaming: (id: string, naming: Naming) => void;
}

/**
 * The Projects workspace (T110): a card grid, one card per project, reusing
 * the gallery's own grid/thumbnail/typography (CONTEXT.md's Public gallery
 * direction) rather than the plain row list it replaces. A card's thumbnail
 * or title opens the project directly; every other action — Markings,
 * inline rename, a two-step delete, the visibility toggle, and the naming
 * select — stays directly reachable on the card face, unchanged in substance
 * from the row it replaces. All persistence happens in the caller — this
 * screen only owns the edit interactions (which card is renaming or
 * confirming). Each card shows its review badge (public projects) or a
 * Private tag, and the visibility toggle that moves a project between the
 * two.
 */
export function ProjectsScreen({
  projects,
  status,
  busy = false,
  notice = null,
  onOpen,
  onOpenMarkings,
  onRename,
  onDelete,
  onToggleVisibility,
  onSetNaming,
}: ProjectsScreenProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** Which card's "More" disclosure is open — at most one at a time (T111). */
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null);
  /**
   * Terminal state for the edit in flight. Real browsers fire blur when a
   * focused input unmounts, so Enter's commit and Escape's cancel must both
   * survive their own input's removal without firing a second time.
   */
  const renameEditRef = useRef<{ committed: boolean; cancelled: boolean } | null>(null);

  function beginRename(id: string): void {
    renameEditRef.current = { committed: false, cancelled: false };
    setConfirmingId(null);
    setEditingId(id);
  }

  /**
   * Toggles a card's disclosure, closing any other card's. Clears the
   * edit/confirm state along with it — otherwise closing on an armed delete
   * confirmation would leave it armed, so reopening lands straight back on
   * "Delete this cannot be undone" and a single further click deletes,
   * silently skipping the two-step confirmation the control exists to give.
   */
  function toggleMore(id: string): void {
    setMoreOpenId((current) => (current === id ? null : id));
    setEditingId(null);
    setConfirmingId(null);
  }

  function commitRename(project: ProjectSummary, raw: string): void {
    const edit = renameEditRef.current;
    if (edit === null) return; // a stale blur from an input already removed
    if (edit.cancelled) {
      // Escape flagged the edit; the blur-on-unmount completes the cancel.
      setEditingId(null);
      renameEditRef.current = null;
      return;
    }
    if (edit.committed) return; // Enter's commit followed by blur-on-unmount
    edit.committed = true;
    const validation = validateProjectName(raw, project.name);
    if (validation.ok) onRename(project.id, validation.name);
    setEditingId(null);
    renameEditRef.current = null;
  }

  return (
    <section aria-label="Projects" className="workspace">
      <p role="status" data-save-status={status} className="workspace-status">
        {STATUS_TEXT[status]}
      </p>
      {notice !== null && (
        <p role="alert" className="workspace-notice">
          {notice}
        </p>
      )}
      {projects.length === 0 ? (
        <p className="workspace-empty" role="status">
          No projects yet.
        </p>
      ) : (
        <ol className="gallery-grid">
          {projects.map((project) => {
            const view = visibilityView(project);
            return (
              <li key={project.id} className="workspace-card">
                <button
                  type="button"
                  className="workspace-thumb-button"
                  aria-label={`Open ${project.name}`}
                  // Every workspace pipeline holds the working lock, and an
                  // open attempted under it is silently dropped — so the
                  // card must be disabled across all of them. (An open
                  // itself is instant navigation now (T45) — it holds no
                  // lock.)
                  disabled={busy}
                  onClick={() => onOpen(project.id)}
                >
                  <span className="gallery-image">
                    <Thumbnail videoId={project.videoId} className="gallery-thumb" />
                    <span className="gallery-duration">{formatRulerTime(project.duration)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="workspace-title"
                  disabled={busy}
                  onClick={() => onOpen(project.id)}
                >
                  <span className="workspace-name">{project.name}</span>
                  {view.isPublic ? (
                    <span
                      className={`workspace-badge workspace-badge-${project.publicationStatus}`}
                      title={view.status.title}
                    >
                      {view.status.text}
                    </span>
                  ) : (
                    <span className="workspace-tag workspace-tag-private" title={view.status.title}>
                      {view.status.text}
                    </span>
                  )}
                </button>
                <p className="workspace-recording">{project.recordingTitle}</p>
                <p className="workspace-meta">
                  {project.markerCount} marker{project.markerCount === 1 ? '' : 's'} ·{' '}
                  {formatUpdatedAt(project.updatedAt, Date.now())}
                </p>
                <div className="workspace-actions">
                  {/* Every action beyond opening the project — Markings, Rename,
                      the visibility toggle, the naming select, Delete — sits
                      behind this one disclosure (T111), decluttering the card
                      face T110 built. The name carries the project because the
                      grid is many cards: a reader walking it hears which
                      project each door belongs to. */}
                  <button
                    type="button"
                    className="workspace-action"
                    aria-haspopup="true"
                    aria-expanded={moreOpenId === project.id}
                    aria-label={`More for ${project.name}`}
                    disabled={busy}
                    onClick={() => toggleMore(project.id)}
                  >
                    More
                  </button>
                  {moreOpenId === project.id && (
                    <div className="workspace-more-menu" role="group" aria-label={`More for ${project.name}`}>
                      {/* The markings page, reached from the card (T61) —
                          navigation like the open above it, and saying what
                          the marks panel's door to the same page says, so the
                          two ways in read as one page.
                          A button rather than the panel's link, deliberately:
                          this door must go inert with the rest of the card
                          while a create runs (T61), and an anchor cannot be
                          disabled. */}
                      <button
                        type="button"
                        className="workspace-action"
                        aria-label={`Markings for ${project.name}`}
                        disabled={busy}
                        onClick={() => onOpenMarkings(project.id)}
                      >
                        Markings
                      </button>
                      {editingId === project.id ? (
                        <input
                          className="workspace-rename-input"
                          aria-label="Project name"
                          defaultValue={project.name}
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === 'Enter')
                              commitRename(project, event.currentTarget.value);
                            if (event.key === 'Escape') {
                              if (renameEditRef.current !== null)
                                renameEditRef.current.cancelled = true;
                              // Unmounting the focused input fires blur in real
                              // browsers — commitRename reads the flag there.
                              setEditingId(null);
                            }
                          }}
                          onBlur={(event) => commitRename(project, event.currentTarget.value)}
                        />
                      ) : (
                        <button
                          type="button"
                          className="workspace-action"
                          onClick={() => beginRename(project.id)}
                        >
                          Rename
                        </button>
                      )}
                      <button
                        type="button"
                        className="workspace-action"
                        disabled={busy}
                        title={view.toggleTitle}
                        onClick={() => onToggleVisibility(project.id)}
                      >
                        {view.toggleLabel}
                      </button>
                      {/* How the project names its marks (T72). A select
                          rather than three buttons, because the options are
                          the choice itself. */}
                      <select
                        className="workspace-naming"
                        aria-label={`Naming for ${project.name}`}
                        title={NAMING_TEXT[project.naming].title}
                        disabled={busy}
                        value={project.naming}
                        onChange={(event) =>
                          onSetNaming(project.id, event.currentTarget.value as Naming)
                        }
                      >
                        {NAMINGS.map((naming) => (
                          <option key={naming} value={naming}>
                            {NAMING_TEXT[naming].label}
                          </option>
                        ))}
                      </select>
                      {confirmingId === project.id ? (
                        <span className="workspace-confirm">
                          <span>Delete “{project.name}”? This cannot be undone.</span>
                          <button
                            type="button"
                            className="workspace-action"
                            onClick={() => setConfirmingId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="workspace-action workspace-confirm-delete"
                            onClick={() => {
                              setConfirmingId(null);
                              onDelete(project.id);
                            }}
                          >
                            Delete
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="workspace-action"
                          onClick={() => {
                            setEditingId(null);
                            setConfirmingId(project.id);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
