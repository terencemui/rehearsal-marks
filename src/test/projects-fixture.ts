import { vi } from 'vitest';
import { ProjectsError } from '../projects/errors';
import type { ProjectsApi } from '../projects/api';
import { summarizeProject } from '../projects/types';
import type { ProjectSummary, ProjectUpdate, ProjectValues, ServerProject } from '../projects/types';
import type { ProjectVisibility } from '../projects/types';

/**
 * Test double for the ProjectsApi seam — the in-memory counterpart of the
 * supabase-js adapter, faked the way `mockAuth` fakes `SupabaseAuth`. Every
 * operation is a `vi.fn` so tests can assert calls or override behavior;
 * `failNext` makes the named operation reject once with the transport's
 * fetch-failed error, exercising the UI's failure paths without a network.
 */
export interface FakeProjectsApi extends ProjectsApi {
  /** Inserts a project into the fake store, as a seed or a server create. */
  seed(project: ServerProject): void;
  /** The current stored project, for asserting post-operation state. */
  get(id: string): ServerProject | undefined;
  /** The next call to this operation rejects with a fetch-failed error. */
  failNext(method: keyof ProjectsApi): void;
}

export function fakeProjectsApi(): FakeProjectsApi {
  const projects = new Map<string, ServerProject>();
  const failing = new Set<keyof ProjectsApi>();

  function throwIfFailing(method: keyof ProjectsApi): void {
    if (failing.has(method)) {
      failing.delete(method);
      throw new ProjectsError(
        "The server couldn't save that change. Check your connection and try again.",
        'fetch-failed',
      );
    }
  }

  function newestFirst(list: ServerProject[]): ProjectSummary[] {
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt).map(summarizeProject);
  }

  const api: ProjectsApi = {
    listMyProjects: vi.fn(async (): Promise<ProjectSummary[]> => {
      throwIfFailing('listMyProjects');
      return newestFirst([...projects.values()]);
    }),

    getProject: vi.fn(async (id: string): Promise<ServerProject | null> => {
      throwIfFailing('getProject');
      return projects.get(id) ?? null;
    }),

    createProject: vi.fn(async (values: ProjectValues): Promise<ServerProject> => {
      throwIfFailing('createProject');
      const project: ServerProject = {
        id: `project-${crypto.randomUUID()}`,
        name: values.name,
        recordingTitle: values.recordingTitle,
        videoId: values.videoId,
        duration: values.duration,
        markers: values.markers,
        movements: values.movements,
        visibility: 'public',
        publicationStatus: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      projects.set(project.id, project);
      return project;
    }),

    saveProject: vi.fn(async (id: string, update: ProjectUpdate): Promise<void> => {
      throwIfFailing('saveProject');
      const project = projects.get(id);
      if (project === undefined) {
        throw new ProjectsError('This project was not found.', 'not-found');
      }
      projects.set(id, {
        ...project,
        name: update.name ?? project.name,
        markers: update.markers ?? project.markers,
        movements: update.movements ?? project.movements,
        updatedAt: Date.now(),
      });
    }),

    setVisibility: vi.fn(async (id: string, visibility: ProjectVisibility): Promise<void> => {
      throwIfFailing('setVisibility');
      const project = projects.get(id);
      if (project === undefined) {
        throw new ProjectsError('This project was not found.', 'not-found');
      }
      // Making a private project public re-enters review, like the trigger.
      const publicationStatus =
        visibility === 'public' && project.visibility === 'private'
          ? 'pending'
          : project.publicationStatus;
      projects.set(id, { ...project, visibility, publicationStatus, updatedAt: Date.now() });
    }),

    deleteProject: vi.fn(async (id: string): Promise<void> => {
      throwIfFailing('deleteProject');
      // Deleting an absent row is a silent success, exactly like PostgREST.
      projects.delete(id);
    }),

    listPublishedForVideo: vi.fn(async (videoId: string): Promise<ProjectSummary[]> => {
      throwIfFailing('listPublishedForVideo');
      return newestFirst(
        [...projects.values()].filter(
          (p) =>
            p.videoId === videoId && p.visibility === 'public' && p.publicationStatus === 'published',
        ),
      );
    }),
  };

  return {
    ...api,
    seed(project) {
      projects.set(project.id, project);
    },
    get(id) {
      return projects.get(id);
    },
    failNext(method) {
      failing.add(method);
    },
  };
}
