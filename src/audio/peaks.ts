/**
 * Peaks for the waveform render: one min/max pair per pixel column, computed
 * from a single full decode whose AudioBuffer is discarded after bucketing.
 *
 * The buffer is deliberately scoped to `extractPeaks` and never retained —
 * transient memory peaks at decode time and falls back to near-zero once the
 * peaks (a few kilobytes) are kept.
 */

import { DecodeError } from './errors';

/**
 * Column count for peak extraction. Deliberately fixed rather than tied to
 * the container's pixel width: peaks are pre-decoded before the player (and
 * its width) exists, and the spec forbids retaining the buffer that a
 * per-width re-bucket would need — the renderer stretches buckets to any
 * width instead. 8000 is wavesurfer's own default peak resolution.
 */
export const DEFAULT_PEAK_COLUMNS = 8000;

/** Decoded peaks plus the authoritative duration from the decode pass. */
export interface PeakData {
  /** `[min, max]` per column, one entry per column. */
  peaks: number[][];
  /** Seconds, float — the decode's own duration, preferred over metadata. */
  duration: number;
}

/**
 * Buckets decoded channel data into per-column min/max pairs. Pure: takes the
 * channel arrays, not an AudioBuffer, so it can be tested without Web Audio.
 *
 * Every frame is assigned to exactly one column (`floor(i * columns /
 * frameCount)`), so buckets tile the buffer with no gaps or overlaps;
 * columns that receive no frames (more columns than frames) read as silence.
 * Minimum and maximum are taken across all channels, so a stereo recording
 * collapses to one track.
 */
export function bucketedPeaks(channels: Float32Array[], columns: number): number[][] {
  const frameCount = channels[0]?.length ?? 0;
  if (frameCount === 0 || columns <= 0) return [];

  const peaks: number[][] = Array.from({ length: columns }, () => [0, 0]);
  const mins = new Array<number>(columns).fill(Infinity);
  const maxs = new Array<number>(columns).fill(-Infinity);
  for (let frame = 0; frame < frameCount; frame++) {
    const column = Math.min(columns - 1, Math.floor((frame * columns) / frameCount));
    for (const channel of channels) {
      const value = channel[frame];
      if (value < mins[column]) mins[column] = value;
      if (value > maxs[column]) maxs[column] = value;
    }
  }
  for (let column = 0; column < columns; column++) {
    if (mins[column] !== Infinity) peaks[column] = [mins[column], maxs[column]];
  }
  return peaks;
}

/**
 * The one full decode pass: decodes the recording, buckets its channels, and
 * lets the AudioBuffer fall out of scope. Rejects with a `DecodeError` when
 * the recording cannot be decoded — the caller falls back to ruler-only mode.
 */
export async function extractPeaks(blob: Blob): Promise<PeakData> {
  const arrayBuffer = await blob.arrayBuffer();
  // An OfflineAudioContext of length 1 never touches an audio output device:
  // it exists only to host this decode.
  const context = new OfflineAudioContext(1, 1, 44_100);
  try {
    const buffer = await context.decodeAudioData(arrayBuffer);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i),
    );
    return { peaks: bucketedPeaks(channels, DEFAULT_PEAK_COLUMNS), duration: buffer.duration };
  } catch (error) {
    throw new DecodeError(error);
  } finally {
    // BaseAudioContext.close() ships in all evergreen browsers; the TS DOM lib
    // lags it, hence the cast. A close failure must never mask a DecodeError.
    await (context as unknown as { close(): Promise<void> }).close().catch(() => {});
  }
}
