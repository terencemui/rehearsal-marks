/**
 * The app's server-project surface (ADR-0006) — the seam component tests
 * fake the way `mockAuth` fakes `SupabaseAuth`. `supabase.ts` is the only
 * implementation, and it owns the supabase-js reference under the containment
 * rule; everything above this interface drives the shape.
 *
 * Anonymous reads (getProject, listPublishedForVideo) and signed-in writes
 * share one surface: the server decides, via RLS, what a given session may
 * read and write. The write operations restore the session first and fail
 * with the app's own `not-signed-in` error when there is none.
 */

import { readAuthEnv } from '../auth';
import { createSupabaseProjectsApi } from './supabase';
import type { ProjectSummary, ProjectUpdate, ProjectValues, ServerProject } from './types';
import type { ProjectVisibility } from './types';

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
  /**
   * The published public projects for a video — the create screen's count
   * peek. Explicitly filtered to published public regardless of the caller's
   * session, so a signed-in owner's own pending/private projects are not
   * counted.
   */
  listPublishedForVideo(videoId: string): Promise<ProjectSummary[]>;
}

/**
 * The default API for the real app: built from the deployment env, or null
 * when the app is not wired to a Supabase project — the signal the app
 * renders its "not wired up" screen on. Auth shares the same env, so a null
 * here is an entirely unconfigured app, not a partial one.
 */
export function createDefaultProjectsApi(): ProjectsApi | null {
  const env = readAuthEnv();
  if (env === null) return null;
  try {
    return createSupabaseProjectsApi(env);
  } catch {
    // readAuthEnv covers the known eager-throw cases; anything else the
    // client constructor can raise is still an unconfigured deployment — the
    // app renders the honest "not wired up" screen instead of crashing.
    return null;
  }
}
