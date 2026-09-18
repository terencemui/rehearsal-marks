import { useMemo, useSyncExternalStore } from 'react';
import type { AudioController, PlaybackState } from '../audio';
import { deriveLabels, practiceReadout } from '../domain';
import type { LabeledMarker } from '../domain';
import type { ServerProject } from '../projects/types';

export interface LabeledPlaybackOptions {
  /** The controller the session runs on — the playback store lives behind its seam. */
  controller: AudioController;
  /** The session's record, as the surface renders it. */
  record: ServerProject;
}

/**
 * What a player surface reads off its recording: the live playback state, the
 * record's marks with their derived labels, and where the playhead sits among
 * them.
 *
 * Both surfaces that host a recording — the practice surface (T39) and the
 * markings page (T55) — need exactly this and nothing more, so it is derived
 * once here rather than twice at the call sites: the same subscription to the
 * controller's store, the same label derivation, and the same duration
 * fallback, which is the one subtle piece.
 */
export interface LabeledPlayback {
  /** The controller's playback store, subscribed. */
  playback: PlaybackState;
  /** The record's marks, labelled by rank within their movement (ADR-0005). */
  labeled: LabeledMarker[];
  /** The recording's length — the measured one when the media supplied it. */
  duration: number;
  /** The playhead, clamped to the end — what a readout reads and divides by. */
  elapsed: number;
  /** The most recently passed mark (none before the first). */
  activeMarker: LabeledMarker | null;
}

/**
 * The playback view of one recording session (T55), shared by the surfaces that
 * host one. Every value here is derived from the record and the controller; the
 * session's load lifecycle and teardown belong to `useRecordingSession`.
 */
export function useLabeledPlayback({
  controller,
  record,
}: LabeledPlaybackOptions): LabeledPlayback {
  // The playback store lives behind the seam; React subscribes to it directly.
  const playback = useSyncExternalStore(controller.subscribe, controller.getPlaybackState);

  // Labels derive from the recording's movements (ADR-0005): they restart at A
  // within each movement, so a movement's letters read the same whether the
  // piece is one movement or four. The derived label is what a surface shows —
  // it is never edited, only recomputed.
  const labeled = useMemo(
    () => deriveLabels(record.markers, record.movements),
    [record.markers, record.movements],
  );

  // The measured duration wins once the media has supplied one; the record's
  // stored length is the fallback — the timeline a dead embed still draws.
  const duration = playback.duration > 0 ? playback.duration : record.duration;
  // The elapsed time, clamped to the end.
  const elapsed = Math.min(playback.currentTime, duration);

  return {
    playback,
    labeled,
    duration,
    elapsed,
    activeMarker: practiceReadout(labeled, elapsed, duration).passed,
  };
}
