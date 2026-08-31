import { vi } from 'vitest';
import type { ProjectsApi, PublicProject, PublicProjectSummary } from '../projects';

/**
 * Test double for the ProjectsApi read seam — the counterpart of
 * mockCommonsWrite, faked the way every test above the read adapter's fetch
 * boundary fakes it. The fixture holds the published list an anonymous read
 * would have fetched, resolves the detail reads from a keyed map, and lets a
 * test fail the next call to exercise the gallery's and view's error
 * surfaces.
 */
export interface MockProjectsApi extends ProjectsApi {
  /** The published list the gallery renders, as the read would have returned it. */
  published: PublicProjectSummary[];
  /** The detail rows the read-only view opens, keyed by project id. */
  details: Map<string, PublicProject>;
  /** The next read rejects — the read-error surface, not the not-found surface. */
  failNextRead(message?: string): void;
}

export function mockProjectsApi(rows: PublicProjectSummary[] = []): MockProjectsApi {
  const details = new Map<string, PublicProject>();
  let nextError: string | null = null;

  return {
    published: rows,
    details,
    listPublishedProjects: vi.fn(async () => {
      if (nextError !== null) {
        const message = nextError;
        nextError = null;
        throw new Error(message);
      }
      return [...rows];
    }),
    listPublishedForVideo: vi.fn(async (videoId) =>
      rows.filter((row) => row.videoId === videoId),
    ),
    getPublicProject: vi.fn(async (id) => {
      if (nextError !== null) {
        const message = nextError;
        nextError = null;
        throw new Error(message);
      }
      return details.get(id) ?? null;
    }),
    failNextRead(message = 'read failed') {
      nextError = message;
    },
  };
}
