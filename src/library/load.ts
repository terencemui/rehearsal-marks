/**
 * The library load pipeline — the steps that turn a catalog row into a
 * cached, seeded, editable project. Pure orchestration over injected I/O:
 * fetch, hash, and the cache write come in from the caller, so every trust
 * decision (does this label set belong to this recording? is this download
 * the bytes the catalog promises?) is testable without a network.
 */

import { errorMessage, newId, parseProjectFile } from '../domain';
import type { ProjectFileData } from '../domain';
import type { LibraryEntryRecord, ProjectRecord } from '../storage';
import type { CatalogEntry } from './catalog';
import { LibraryError } from './errors';

/** Everything the pipeline needs from outside itself, injectable in tests. */
export interface LibraryLoadDependencies {
  fetchAudio(url: string): Promise<Blob>;
  sha256(blob: Blob): Promise<string>;
  saveCache(entry: LibraryEntryRecord): Promise<void>;
  now?: () => number;
}

/**
 * Fetches and parses an entry's label set, then checks its recording identity
 * against the catalog's published sha256 — a label set for a different
 * performance must never reach a project.
 */
export async function fetchLabelset(
  entry: CatalogEntry,
  fetchText: (url: string) => Promise<string>,
): Promise<ProjectFileData> {
  const text = await fetchText(entry.labelsetUrl);
  let labelset: ProjectFileData;
  try {
    labelset = parseProjectFile(text);
  } catch (error) {
    throw new LibraryError(
      `The label set for “${entry.piece}” is not a valid project file: ${errorMessage(error)}`,
      'invalid-labelset',
    );
  }
  if (labelset.audioMeta.sha256.toLowerCase() !== entry.sha256) {
    throw new LibraryError(
      `The label set for “${entry.piece}” belongs to a different recording — marks don't transfer between performances.`,
      'labelset-mismatch',
    );
  }
  return labelset;
}

/**
 * Downloads the entry's audio and writes it plus the label set into the
 * library cache — but only after the bytes hash to the catalog's published
 * sha256. A mismatched download is never cached: corruption or tampering
 * must not silently misalign marks.
 */
export async function downloadAndCache(
  entry: CatalogEntry,
  labelset: ProjectFileData,
  { fetchAudio, sha256, saveCache, now = Date.now }: LibraryLoadDependencies,
): Promise<Blob> {
  const audio = await fetchAudio(entry.audioUrl);
  const actual = await sha256(audio);
  if (actual !== entry.sha256) {
    throw new LibraryError(
      `The downloaded audio for “${entry.piece}” didn't match the catalog's checksum — try again.`,
      'audio-mismatch',
    );
  }
  await saveCache({ id: entry.id, audio, labelset, cachedAt: now() });
  return audio;
}

/**
 * Seeds the user's editable copy of a library recording: a fresh project id,
 * the piece as its name, the contributed markers copied in, and the label
 * set's recording identity — with the catalog's sha256 and audio URL as
 * authority, since those are what the cache was verified against.
 */
export function seedProject(
  entry: CatalogEntry,
  labelset: ProjectFileData,
  audio: Blob,
  now: number,
): ProjectRecord {
  return {
    id: newId(),
    name: entry.piece,
    createdAt: now,
    updatedAt: now,
    source: 'upload',
    audio,
    audioMeta: {
      ...labelset.audioMeta,
      sha256: entry.sha256,
      source: entry.audioUrl,
    },
    markers: labelset.markers,
    // Library projects open in Playback mode: the label set is already there.
    playerMode: 'playback',
  };
}

/**
 * The project seeded from an entry, if one exists — the "Loaded" state's
 * join. The recording's sha256 is the key: seeding stamps it into the
 * project's audioMeta, so a catalog redeploy that moves the audio URL still
 * finds the seeded project, and an imported copy of the same recording
 * matches too — a load can never seed a duplicate. The audio URL stays as a
 * fallback for records seeded before the hash join existed.
 */
export function seededProjectId(
  projects: readonly { id: string; audioUrl: string; sha256: string }[],
  entry: Pick<CatalogEntry, 'audioUrl' | 'sha256'>,
): string | undefined {
  return projects.find(
    (project) =>
      (project.sha256 !== '' && project.sha256 === entry.sha256) ||
      project.audioUrl === entry.audioUrl,
  )?.id;
}
