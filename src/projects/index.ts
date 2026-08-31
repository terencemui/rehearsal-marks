/**
 * The projects module — the server-side project data surface (ADR-0006). One
 * seam (`ProjectsApi`) over the `projects` table: the signed-in workspace's
 * list, reads, and writes, the anonymous gallery reads (T50), the grouping the
 * gallery renders, and the two PostgREST adapters that fetch it.
 */
export { createDefaultProjectsApi, groupGalleryProjects } from './api';
export type { GalleryGroup, ProjectsApi, PublicProject, PublicProjectSummary } from './api';
export type {
  ProjectSummary,
  ProjectUpdate,
  ProjectValues,
  ServerProject,
  ProjectVisibility,
  PublicationStatus,
} from './types';
export { parseProjectRow, summarizeProject } from './types';
export {
  getPublicProject,
  listPublishedForVideo,
  listPublishedProjects,
  readProjectsConfig,
} from './read';
export type { ProjectsConfig, ProjectsReadDependencies } from './read';
