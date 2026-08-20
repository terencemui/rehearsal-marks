/**
 * The YouTube community label-set rules — the pure identity logic beside the
 * URL parser. T20 establishes the seam the create pipeline calls
 * (`loadCommunityLabels`): a labeled video's marks copy into a new project at
 * creation. The transport itself — a Supabase query for anonymous reads, per
 * ADR-0001 — lands with T21; until then the seam resolves null and every
 * video starts unlabeled. What survives any transport lives here: the shape
 * of a set that checked out, and the identity gate marks never cross.
 */

import { parseProjectFile, parseYouTubeLink } from '../domain';
import type { Marker } from '../domain';

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
