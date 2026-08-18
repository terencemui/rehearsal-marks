/**
 * The domain module — the app's single primary test seam. Pure TypeScript:
 * marker model, derived labels, alias rules. Consumers see only this surface.
 */
export { DomainError } from './errors';
export type { DomainErrorCode } from './errors';
export { newId } from './id';
export { deriveLabels, labelForRank } from './labels';
export {
  ALIAS_MAX_LENGTH,
  addMarker,
  createMarker,
  moveMarker,
  removeMarker,
  setAliases,
} from './markers';
export type { LabeledMarker, Marker } from './marker';
