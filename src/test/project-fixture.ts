import type { ProjectRecord } from '../storage/records';
import { marker } from './marker-fixture';

/**
 * Test fixture for a stored project with sensible defaults. Every project is a
 * YouTube project — uploads are retired — so the record carries the video ID
 * and duration as its recording identity and nothing else.
 *
 * `playerMode` here is a fixture value, not a claim about the source's default.
 * The create pipeline stamps `label` (a bare link arrives with no marks), and
 * the Playback default belongs to the community-label-set case — tests that
 * care about the default must assert against the pipeline, never against this.
 */
export function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'project-1',
    name: 'Brahms Op. 118 No. 2',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    videoId: 'dQw4w9WgXcQ',
    duration: 123.456,
    markers: [marker('m1', 10), marker('m2', 20)],
    movements: [],
    playerMode: 'label',
    ...overrides,
  };
}
