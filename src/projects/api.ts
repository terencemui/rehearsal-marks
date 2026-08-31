/**
 * The app's server-project surface (ADR-0006) — the seam component tests fake
 * the way `mockAuth` fakes `SupabaseAuth`. Two adapters implement it:
 * `supabase.ts` is the signed-in surface (the session-restored write ops and
 * the owner's reads) and `read.ts` is the anonymous read surface (the gallery
 * and the read-only view, over the anon key); `createDefaultProjectsApi`
 * composes both. Everything above the interface drives the shape.
 *
 * Anonymous reads and signed-in writes share one surface: the server decides,
 * via RLS, what a given session may read and write. The write operations
 * restore the session first and fail with the app's own `not-signed-in` error
 * when there is none.
 */

import { readAuthEnv } from '../auth';
import { createSupabaseProjectsApi } from './supabase';
import {
  fetchProjectsText,
  getPublicProject as fetchPublicProject,
  listPublishedForVideo as fetchPublishedForVideo,
  listPublishedProjects as fetchPublishedProjects,
  readProjectsConfig,
} from './read';
import type { Marker, Movement } from '../domain';
import type { ProjectSummary, ProjectUpdate, ProjectValues, ServerProject } from './types';
import type { ProjectVisibility } from './types';

/** A published public project as the read surface returns it — the gallery's entry. */
export interface PublicProjectSummary {
  /** The project row's id — the read-only view's address. */
  id: string;
  /** The owner's editable project name — the entry's label. */
  name: string;
  /**
   * The canonical recording title, fetched once from YouTube at creation and
   * never editable (ADR-0006) — the gallery groups by this, never by `name`,
   * so a user's rename never mislabels the recording.
   */
  recordingTitle: string;
  /** The 11-character video ID — the recording a gallery group collapses on. */
  videoId: string;
  /** Seconds, float — the recording's known duration. */
  duration: number;
  /** How many markers the project carries — one of the gallery entry's facts. */
  markerCount: number;
  /** Epoch ms — the gallery's "newest first" sort. */
  createdAt: number;
}

/** A single public project opened read-only: the summary plus its content. */
export interface PublicProject extends PublicProjectSummary {
  markers: Marker[];
  movements: Movement[];
}

/**
 * The project data surface — the seam the app and its tests share: the signed
 * in workspace's list, reads, and writes, plus the anonymous reads the gallery
 * and the read-only view run on. One PostgREST-backed implementation composes
 * the two transports; every test above this seam fakes the interface.
 */
export interface ProjectsApi {
  /**
   * The signed-in user's own projects, newest first — the workspace list.
   * Requires a session: ownership is the list's scope.
   */
  listMyProjects(): Promise<ProjectSummary[]>;
  /**
   * One project by id, or null when none is visible to the current session.
   * An anonymous session reads published public projects only; a signed-in
   * owner additionally reads their own in every status and visibility (the
   * RLS scope). Returns null for a missing row — the page's "not found".
   */
  getProject(id: string): Promise<ServerProject | null>;
  /**
   * Creates a project; the server owns ownership, status (pending), and the
   * stamps. Returns the created row so the pipeline can open it.
   */
  createProject(values: ProjectValues): Promise<ServerProject>;
  /**
   * Edits the client-writable fields only — the update grant (name, markers,
   * movements); visibility has its own operation. Identity, ownership, and
   * review status are never settable here.
   */
  saveProject(id: string, update: ProjectUpdate): Promise<void>;
  /** The visibility toggle; making a private project public re-enters review. */
  setVisibility(id: string, visibility: ProjectVisibility): Promise<void>;
  /** Deletes the signed-in user's own project. */
  deleteProject(id: string): Promise<void>;
  /** Every published public project, newest first — the gallery's source. */
  listPublishedProjects(): Promise<PublicProjectSummary[]>;
  /**
   * The published public projects for a video — the create screen's count
   * peek. Explicitly filtered to published public regardless of the caller's
   * session, so a signed-in owner's own pending/private projects are not
   * counted.
   */
  listPublishedForVideo(videoId: string): Promise<PublicProjectSummary[]>;
  /** One published public project, or null when it doesn't exist or isn't visible. */
  getPublicProject(id: string): Promise<PublicProject | null>;
}

/** One recording's group in the gallery: the canonical title and its projects, newest first. */
export interface GalleryGroup {
  videoId: string;
  recordingTitle: string;
  /** Seconds — the recording's duration, the newest project's. */
  duration: number;
  projects: PublicProjectSummary[];
}

/**
 * Collapses a newest-first project list into recording groups. The server
 * returns projects ordered by creation (newest first); a recording's group
 * lands where its newest project sits in that flat order, and the projects
 * inside a group keep the newest-first order. Grouping is by video ID — the
 * recording identity every accepted link form collapses to — and the group
 * carries the canonical recording title and the newest project's duration.
 */
export function groupGalleryProjects(projects: readonly PublicProjectSummary[]): GalleryGroup[] {
  const groups: GalleryGroup[] = [];
  const byVideo = new Map<string, GalleryGroup>();
  for (const project of projects) {
    const group = byVideo.get(project.videoId);
    if (group === undefined) {
      const next: GalleryGroup = {
        videoId: project.videoId,
        recordingTitle: project.recordingTitle,
        duration: project.duration,
        projects: [project],
      };
      byVideo.set(project.videoId, next);
      groups.push(next);
    } else {
      group.projects.push(project);
    }
  }
  return groups;
}

/**
 * The default API for the real app, built from the deployment env, or null
 * when the app is not wired to a Supabase project — the signal the app's env
 * gate renders its "not wired up" screen on. Auth, the write surface, and the
 * anonymous read surface share the same env, so a null here is an entirely
 * unconfigured app, not a partial one.
 */
export function createDefaultProjectsApi(
  env: Record<string, string | undefined> = import.meta.env,
): ProjectsApi | null {
  const authEnv = readAuthEnv(env);
  if (authEnv === null) return null;
  const config = readProjectsConfig(env);
  if (config === null) return null;
  const api = createSupabaseProjectsApi(authEnv);
  const readDeps = { config, fetchText: fetchProjectsText };
  return {
    ...api,
    listPublishedProjects: () => fetchPublishedProjects(readDeps),
    listPublishedForVideo: (videoId) => fetchPublishedForVideo(videoId, readDeps),
    getPublicProject: (id) => fetchPublicProject(id, readDeps),
  };
}
