import { useRef, useState } from 'react';
import { NAMINGS } from '../projects';
import type { Naming } from '../projects';
import type { ProjectSummary, PublicationStatus } from '../projects/types';
import { formatDuration, formatUpdatedAt, validateProjectName } from '../projects/summary';
import type { SaveStatus } from '../projects/autosave';
import { STATUS_TEXT } from './status';
import './projects.css';

/** The row badge for each review state a *public* project can hold (CONTEXT.md). */
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
 * What each of the three naming modes reads as in the row's control (T72). The
 * wording is the distinction itself rather than the vocabulary — a project is
 * kept in `A, B, C`, `1, 2, 3` or `Bar numbers` — because the choice is about
 * which name a score uses, and the mode's key says nothing about that. Keyed by
 * the vocabulary so a mode can never be added to the domain and go unspoken
 * here.
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
 * A row's visibility-derived view — the one place the `visibility` discriminant
 * lives. Public rows show their review badge and offer "Make private"; private
 * rows show a Private tag and offer "Make public" (which returns the project to
 * review). The badge and tag share the title-to-text shape so the row renders
 * them uniformly.
 */
function rowView(project: ProjectSummary) {
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
  /** The workspace's rows, newest first — the caller owns the list. */
  projects: ProjectSummary[];
  /** The save-state line for list mutations (rename, delete, visibility). */
  status: SaveStatus;
  /** True while any workspace pipeline (link create) runs — rows are inert then. */
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
   * changed here — where the project is, on the list of them — and reads the
   * same to everyone afterwards.
   */
  onSetNaming: (id: string, naming: Naming) => void;
}

/**
 * The Projects workspace: the list every project lives in, with inline
 * rename, a two-step delete, the save-state line, and the first-run empty
 * state. All persistence happens in the caller — this screen only owns the
 * edit interactions (which row is renaming or confirming). Each row shows its
 * review badge (public projects) or a Private tag, and the visibility toggle
 * that moves a project between the two.
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
    <section aria-label="Projects">
      <p role="status" data-save-status={status} className="projects-status">
        {STATUS_TEXT[status]}
      </p>
      {notice !== null && (
        <p role="alert" className="projects-notice">
          {notice}
        </p>
      )}
      {projects.length === 0 ? (
        <section className="projects-empty">
          <h2>No projects yet</h2>
          <p>Paste a YouTube link above to start marking.</p>
        </section>
      ) : (
        <ul className="projects-list">
          {projects.map((project) => {
            const view = rowView(project);
            return (
            <li key={project.id} className="projects-row">
              <button
                type="button"
                className="projects-open"
                // Every workspace pipeline holds the working lock, and an
                // open attempted under it is silently dropped — so the row
                // must be disabled across all of them. (An open itself is
                // instant navigation now (T45) — it holds no lock.)
                disabled={busy}
                onClick={() => onOpen(project.id)}
              >
                <span className="projects-name">
                  {project.name}
                  {view.isPublic ? (
                    <span
                      className={`projects-badge projects-badge-${project.publicationStatus}`}
                      title={view.status.title}
                    >
                      {view.status.text}
                    </span>
                  ) : (
                    <span className="projects-tag projects-tag-private" title={view.status.title}>
                      {view.status.text}
                    </span>
                  )}
                </span>
                <span className="projects-meta">
                  {formatDuration(project.duration)} · {project.markerCount} marker
                  {project.markerCount === 1 ? '' : 's'} · {formatUpdatedAt(project.updatedAt, Date.now())}
                </span>
              </button>
              {/* The markings page, reached from the row (T61) — navigation
                  like the open above it, and saying what the marks panel's
                  door to the same page says, so the two ways in read as one
                  page.
                  A button rather than the panel's link, deliberately: this
                  door must go inert with the rest of the row while a create
                  runs (T61), and an anchor cannot be disabled. It shares the
                  limitation the open button above it already carries — no
                  cmd-click, no middle-click — which is the row's own
                  behaviour, not this control's. The name carries the project
                  because the row is one of many: a reader walking the list
                  hears which project each door belongs to, and the visible
                  word is still the name's. */}
              <button
                type="button"
                aria-label={`Markings for ${project.name}`}
                disabled={busy}
                onClick={() => onOpenMarkings(project.id)}
              >
                Markings
              </button>
              {editingId === project.id ? (
                <input
                  className="projects-rename-input"
                  aria-label="Project name"
                  defaultValue={project.name}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename(project, event.currentTarget.value);
                    if (event.key === 'Escape') {
                      if (renameEditRef.current !== null) renameEditRef.current.cancelled = true;
                      // Unmounting the focused input fires blur in real
                      // browsers — commitRename reads the flag there.
                      setEditingId(null);
                    }
                  }}
                  onBlur={(event) => commitRename(project, event.currentTarget.value)}
                />
              ) : (
                <button type="button" onClick={() => beginRename(project.id)}>
                  Rename
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                title={view.toggleTitle}
                onClick={() => onToggleVisibility(project.id)}
              >
                {view.toggleLabel}
              </button>
              {/* How the project names its marks (T72). A select rather than
                  three buttons, because the row already carries five controls
                  and a list of rows has no room for three more: one control,
                  one reading, and the options are the choice itself. The
                  control is named for the project the way the row's other
                  controls are, since a reader walking the list hears which
                  project each one belongs to. */}
              <select
                className="projects-naming"
                aria-label={`Naming for ${project.name}`}
                title={NAMING_TEXT[project.naming].title}
                disabled={busy}
                value={project.naming}
                onChange={(event) => onSetNaming(project.id, event.currentTarget.value as Naming)}
              >
                {NAMINGS.map((naming) => (
                  <option key={naming} value={naming}>
                    {NAMING_TEXT[naming].label}
                  </option>
                ))}
              </select>
              {confirmingId === project.id ? (
                <span className="projects-confirm">
                  <span>Delete “{project.name}”? This cannot be undone.</span>
                  <button type="button" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="projects-confirm-delete"
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
                  onClick={() => {
                    setEditingId(null);
                    setConfirmingId(project.id);
                  }}
                >
                  Delete
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
