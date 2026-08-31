import type { ServerProject } from '../projects/types';
import { marker } from './marker-fixture';

/**
 * Test fixture for a server project (ADR-0006) with sensible defaults: a
 * public, published recording with two markers and an empty movement list.
 * `playerMode` is deliberately absent — the first-open posture is derived
 * from what the project carries, never stored (T51).
 */
export function serverProject(overrides: Partial<ServerProject> = {}): ServerProject {
  return {
    id: 'project-1',
    name: 'Brahms Op. 118 No. 2',
    recordingTitle: 'Brahms: Klavierstücke, Op. 118',
    videoId: 'dQw4w9WgXcQ',
    duration: 123.456,
    markers: [marker('m1', 10), marker('m2', 20)],
    movements: [],
    visibility: 'public',
    publicationStatus: 'published',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}
