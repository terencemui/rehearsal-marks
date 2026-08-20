import type { ProjectRecord } from '../storage/records';
import { marker } from './marker-fixture';

/** Test fixture for a stored project with sensible defaults. */
export function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'project-1',
    name: 'Brahms Op. 118 No. 2',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    source: 'upload',
    audio: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }),
    audioMeta: {
      sha256: 'abc123',
      duration: 123.456,
      mimeType: 'audio/mpeg',
      filename: 'brahms.mp3',
      sizeBytes: 4,
      source: '',
      license: '',
      attribution: '',
    },
    markers: [marker('m1', 10), marker('m2', 20)],
    playerMode: 'label',
    ...overrides,
  };
}

/**
 * A stored YouTube project: the same data as `projectRecord`, but the source
 * discriminator is `youtube` and audio is null.
 *
 * `playerMode` here is a fixture value, not a claim about the source's
 * default. The create pipeline stamps `label` (a bare link arrives with no
 * marks), and the Playback default belongs to the community-label-set case
 * that does not exist yet — tests that care about the default must assert
 * against the pipeline, never against this.
 */
export function youtubeProjectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return projectRecord({
    source: 'youtube',
    audio: null,
    playerMode: 'playback',
    ...overrides,
  });
}

/**
 * The blob of an upload-shaped record, narrowed: uploads always carry audio.
 * Tests needing the null shape read `record.audio` directly.
 */
export function uploadAudio(record: ProjectRecord): Blob {
  if (record.audio === null) throw new Error('Expected an upload record with audio.');
  return record.audio;
}
