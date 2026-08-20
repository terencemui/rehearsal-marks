/**
 * The domain module — the app's single primary test seam. Pure TypeScript:
 * marker model, derived labels, alias rules. Consumers see only this surface.
 */
export { DomainError, errorMessage } from './errors';
export type { DomainErrorCode } from './errors';
export { newId } from './id';
export { deriveLabels, labelForRank } from './labels';
export { markerForLetter, nextMarker, previousMarker } from './navigation';
export {
  ALIAS_MAX_LENGTH,
  addMarker,
  createMarker,
  moveMarker,
  removeMarker,
  setAliases,
} from './markers';
export { formatTime, parseTime } from './time';
export { canonicalYouTubeUrl, isVideoId, parseYouTubeLink } from './youtube';
export type { YouTubeLink } from './youtube';
export { SCHEMA_VERSION, parseMarkers, parseProjectFile, serializeProjectFile, youtubeAudioMeta } from './projectFile';
export type { AudioMeta, ProjectFileData, ProjectInfo, ProjectSource } from './projectFile';
export type { LabeledMarker, Marker } from './marker';
