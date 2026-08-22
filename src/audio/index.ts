/**
 * The audio layer — the AudioController seam plus the shared ruler. The ruler
 * rendering lives in `src/playback`, where any backend can reach it.
 */
export { YouTubePlaybackError } from './errors';
export { createAudioController } from './controller';
export type { AudioController, LoadOptions, LoadResult, PlaybackState } from './controller';
