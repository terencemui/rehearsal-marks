import { useRef, useState } from 'react';
import type { PublicationStatus } from '../commons/labelSet';
import type { LabelSetRow } from '../commons/labelSet';
import { formatDuration, formatUpdatedAt, validateProjectName } from '../projects/summary';
import type { SaveStatus, ProjectSummary } from '../storage';
import { STATUS_TEXT } from './status';
import './projects.css';

/** The sign-in posture the row's Commons action reacts to. */
export type CommonsAuthKind = 'anonymous' | 'signed-in' | 'unavailable';

/** The row badge for each publication status the moderation gate can hold. */
const COMMONS_STATUS: Record<PublicationStatus, { text: string; title: string }> = {
  pending: {
    text: 'Pending review',
    title: 'Submitted — visible to you, not yet to anyone else, until a maintainer reviews it',
  },
  published: {
    text: 'Published',
    title: 'Public — anyone who opens this video gets your marks',
  },
  rejected: {
    text: 'Rejected',
    title: 'Not published — submit it again to return it to review',
  },
};

export interface ProjectsScreenProps {
  /** The workspace's rows, newest first — the caller owns the list. */
  projects: ProjectSummary[];
  /** The save-state line for list mutations (rename, delete). */
  status: SaveStatus;
  /** True while any workspace pipeline (link create) runs — rows are inert then. */
  busy?: boolean;
  /** A transient failure the user must see (e.g. a project that won't open). */
  notice?: string | null;
  onOpen: (id: string) => void;
  /** Commits a validated, trimmed name; the caller persists and refreshes. */
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /**
   * The sign-in posture — a signed-out row offers sign-in as its Commons
   * action, an unconfigured deployment disables it with an explanation.
   */
  authKind: CommonsAuthKind;
  /**
   * The signed-in contributor's Commons rows, keyed by project id — the
   * publication-status badges. Null when signed out, so rows show none.
   */
  commonsRows: Record<string, LabelSetRow> | null;
  /** The row whose Commons submission runs, if any — rows are inert then. */
  submittingId?: string | null;
  /** Submits or re-submits the project's label set to the Commons. */
  onSubmitToCommons: (id: string) => void;
  /** Starts the Google OAuth flow — a signed-out contributor's submit. */
  onSignIn: () => void;
}

/**
 * The Projects workspace: the list every project lives in, with inline
 * rename, a two-step delete, the save-state line, and the first-run empty
 * state. All persistence happens in the caller — this screen only owns the
 * edit interactions (which row is renaming or confirming).
 */
export function ProjectsScreen({
  projects,
  status,
  busy = false,
  notice = null,
  onOpen,
  onRename,
  onDelete,
  authKind,
  commonsRows,
  submittingId = null,
  onSubmitToCommons,
  onSignIn,
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
        <>
          <ul className="projects-list">
            {projects.map((project) => {
              const commonsRow = commonsRows?.[project.id];
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
                    {commonsRow !== undefined && (
                      <span
                        className={`projects-badge projects-badge-${commonsRow.publication_status}`}
                        title={COMMONS_STATUS[commonsRow.publication_status].title}
                      >
                        {COMMONS_STATUS[commonsRow.publication_status].text}
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
                <button
                  type="button"
                  disabled={busy || submittingId !== null || authKind === 'unavailable'}
                    title={
                      authKind === 'unavailable'
                        ? "Contributing isn't set up for this deployment yet"
                        : undefined
                    }
                    onClick={() =>
                      authKind === 'signed-in' ? onSubmitToCommons(project.id) : onSignIn()
                    }
                  >
                    {submittingId === project.id
                      ? 'Submitting…'
                      : commonsRow !== undefined
                        ? 'Update submission'
                        : authKind === 'signed-in'
                          ? 'Submit to Commons'
                          : 'Sign in to submit'}
                </button>
              </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
