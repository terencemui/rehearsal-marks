/**
 * The YouTube path: turning a pasted link into a persisted project — validate,
 * name, save. Nothing needs bytes: no decode, no peaks, no hash, and no audio
 * to store. The link rules themselves live in the domain module; this owns only
 * the record they produce.
 */

import { DomainError, errorMessage, newId, parseYouTubeLink } from '../domain';
import { defaultPlayerMode } from '../storage';
import type { ProjectRecord } from '../storage';
import type { CommunityLabelSet } from './community';

/** Everything the pipeline needs from outside itself, injectable in tests. */
export interface YouTubeDependencies {
  /** The video's title, or null when it cannot be read. Never rejects the project. */
  fetchTitle: (canonicalUrl: string) => Promise<string | null>;
  /**
   * The video's community label set, or null when none exists or loads —
   * never rejects the project; an unlabeled video is a Label-mode start.
   * The transport (a Supabase query, per ADR-0001) is the app's default
   * resolver; tests inject one that always answers null.
   */
  loadCommunityLabels: (videoId: string) => Promise<CommunityLabelSet | null>;
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
 * names the project after the video's title, copies in the community label
 * set when one exists, and saves. A playlist or a malformed link returns
 * guidance and writes nothing. A title or label lookup that fails is not a
 * rejection — the video may still play, and one that cannot is the player's
 * story to tell — so the name falls back to the video ID and the marks fall
 * back to empty. Storage failures propagate to the caller, exactly as the
 * upload path's do.
 */
export async function createProjectFromYouTubeLink(
  input: string,
  { fetchTitle, loadCommunityLabels, save, now = Date.now }: YouTubeDependencies,
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

  // Title and labels are independent lookups about the same video, fetched
  // concurrently: creation waits for the slower one, never their sum.
  const [title, community] = await Promise.all([
    readTitle(fetchTitle, link.canonicalUrl),
    readCommunityLabels(loadCommunityLabels, link.videoId),
  ]);
  const name = title ?? fallbackName(link.videoId);
  const markers = community?.markers ?? [];

  const createdAt = now();
  const project: ProjectRecord = {
    id: newId(),
    name,
    createdAt,
    updatedAt: createdAt,
    // The video ID is the recording's identity; the canonical URL the player
    // plays from is derived from it. The embed reports the real duration once
    // it is ready and the player persists it through the metadata-duration
    // path; the community set's duration seeds the record, so a project with
    // marks has an honest timeline even before the embed reports its own.
    videoId: link.videoId,
    duration: community?.duration ?? 0,
    // The community set's marks are copied in as the project's own editable
    // copy — editing them never touches the shared set.
    markers,
    // The project's own rule decides the posture: marks in hand means
    // immediately practiceable (Playback); a bare link arrives with an empty
    // timeline and lands in Label with the marking tools in reach.
    playerMode: defaultPlayerMode(markers.length),
  };
  await save(project);
  return { ok: true, project };
}

/** The video's community label set, or null — a failed lookup never rejects the project. */
async function readCommunityLabels(
  loadCommunityLabels: YouTubeDependencies['loadCommunityLabels'],
  videoId: string,
): Promise<CommunityLabelSet | null> {
  try {
    return await loadCommunityLabels(videoId);
  } catch {
    return null;
  }
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
