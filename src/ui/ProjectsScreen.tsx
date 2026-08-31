import { useRef, useState } from 'react';
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
  /** Commits a validated, trimmed name; the caller persists and refreshes. */
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Flips a project's public/private visibility; the caller persists and refreshes. */
  onToggleVisibility: (id: string) => void;
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
  onRename,
  onDelete,
  onToggleVisibility,
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
