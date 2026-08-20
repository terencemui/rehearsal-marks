import type { AudioMeta, Marker, ProjectFileData } from '../domain';

/** A project's recording origin — uploaded file or YouTube video. */
export type ProjectSource = 'upload' | 'youtube';

/** The player posture persisted per project: Playback (read-only) or Label (editing). */
export type PlayerMode = 'playback' | 'label';

/**
 * A self-contained user project as stored: the export schema's data plus its
 * audio Blob. IndexedDB is the source of truth; `project.json` is derived.
 *
 * `source` discriminates the two shapes: uploads carry their recording as an
 * audio Blob, YouTube projects stream it instead and store none — `audio` is
 * null exactly for those. `playerMode` is the last-used Playback | Label
 * posture, persisted so reopening lands where the user left off.
 */
export interface ProjectRecord {
  id: string;
  name: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. */
  updatedAt: number;
  /** Where the recording comes from; discriminates the audio shape. */
  source: ProjectSource;
  /** The recording, copied into IndexedDB at import; null for YouTube projects. */
  audio: Blob | null;
  audioMeta: AudioMeta;
  markers: Marker[];
  /** The last-used player mode; each source's default on first open. */
  playerMode: PlayerMode;
}

/**
 * Records saved before these fields existed read back without them. Every
 * pre-existing project is an upload, so consumers treat a missing
 * discriminator as `source: 'upload'` — and a missing mode as never opened:
 * the player applies the source-dependent default (`defaultPlayerMode`) on
 * first open, exactly as the creation paths stamp it.
 */

/**
 * A project's first-open posture. Uploads (including legacy records, whose
 * missing source always means upload) open in Label mode, ready to mark;
 * YouTube and library-seeded projects open in Playback mode. Creation paths
 * stamp this into new records; the player applies it when the persisted mode
 * is missing.
 */
export function defaultPlayerMode(source: ProjectSource | undefined): PlayerMode {
  return source === 'youtube' ? 'playback' : 'label';
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
  /** The recording's origin — a library audio URL, or empty for uploads. */
  source: string;
  /**
   * The recording's sha256 — the stable identity the "Loaded" join matches
   * on, so a catalog redeploy that moves the audio URL still finds the
   * seeded project.
   */
  sha256: string;
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
 * A YouTube project stores no recording, so its null audio counts as zero.
 */
export function estimateStoredSize(record: ProjectRecord): number {
  const serialized = JSON.stringify({
    name: record.name,
    audioMeta: record.audioMeta,
    markers: record.markers,
  });
  return (record.audio?.size ?? 0) + encoder.encode(serialized).byteLength;
}
