/** Stable codes the UI keys storage states off. */
export type StorageErrorCode = 'storage-full' | 'unsupported-db-version' | 'db-blocked';

/** A rejected storage operation. */
export class StorageError extends Error {
  constructor(message: string, readonly code: StorageErrorCode) {
    super(message);
    this.name = 'StorageError';
  }
}

function isQuotaExceeded(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || /quota/i.test(error.message))
  );
}

/**
 * Maps raw IndexedDB failures to `StorageError`s the UI can act on; anything
 * unrecognized passes through untouched. Quota errors carry the honest,
 * export-first message the spec requires for the storage-full state.
 */
export function translateError(error: unknown): Error {
  if (isQuotaExceeded(error)) {
    return new StorageError(
      'Browser storage is full. Export projects you want to keep, then free space.',
      'storage-full',
    );
  }
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
