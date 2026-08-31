/**
 * The projects module — the server-side project data surface (T50). One
 * read seam (`ProjectsApi`), the grouping the gallery renders, and the
 * PostgREST adapter that fetches published public projects anonymously.
 */
export { groupGalleryProjects } from './api';
export type { GalleryGroup, ProjectsApi, PublicProject, PublicProjectSummary } from './api';
export {
  createDefaultProjectsApi,
  getPublicProject,
  listPublishedForVideo,
  listPublishedProjects,
  readProjectsConfig,
} from './read';
export type { ProjectsConfig, ProjectsReadDependencies } from './read';
