import { useNavigate } from 'react-router';
import { validateProjectName } from '../projects/summary';
import type { SaveStatus } from '../projects/autosave';
import type { ProjectSummary } from '../projects/types';
import type { ProjectsApi } from '../projects/api';
import { createProjectFromYouTubeLink } from '../youtube';
import { CreateProject } from './CreateProject';
import { ProjectsScreen } from './ProjectsScreen';

export interface WorkspaceScreenProps {
  /** The server-project surface — every workspace write goes through it. */
  projectsApi: ProjectsApi;
  /**
   * The workspace's rows, newest first — owned by the shell so the list
   * survives this screen's unmounts (tab switches, player visits).
   */
  projects: ProjectSummary[];
  /** The save-state line for list mutations (rename, delete, visibility) — lifted for the same reason. */
  status: SaveStatus;
  /** A transient failure the user must see — lifted for the same reason. */
  notice: string | null;
  onStatus: (status: SaveStatus) => void;
  onNotice: (notice: string | null) => void;
  /** Re-reads the list; the shell owns it so the list state stays durable. */
  refreshProjects: () => Promise<void>;
  /** Test seam for the create pipeline. */
  fetchTitle: (canonicalUrl: string) => Promise<string | null>;
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
}

/**
 * The workspace surface (T43): the signed-in Projects home's content — the
 * link-only create, the list, rename, delete, and the visibility toggle, plus
 * the notices and save-status line that accompany them. It owns its pipelines;
 * the shell supplies the durable list/save-state/notice/create-busy state
 * (everything that must survive this screen's unmounts) and the seams. Opening
 * a project is navigation now (T45): the row's open affordance and a landed
 * link create both navigate to the project's page, whose player is its own
 * session.
 */
export function WorkspaceScreen({
  projectsApi,
  projects,
  status,
  notice,
  onStatus,
  onNotice,
  refreshProjects,
  fetchTitle,
  getNavigateToken,
  workingRef,
  linkError,
  onLinkError,
  creatingFromLink,
  onCreatingFromLink,
}: WorkspaceScreenProps) {
  /** The workspace is the routed home page — navigation opens a project. */
  const navigate = useNavigate();

  /**
   * The create surface's one input: a pasted YouTube link becomes a bare
   * server project and navigates to its page. Nothing decodes and nothing is
   * hashed — there is no audio here — so the whole path is the link rules
   * plus one title lookup.
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
        create: (values) => projectsApi.createProject(values),
      });
      if (!outcome.ok) {
        onLinkError(outcome.guidance);
        return;
      }
      if (token !== getNavigateToken()) {
        // The user navigated away while the title lookup ran (up to ten
        // seconds) — the project is saved and waiting in the list, but
        // yanking them off the page they chose is not ours to do.
        await refreshProjects();
        return;
      }
      // The list must show the new project when the user returns — refresh
      // it before the navigation leaves this surface.
      await refreshProjects();
      navigate(`/projects/${outcome.project.id}`);
    } catch {
      onLinkError('Something went wrong creating the project. Please try again.');
    } finally {
      workingRef.current = false;
      onCreatingFromLink(false);
    }
  }

  /**
   * The shared list-mutation pipeline — the working lock, the stale-row check,
   * and the refresh that follows every write. Each action runs its own status
   * transitions (saving → saved/error) inside `run`; the shell's bookkeeping is
   * identical for rename, delete, and the visibility toggle.
   */
  async function runProjectMutation(
    id: string,
    run: (project: ProjectSummary) => Promise<void>,
  ): Promise<void> {
    if (workingRef.current) return;
    workingRef.current = true;
    try {
      const current = projects.find((project) => project.id === id);
      if (current === undefined) {
        // A stale row (another tab deleted it) — quietly re-sync the list.
        await refreshProjects();
        return;
      }
      await run(current);
      await refreshProjects();
    } finally {
      workingRef.current = false;
    }
  }

  async function renameProject(id: string, name: string): Promise<void> {
    await runProjectMutation(id, async (current) => {
      const validation = validateProjectName(name, current.name);
      if (!validation.ok) return;
      onStatus('saving');
      try {
        await projectsApi.saveProject(id, { name: validation.name });
        onStatus('saved');
      } catch {
        onStatus('error');
      }
    });
  }

  async function deleteProject(id: string): Promise<void> {
    await runProjectMutation(id, async () => {
      onStatus('saving');
      try {
        await projectsApi.deleteProject(id);
        onStatus('saved');
      } catch {
        // A delete is not a save — report it as its own thing rather than
        // through the save vocabulary.
        onStatus('idle');
        onNotice('Something went wrong deleting the project. Try again.');
      }
    });
  }

  async function toggleVisibility(id: string): Promise<void> {
    await runProjectMutation(id, async (current) => {
      onStatus('saving');
      try {
        await projectsApi.setVisibility(
          id,
          current.visibility === 'public' ? 'private' : 'public',
        );
        onStatus('saved');
      } catch {
        onStatus('error');
      }
    });
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
        countPublished={(videoId) =>
          projectsApi.listPublishedForVideo(videoId).then((rows) => rows.length)
        }
      />
      <ProjectsScreen
        projects={projects}
        status={status}
        notice={notice}
        busy={creatingFromLink}
        onOpen={(id) => navigate(`/projects/${id}`)}
        onRename={(id, name) => void renameProject(id, name)}
        onDelete={(id) => void deleteProject(id)}
        onToggleVisibility={(id) => void toggleVisibility(id)}
      />
    </>
  );
}
