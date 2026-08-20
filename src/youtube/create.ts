/**
 * The YouTube path: turning a pasted link into a persisted project. The mirror
 * of the upload pipeline — validate, name, save — minus everything that needs
 * bytes: no decode, no peaks, no hash, and no audio to store. The link rules
 * themselves live in the domain module; this owns only the record they produce.
 */

import { DomainError, errorMessage, newId, parseYouTubeLink } from '../domain';
import { defaultPlayerMode } from '../storage';
import type { ProjectRecord } from '../storage';

/** Everything the pipeline needs from outside itself, injectable in tests. */
export interface YouTubeDependencies {
  /** The video's title, or null when it cannot be read. Never rejects the project. */
  fetchTitle: (canonicalUrl: string) => Promise<string | null>;
  save: (record: ProjectRecord) => Promise<void>;
  now?: () => number;
}

export type YouTubeOutcome =
  | { ok: true; project: ProjectRecord }
  | { ok: false; guidance: string };

/**
 * The name for a video whose title this app could not read — offline, or a
 * video that is private or gone. Identifying beats empty: the ID is what the
 * user can act on, and the project stays renameable like any other.
 */
function fallbackName(videoId: string): string {
  return `YouTube video ${videoId}`;
}

/**
 * Turns a pasted link into a persisted project: resolves it to one video,
 * names the project after the video's title, and saves. A playlist or a
 * malformed link returns guidance and writes nothing. A title lookup that
 * fails is not a rejection — the video may still play, and one that cannot is
 * the player's story to tell — so the name falls back to the video ID.
 * Storage failures propagate to the caller, exactly as the upload path's do.
 */
export async function createProjectFromYouTubeLink(
  input: string,
  { fetchTitle, save, now = Date.now }: YouTubeDependencies,
): Promise<YouTubeOutcome> {
  let link;
  try {
    link = parseYouTubeLink(input);
  } catch (error) {
    // Only the domain's own rejections are guidance; anything else is a bug
    // and must not be dressed up as advice to the user.
    if (error instanceof DomainError) return { ok: false, guidance: errorMessage(error) };
    throw error;
  }

  const title = await readTitle(fetchTitle, link.canonicalUrl);
  const name = title ?? fallbackName(link.videoId);

  const createdAt = now();
  const project: ProjectRecord = {
    id: newId(),
    name,
    createdAt,
    updatedAt: createdAt,
    source: 'youtube',
    // The app never holds YouTube audio: no blob, no bytes, no hash. The
    // canonical URL carries the recording identity in `source` instead.
    audio: null,
    audioMeta: {
      sha256: '',
      // The embed reports the real duration once it is ready; the player
      // persists it through the same metadata-duration path uploads use.
      duration: 0,
      mimeType: '',
      filename: name,
      sizeBytes: 0,
      source: link.canonicalUrl,
      license: '',
      attribution: '',
    },
    markers: [],
    // The source's own rule decides the posture rather than a literal here —
    // a bare link arrives with no marks, so this is Label today, and it
    // becomes Playback for free once community label sets load at creation.
    playerMode: defaultPlayerMode('youtube', 0),
  };
  await save(project);
  return { ok: true, project };
}

/** The trimmed title, or null for anything unusable — blank, missing, or failed. */
async function readTitle(
  fetchTitle: YouTubeDependencies['fetchTitle'],
  canonicalUrl: string,
): Promise<string | null> {
  let title: string | null;
  try {
    title = await fetchTitle(canonicalUrl);
  } catch {
    return null;
  }
  const trimmed = title?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
