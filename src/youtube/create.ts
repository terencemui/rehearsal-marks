/**
 * The YouTube path: turning a pasted link into a server project — validate,
 * name, create. Nothing needs bytes: no decode, no peaks, no hash, and no
 * audio to store. The link rules themselves live in the domain module; this
 * owns only the values they produce.
 *
 * A created project is *bare* (T51): it carries the video title as both its
 * name and its canonical recording title, an empty timeline, and a zero
 * duration — the embed corrects the in-memory duration once it loads, but the
 * server never persists it. No community labels are copied in; the owner's
 * marks are their own, and ownership, status (pending), and stamps all come
 * from the server.
 */

import { DomainError, errorMessage, parseYouTubeLink } from '../domain';
import type { ProjectValues, ServerProject } from '../projects/types';

/** Everything the pipeline needs from outside itself, injectable in tests. */
export interface YouTubeDependencies {
  /** The video's title, or null when it cannot be read. Never rejects the project. */
  fetchTitle: (canonicalUrl: string) => Promise<string | null>;
  /** Creates the project on the server and returns the stored row. */
  create: (values: ProjectValues) => Promise<ServerProject>;
}

export type YouTubeOutcome =
  | { ok: true; project: ServerProject }
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
 * Turns a pasted link into a server project: resolves it to one video, names
 * the project after the video's title, and creates it with an empty timeline
 * and a zero duration (a bare project — the server owns everything else). A
 * playlist or a malformed link returns guidance and writes nothing. A title
 * lookup that fails is not a rejection — the video may still play, and one
 * that cannot is the player's story to tell — so the name falls back to the
 * video ID. Server failures propagate to the caller, exactly as the upload
 * path's did.
 */
export async function createProjectFromYouTubeLink(
  input: string,
  { fetchTitle, create }: YouTubeDependencies,
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

  const project = await create({
    name,
    // The canonical recording title, fixed at creation; the user's own name
    // starts equal to it and is the only editable half.
    recordingTitle: title ?? fallbackName(link.videoId),
    videoId: link.videoId,
    // oEmbed reports no duration (T51 decision); the embed corrects the
    // in-memory duration once it loads, and the server never persists it.
    duration: 0,
    markers: [],
    movements: [],
  });
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
