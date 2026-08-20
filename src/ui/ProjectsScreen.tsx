import { useRef, useState } from 'react';
import {
  formatBytes,
  formatDuration,
  formatUpdatedAt,
  totalUsageBytes,
  validateProjectName,
} from '../projects/summary';
import type { SaveStatus, ProjectSummary } from '../storage';
import { STATUS_TEXT } from './status';
import './projects.css';

export interface ProjectsScreenProps {
  /** The workspace's rows, newest first — the caller owns the list. */
  projects: ProjectSummary[];
  /** The save-state line for list mutations (rename, delete). */
  status: SaveStatus;
  /** The row being opened, if any — rows are inert while one loads. */
  openingId?: string | null;
  /** True while any workspace pipeline (upload, zip import, label import) runs — row imports are inert then. */
  busy?: boolean;
  /** A transient failure the user must see (e.g. a project that won't open). */
  notice?: string | null;
  onOpen: (id: string) => void;
  /** Commits a validated, trimmed name; the caller persists and refreshes. */
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Downloads the full project zip; the caller owns the record and the blob. */
  onExport: (id: string) => void;
  /** Downloads the label-set-only JSON for community contribution. */
  onExportLabels: (id: string) => void;
  /** Applies a picked label-set file to the project, pending identity check. */
  onImportLabels: (id: string, file: File) => void;
  /** The row whose label-set import is running, if any. */
  importingLabelsId?: string | null;
  onBrowseLibrary: () => void;
}

/**
 * The Projects workspace: the list every project lives in, with inline
 * rename, a two-step delete, the save-state line, storage usage, export and
 * import, and the first-run empty state. All persistence happens in the
 * caller — this screen only owns the edit interactions (which row is
 * renaming, confirming, or picking a file).
 */
export function ProjectsScreen({
  projects,
  status,
  openingId = null,
  busy = false,
  notice = null,
  onOpen,
  onRename,
  onDelete,
  onExport,
  onExportLabels,
  onImportLabels,
  importingLabelsId = null,
  onBrowseLibrary,
}: ProjectsScreenProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingLabelsId, setConfirmingLabelsId] = useState<string | null>(null);
  /** Which project the next picked label-set file belongs to. */
  const [labelImportForId, setLabelImportForId] = useState<string | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  /**
   * Terminal state for the edit in flight. Real browsers fire blur when a
   * focused input unmounts, so Enter's commit and Escape's cancel must both
   * survive their own input's removal without firing a second time.
   */
  const renameEditRef = useRef<{ committed: boolean; cancelled: boolean } | null>(null);

  function beginRename(id: string): void {
    renameEditRef.current = { committed: false, cancelled: false };
    setConfirmingId(null);
    setConfirmingLabelsId(null);
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
      <input
        ref={labelInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file again re-fires change.
          event.target.value = '';
          const id = labelImportForId;
          setLabelImportForId(null);
          if (file && id !== null) onImportLabels(id, file);
        }}
      />
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
          <p>
            Upload a recording to start marking, or browse the community library for a
            pre-marked recording.
          </p>
          <button type="button" onClick={onBrowseLibrary}>
            Browse the library
          </button>
        </section>
      ) : (
        <>
          <p className="projects-total">
            Total used: {formatBytes(totalUsageBytes(projects))}
          </p>
          <ul className="projects-list">
            {projects.map((project) => (
              <li key={project.id} className="projects-row">
                <button
                  type="button"
                  className="projects-open"
                  // Every workspace pipeline holds the working lock, and an
                  // open attempted under it is silently dropped — so the row
                  // must be disabled across all of them, not just opens.
                  disabled={openingId !== null || busy}
                  onClick={() => onOpen(project.id)}
                >
                  <span className="projects-name">{project.name}</span>
                  <span className="projects-meta">
                    {formatDuration(project.duration)} · {project.markerCount} marker
                    {project.markerCount === 1 ? '' : 's'} · {formatBytes(project.sizeBytes)} ·{' '}
                    {formatUpdatedAt(project.updatedAt, Date.now())}
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
                      setConfirmingLabelsId(null);
                    }}
                  >
                    Delete
                  </button>
                )}
                <button type="button" onClick={() => onExport(project.id)}>
                  Export
                </button>
                <button type="button" onClick={() => onExportLabels(project.id)}>
                  Export labels
                </button>
                {confirmingLabelsId === project.id ? (
                  <span className="projects-confirm">
                    <span>
                      Replace this project’s {project.markerCount} marker
                      {project.markerCount === 1 ? '' : 's'} with the label set?
                    </span>
                    <button type="button" onClick={() => setConfirmingLabelsId(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="projects-confirm-delete"
                      onClick={() => {
                        setConfirmingLabelsId(null);
                        setLabelImportForId(project.id);
                        labelInputRef.current?.click();
                      }}
                    >
                      Replace
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={importingLabelsId !== null || busy}
                    onClick={() => {
                      setEditingId(null);
                      setConfirmingId(null);
                      setConfirmingLabelsId(null);
                      if (project.markerCount > 0) {
                        // Applying a label set replaces the project's markers —
                        // the confirmation is the moment the user owns that.
                        setConfirmingLabelsId(project.id);
                      } else {
                        setLabelImportForId(project.id);
                        labelInputRef.current?.click();
                      }
                    }}
                  >
                    Import labels
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
