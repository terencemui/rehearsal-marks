import { useNavigate } from 'react-router';
import type { AuthState } from '../auth';
import { CommonsError } from '../commons/errors';
import { labelSetValuesFromProjectFile, projectFileFromRecord, rowsById } from '../commons/labelSet';
import type { LabelSetRow } from '../commons/labelSet';
import type { CommonsWriteController } from '../commons/write';
import { validateProjectName } from '../projects/summary';
import type { ProjectRecord, ProjectSummary, SaveStatus, Storage } from '../storage';
import { createProjectFromYouTubeLink } from '../youtube';
import type { CommunityLabelSet } from '../youtube/community';
import { CreateProject } from './CreateProject';
import { ProjectsScreen } from './ProjectsScreen';

export interface WorkspaceScreenProps {
  /** The open persistence layer — non-null: the shell renders this only once storage is open. */
  storage: Storage;
  /**
   * The workspace's rows, newest first — owned by the shell so the list
   * survives this screen's unmounts (tab switches, player visits).
   */
  projects: ProjectSummary[];
  /** The save-state line for list mutations (rename, delete) — lifted for the same reason. */
  status: SaveStatus;
  /** A transient failure the user must see — lifted for the same reason. */
  notice: string | null;
  onStatus: (status: SaveStatus) => void;
  onNotice: (notice: string | null) => void;
  /** Re-reads the list; the shell owns it so the list state stays durable. */
  refreshProjects: (source: Storage) => Promise<void>;
  /** Test seams for the create pipeline. */
  fetchTitle: (canonicalUrl: string) => Promise<string | null>;
  loadCommunityLabels: (videoId: string) => Promise<CommunityLabelSet | null>;
  /** The contributor session, shared with the header's sign-in control. */
  authState: AuthState;
  onSignIn: () => void;
  /** The Commons write surface; null only before the shell's controller is wired. */
  commonsWrite: CommonsWriteController | null;
  /**
   * The navigation token — a link create captures it before its slow title
   * lookup and navigates to the new project's page only if the user hasn't
   * already moved on (the shell bumps it on every navigation).
   */
  getNavigateToken: () => number;
  /** The serialization lock shared with the workspace's pipelines. */
  workingRef: { current: boolean };
  /**
   * The create surface's rejection guidance beside the input — owned by the
   * shell so a rejection survives a tab switch or player visit.
   */
  linkError: string | null;
  onLinkError: (error: string | null) => void;
  /**
   * True while a link create runs — owned by the shell so the surface's
   * buttons stay inert across its unmounts (the in-flight create holds the
   * shared working lock).
   */
  creatingFromLink: boolean;
  onCreatingFromLink: (busy: boolean) => void;
  /**
   * The contributor's Commons rows by project id — owned by the shell so the
   * badges survive the surface's unmounts and a re-submit always sees the
   * existing row (an UPDATE, never a second moderation row).
   */
  commonsRows: Record<string, LabelSetRow> | null;
  onCommonsRows: (rows: Record<string, LabelSetRow> | null) => void;
  /** The row whose submission runs — owned by the shell so it stays inert across unmounts. */
  submittingId: string | null;
  onSubmittingId: (id: string | null) => void;
}

/**
 * The workspace surface (T43): the Projects home's content — the link-only
 * create, the list, rename, delete, and Commons submission, plus the notices
 * and save-status line that accompany them. It owns its pipelines; the shell
 * supplies the durable list/save-state/notice/create-busy/Commons-badges state
 * (everything that must survive this screen's unmounts) and the seams. Opening
 * a project is navigation now (T45): the row's open affordance and a landed
 * link create both navigate to the project's page, whose player is its own
 * session.
 */
export function WorkspaceScreen({
  storage,
  projects,
  status,
  notice,
  onStatus,
  onNotice,
  refreshProjects,
  fetchTitle,
  loadCommunityLabels,
  authState,
  onSignIn,
  commonsWrite,
  getNavigateToken,
  workingRef,
  linkError,
  onLinkError,
  creatingFromLink,
  onCreatingFromLink,
  commonsRows,
  onCommonsRows,
  submittingId,
  onSubmittingId,
}: WorkspaceScreenProps) {
  /** The workspace is the routed home page — navigation opens a project. */
  const navigate = useNavigate();

  /**
   * The create surface's one input: a pasted YouTube link becomes a project
   * and navigates to its page. Nothing decodes and nothing is hashed — there
   * is no audio here — so the whole path is the link rules plus one title
   * lookup.
   */
  async function handleLink(url: string): Promise<void> {
    if (workingRef.current) return;
    workingRef.current = true;
    onLinkError(null);
    onCreatingFromLink(true);
    const token = getNavigateToken();
    try {
      const outcome = await createProjectFromYouTubeLink(url, {
        fetchTitle,
        loadCommunityLabels,
        save: (record) => storage.projects.save(record),
      });
      if (!outcome.ok) {
        onLinkError(outcome.guidance);
        return;
      }
      if (token !== getNavigateToken()) {
        // The user navigated away while the title lookup ran (up to ten
        // seconds) — the project is saved and waiting in the list, but
        // yanking them off the page they chose is not ours to do.
        await refreshProjects(storage);
        return;
      }
      // The list must show the new project when the user returns — refresh
      // it before the navigation leaves this surface.
      await refreshProjects(storage);
      navigate(`/projects/${outcome.project.id}`);
    } catch {
      onLinkError('Something went wrong creating the project. Please try again.');
    } finally {
      workingRef.current = false;
      onCreatingFromLink(false);
    }
  }

  async function renameProject(id: string, name: string): Promise<void> {
    if (workingRef.current) return;
    workingRef.current = true;
    try {
      let record: ProjectRecord | undefined;
      try {
        record = await storage.projects.get(id);
      } catch {
        onNotice('Something went wrong reading that project. Please reload.');
        return;
      }
      if (record === undefined) {
        await refreshProjects(storage);
        return;
      }
      const validation = validateProjectName(name, record.name);
      if (!validation.ok) return;
      onStatus('saving');
      try {
        await storage.projects.save({ ...record, name: validation.name, updatedAt: Date.now() });
        onStatus('saved');
      } catch {
        onStatus('error');
      }
      await refreshProjects(storage);
    } finally {
      workingRef.current = false;
    }
  }

  async function deleteProject(id: string): Promise<void> {
    if (workingRef.current) return;
    workingRef.current = true;
    try {
      onStatus('saving');
      try {
        await storage.projects.remove(id);
        onStatus('saved');
      } catch {
        // A delete is not a save — report it as its own thing rather than
        // through the save vocabulary.
        onStatus('idle');
        onNotice('Something went wrong deleting the project. Try again.');
      }
      await refreshProjects(storage);
    } finally {
      workingRef.current = false;
    }
  }

  /**
   * Submits (or re-submits) a YouTube project's label set to the Commons —
   * the moderation gate's intake. A signed-out contributor is routed to
   * sign-in first: contributing prompts Sign in with Google, viewing never
   * requires one. The submission lands `pending` (or `published` for a
   * contributor with a track record — the server decides, and the badges
   * refresh from its answer).
   */
  async function handleSubmitToCommons(id: string): Promise<void> {
    if (authState.kind !== 'signed-in') {
      onNotice('Sign in with Google to submit your label set.');
      onSignIn();
      return;
    }
    if (workingRef.current) return;
    workingRef.current = true;
    onSubmittingId(id);
    onNotice(null);
    try {
      const record = await storage.projects.get(id);
      if (record === undefined) {
        // A stale row (another tab deleted it) — quietly re-sync the list.
        await refreshProjects(storage);
        return;
      }
      const commons = commonsWrite;
      if (commons === null) return;
      await commons.submit(
        labelSetValuesFromProjectFile(projectFileFromRecord(record)),
        commonsRows?.[id],
      );
      onNotice(
        commonsRows?.[id] !== undefined
          ? 'Submission updated.'
          : 'Submitted to the Commons.',
      );
      onCommonsRows(rowsById(await commons.listMySubmissions()));
    } catch (error) {
      // A Commons rejection is its own message (rate limit, ban, a label set
      // the store will not hold); everything else is the transport's failure.
      onNotice(
        error instanceof CommonsError
          ? error.message
          : 'Something went wrong submitting your label set. Please try again.',
      );
    } finally {
      workingRef.current = false;
      onSubmittingId(null);
    }
  }

  // Every workspace pipeline holds the working lock while it runs; each
  // control must be disabled across all of them, or an action made mid-flight
  // is silently dropped by the lock guard. An open is instant navigation now
  // (T45) — it holds no lock — so the only busy state left is a link create.
  return (
    <>
      <CreateProject
        onLink={(url) => void handleLink(url)}
        onLinkEdit={() => onLinkError(null)}
        linkError={linkError}
        busy={creatingFromLink}
        creatingFromLink={creatingFromLink}
      />
      <ProjectsScreen
        projects={projects}
        status={status}
        notice={notice}
        busy={creatingFromLink}
        onOpen={(id) => navigate(`/projects/${id}`)}
        onRename={(id, name) => void renameProject(id, name)}
        onDelete={(id) => void deleteProject(id)}
        authKind={authState.kind}
        commonsRows={commonsRows}
        submittingId={submittingId}
        onSubmitToCommons={(id) => void handleSubmitToCommons(id)}
        onSignIn={onSignIn}
      />
    </>
  );
}
