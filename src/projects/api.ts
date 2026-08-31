import type { Marker, Movement } from '../domain';

/**
 * The read side of the project data surface (T50) — the anonymous half of the
 * `ProjectsApi` the parent ticket (#105) describes: published public projects
 * over the server-side `projects` table, no account needed. The gallery lists
 * them grouped by recording; the read-only view opens one. Everything here is
 * the contract the UI renders — the transport that fetches it lives in
 * `read.ts`, faked in tests at this interface.
 */

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
 * The project data API's read seam: the anonymous reads the app and its tests
 * share. One PostgREST adapter implements it over the `projects` table; every
 * test above this seam fakes the interface.
 */
export interface ProjectsApi {
  /** Every published public project, newest first — the gallery's source. */
  listPublishedProjects(): Promise<PublicProjectSummary[]>;
  /** Published public projects for one recording, newest first — the per-recording list. */
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
