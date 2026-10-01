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
// Re-exported beside `ProjectsApi` because naming is a project-level setting,
// so the screens that already read this barrel for a project's surface get its
// vocabulary from the same place. A screen that reads the domain directly —
// the panel and the readout, which are handed markers — imports it there.
export { NAMINGS } from '../domain';
export type { Naming } from '../domain';
export {
  getPublicProject,
  listPublishedForVideo,
  listPublishedProjects,
  readProjectsConfig,
} from './read';
export type { ProjectsConfig, ProjectsReadDependencies } from './read';
