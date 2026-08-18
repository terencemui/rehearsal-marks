import type { AudioMeta, Marker, ProjectFileData } from '../domain';

/**
 * A self-contained user project as stored: the export schema's data plus its
 * audio Blob. IndexedDB is the source of truth; `project.json` is derived.
 */
export interface ProjectRecord {
  id: string;
  name: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. */
  updatedAt: number;
  /** The recording, copied into IndexedDB at import. */
  audio: Blob;
  audioMeta: AudioMeta;
  markers: Marker[];
}

/** One row of the Projects screen: what story #4 asks the list to show. */
export interface ProjectSummary {
  id: string;
  name: string;
  /** Seconds, from audioMeta — the recording's known duration. */
  duration: number;
  markerCount: number;
  /** Estimated bytes stored: audio blob plus the serialized data fields. */
  sizeBytes: number;
  /** Epoch ms. */
  updatedAt: number;
}

/**
 * A cached community recording: audio plus its parsed label set, stored
 * independently of user projects so the cache can be evicted on its own.
 */
export interface LibraryEntryRecord {
  /** The library catalog entry id. */
  id: string;
  audio: Blob;
  labelset: ProjectFileData;
  /** Epoch ms. */
  cachedAt: number;
}

/** One row of the cache — enough to decide what to evict under pressure. */
export interface LibraryEntrySummary {
  id: string;
  sizeBytes: number;
  cachedAt: number;
}

const encoder = new TextEncoder();

/**
 * A project's honest stored size: the audio blob's bytes plus the serialized
 * record data. An estimate, not an exact IndexedDB footprint — exact enough
 * for the storage-full message to rank projects by what freeing each saves.
 */
export function estimateStoredSize(record: ProjectRecord): number {
  const serialized = JSON.stringify({
    name: record.name,
    audioMeta: record.audioMeta,
    markers: record.markers,
  });
  return record.audio.size + encoder.encode(serialized).byteLength;
}
