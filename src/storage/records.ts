import type { Marker } from '../domain';
import { parseYouTubeLink } from '../domain';

/** The player posture persisted per project: Playback (read-only) or Label (editing). */
export type PlayerMode = 'playback' | 'label';

/**
 * A self-contained user project as stored. IndexedDB is the source of truth;
 * `project.json` (the Commons format) is derived.
 *
 * Every project is YouTube-only: uploads are retired, so there is no audio
 * blob, no source discriminator, and no upload audio facts — the record holds
 * recording identity (the video ID plus duration) and nothing else. `playerMode`
 * is the last-used Playback | Label posture, persisted so reopening lands where
 * the user left off.
 */
export interface ProjectRecord {
  id: string;
  name: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. */
  updatedAt: number;
  /** The 11-character YouTube video ID — the recording's identity. */
  videoId: string;
  /** Seconds, float — the soft check of recording identity. */
  duration: number;
  markers: Marker[];
  /** The last-used player mode; the project's default on first open. */
  playerMode: PlayerMode;
}

/**
 * Records saved before `playerMode` existed read back without it. The player
 * treats a missing mode as never opened and applies `defaultPlayerMode` on
 * first open, exactly as the creation paths stamp it.
 */

/**
 * A project's first-open posture — decided by what the project carries, since
 * every project is a YouTube project now.
 *
 * A project turns on whether it arrived with marks: a video whose community
 * label set loaded is immediately practiceable, so it opens in Playback; a
 * bare pasted link has an empty timeline and nothing to practise against, so
 * it opens in Label with the marking tools in reach. Opening an empty project
 * read-only would hide the only thing there is to do with it.
 *
 * Creation paths stamp this into new records; the player applies it when the
 * persisted mode is missing.
 */
export function defaultPlayerMode(markerCount: number): PlayerMode {
  return markerCount > 0 ? 'playback' : 'label';
}

/** One row of the Projects screen: what story #4 asks the list to show. */
export interface ProjectSummary {
  id: string;
  name: string;
  /** Seconds — the recording's known duration. */
  duration: number;
  markerCount: number;
  /** Epoch ms. */
  updatedAt: number;
}

/** The pre-v2 stored shape the migration reads; only these fields matter. */
interface LegacyRecord {
  id?: unknown;
  name?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  source?: unknown;
  audioMeta?: { source?: unknown; duration?: unknown };
  markers?: unknown;
  playerMode?: unknown;
}

/**
 * The v2 migration's per-record decision: a stored record becomes its slim
 * YouTube-only form, or null when it must be deleted. Every record written
 * before v2 is upload-shaped — a missing source always meant upload — or
 * YouTube-shaped; only the latter survives, rewritten to carry its video ID
 * and duration — the recording identity — and nothing else.
 */
export function slimRecordFromStored(value: unknown): ProjectRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as LegacyRecord;
  // The discriminator decides: absent or 'upload' is an upload record — the
  // migration's one-time cut. YouTube records keep their id and marks.
  if (raw.source !== 'youtube') return null;
  if (typeof raw.audioMeta?.source !== 'string') return null;

  // A YouTube record's identity is its canonical URL; a stored URL that names
  // no video cannot play, so it is deleted with the uploads rather than kept
  // as a broken project.
  let videoId: string;
  try {
    videoId = parseYouTubeLink(raw.audioMeta.source).videoId;
  } catch {
    return null;
  }

  const markers = Array.isArray(raw.markers) ? (raw.markers as Marker[]) : [];
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    videoId,
    duration: typeof raw.audioMeta.duration === 'number' ? raw.audioMeta.duration : 0,
    markers,
    // A legacy record without a stored mode gets the same default the player
    // would have applied, so migrated records are canonical.
    playerMode:
      raw.playerMode === 'playback' || raw.playerMode === 'label'
        ? raw.playerMode
        : defaultPlayerMode(markers.length),
  };
}
