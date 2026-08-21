/**
 * The YouTube community label-set rules — the identity logic beside the URL
 * parser, and the resolver behind the create seam. T20 established the seam
 * the create pipeline calls (`loadCommunityLabels`): a labeled video's marks
 * copy into a new project at creation. The transport — a Supabase query for
 * anonymous reads, per ADR-0001 — lives in the Commons module and lands with
 * T21: the published label set for the video checks out of the Commons, the
 * identity gate marks never cross, and an unlabeled video starts unlabeled.
 */

import { parseProjectFile, parseYouTubeLink } from '../domain';
import type { Marker } from '../domain';
import type { LabelSetReadRow } from '../commons/labelSet';
import { loadPublishedLabelSet } from '../commons/load';
import type { CommonsReadDependencies } from '../commons/load';

/** A community label set that checked out: the marks and the video's known duration. */
export interface CommunityLabelSet {
  markers: Marker[];
  /**
   * Seconds — the video's known duration. Seeded into the project so a video
   * that never reports its own duration (one that cannot play) still has an
   * honest timeline; the player overwrites it from the embed once one is
   * known, exactly as for uploads.
   */
  duration: number;
}

/** The video ID a URL names, or null when it is not a single YouTube video link. */
export function videoIdOf(url: string): string | null {
  try {
    return parseYouTubeLink(url).videoId;
  } catch {
    return null;
  }
}

/**
 * A fetched label set, gated on identity: the file must be a YouTube project
 * naming `videoId` — marks never transfer between videos. Resolves null for
 * every way the set fails the gate, so a bad contribution reads as "no
 * labels" rather than as someone else's marks.
 */
export function validateYouTubeLabelSet(text: string, videoId: string): CommunityLabelSet | null {
  let data;
  try {
    data = parseProjectFile(text);
  } catch {
    return null;
  }
  if (data.project.source !== 'youtube') return null;
  if (videoIdOf(data.audioMeta.source) !== videoId) return null;
  return { markers: data.markers, duration: data.audioMeta.duration };
}

/**
 * The label set a Commons row checked out to: the marks and the video's
 * known duration — gated on the row naming `videoId`, the same identity
 * rule the file gate applies, so marks never transfer between videos.
 */
export function communityLabelSetFromRow(
  row: LabelSetReadRow,
  videoId: string,
): CommunityLabelSet | null {
  if (row.video_id !== videoId) return null;
  return { markers: row.markers, duration: row.duration };
}

/**
 * The transport-backed resolver the create seam calls (ADR-0001): the
 * published label set for one video, or null when none exists, the app is
 * not wired to the Commons, or the Commons is unreachable — a failed lookup
 * reads as an unlabeled video, exactly as the index fetch's did.
 */
export async function loadCommunityLabelSet(
  videoId: string,
  { fetchText, config }: CommonsReadDependencies,
): Promise<CommunityLabelSet | null> {
  const row = await loadPublishedLabelSet(videoId, { fetchText, config });
  return row === null ? null : communityLabelSetFromRow(row, videoId);
}
