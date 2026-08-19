/**
 * The storage layer — versioned IndexedDB persistence and recording identity,
 * the durability guarantee the rest of the app relies on. Built on the domain
 * module's types; tested against real IndexedDB semantics via fake-indexeddb.
 */
export { createAutosave, saveStatusFor } from './autosave';
export type { Autosave, AutosaveOptions, SaveStatus } from './autosave';
export { StorageError } from './errors';
export type { StorageErrorCode } from './errors';
export { estimateStoredSize } from './records';
export type {
  LibraryEntryRecord,
  LibraryEntrySummary,
  PlayerMode,
  ProjectRecord,
  ProjectSource,
  ProjectSummary,
} from './records';
export { createStorage } from './repository';
export type {
  CreateStorageOptions,
  LibraryRepository,
  ProjectRepository,
  Storage,
} from './repository';
export { sha256 } from './sha256';
