/**
 * The audio layer — the AudioController seam plus the pure peak math behind
 * it. wavesurfer is imported only inside `controller.ts`; the shared ruler
 * rendering lives in `src/playback`, where any backend can reach it.
 */
export { DecodeError } from './errors';
export { bucketedPeaks, decodePeaksOrNull, extractPeaks, DEFAULT_PEAK_COLUMNS } from './peaks';
export type { PeakData } from './peaks';
export { createAudioController } from './controller';
export type {
  AudioController,
  LoadOptions,
  LoadResult,
  PlaybackState,
  RenderMode,
} from './controller';
