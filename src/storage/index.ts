/**
 * The storage layer — versioned IndexedDB persistence and recording identity,
 * the durability guarantee the rest of the app relies on. Built on the domain
 * module's types; tested against real IndexedDB semantics via fake-indexeddb.
 */
export { createAutosave, saveStatusFor } from './autosave';
export type { Autosave, AutosaveOptions, SaveStatus } from './autosave';
export { StorageError } from './errors';
export type { StorageErrorCode } from './errors';
export { defaultPlayerMode } from './records';
export type { PlayerMode, ProjectRecord, ProjectSummary } from './records';
export { createStorage } from './repository';
export type {
  CreateStorageOptions,
  ProjectRepository,
  Storage,
} from './repository';
