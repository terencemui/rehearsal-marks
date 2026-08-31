/**
 * The domain module — the app's single primary test seam. Pure TypeScript:
 * marker model, derived labels, alias rules. Consumers see only this surface.
 */
export { DomainError, errorMessage } from './errors';
export type { DomainErrorCode } from './errors';
export { newId } from './id';
export { deriveLabels, labelForRank } from './labels';
export { FRAME_EPSILON, nextMarker, previousMarker } from './navigation';
export { movementForTime } from './movement';
export type { Movement } from './movement';
export { practiceReadout } from './practice';
export type { PracticeReadout } from './practice';
export {
  ALIAS_MAX_LENGTH,
  addMarker,
  createMarker,
  moveMarker,
  removeMarker,
  setAliases,
} from './markers';
export { formatTime, formatWholeSeconds, parseTime } from './time';
export { canonicalYouTubeUrl, isVideoId, parseYouTubeLink } from './youtube';
export type { YouTubeLink } from './youtube';
export { parseMarkers, parseMovements } from './documents';
export type { LabeledMarker, Marker } from './marker';
