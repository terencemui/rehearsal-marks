/**
 * The audio layer — the AudioController seam plus the pure peak and ruler
 * math behind it. wavesurfer is imported only inside `controller.ts`.
 */
export { DecodeError } from './errors';
export { bucketedPeaks, extractPeaks, DEFAULT_PEAK_COLUMNS } from './peaks';
export type { PeakData } from './peaks';
export { formatRulerTime, rulerTicks } from './ruler';
export type { RulerTick } from './ruler';
export { createAudioController } from './controller';
export type {
  AudioController,
  LoadOptions,
  LoadResult,
  PlaybackState,
  RenderMode,
} from './controller';
