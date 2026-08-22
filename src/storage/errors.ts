/** Stable codes a storage failure carries. */
export type StorageErrorCode = 'unsupported-db-version' | 'db-blocked';

/** A rejected storage operation. */
export class StorageError extends Error {
  constructor(message: string, readonly code: StorageErrorCode) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Maps raw IndexedDB failures to `StorageError`s the UI can act on; anything
 * unrecognized passes through untouched.
 */
export function translateError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'VersionError') {
    return new StorageError(
      'The data in this browser was written by a newer version of the app. Update the app to open it.',
      'unsupported-db-version',
    );
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
