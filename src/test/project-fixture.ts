import type { ProjectRecord } from '../storage/records';
import { marker } from './marker-fixture';

/** Test fixture for a stored project with sensible defaults. */
export function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'project-1',
    name: 'Brahms Op. 118 No. 2',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
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
    ...overrides,
  };
}
